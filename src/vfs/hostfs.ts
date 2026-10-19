import { fromBytes, toBytes } from './bytes.ts';
import { FsError, type ErrCode } from './errors.ts';
import { basename, dirname, normalize } from './path.ts';
import type { DirNode, FileNode, LinkNode, VNode } from './types.ts';
import type { VFS } from './vfs.ts';

export interface HostStat {
  kind: 'file' | 'dir' | 'symlink';
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
  /** Permission bits; omitted where the host has none worth showing (Windows). */
  mode?: number;
}

/** A real directory shown inside the machine (e.g. the agent's workspace). Paths are '/'-rooted at the mount;
 * failures throw errors carrying an errno `code` (ENOENT, EEXIST, ENOTEMPTY, EACCES...). */
export interface HostFs {
  /** Like lstat(2): symlinks are reported, not followed. Null when nothing is there. */
  lstat(path: string): HostStat | null;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  rename(from: string, to: string): void;
  readlink?(path: string): string;
  symlink?(target: string, path: string): void;
  chmod?(path: string, mode: number): void;
  utimes?(path: string, mtime: number): void;
}

const CODES = new Set<string>(['ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'ENOTEMPTY', 'EACCES', 'ELOOP', 'EINVAL', 'EPERM', 'EBUSY']);
const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

type HostNode = HostFile | HostDir | HostLink;

class Mount {
  readonly fs: HostFs;
  readonly vfs: VFS;
  readonly at: string;
  readonly uid: number;
  readonly gid: number;
  private readonly nodes = new Map<string, HostNode>();

  constructor(vfs: VFS, at: string, fs: HostFs, uid: number, gid: number) {
    this.vfs = vfs;
    this.at = at;
    this.fs = fs;
    this.uid = uid;
    this.gid = gid;
  }

  /** Runs a host call, reporting failures as VFS errors against the path the shell sees. */
  call<T>(path: string, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      throw new FsError((CODES.has(code) ? code : 'EIO') as ErrCode, this.at + (path === '/' ? '' : path));
    }
  }

  node(path: string): HostNode | undefined {
    const st = this.call(path, () => this.fs.lstat(path));
    const cached = this.nodes.get(path);
    if (!st) return void this.forget(path);
    if (cached?.kind === st.kind) return cached.refresh(st), cached;
    const node = st.kind === 'dir' ? new HostDir(this, path, st) : st.kind === 'symlink' ? new HostLink(this, path, st) : new HostFile(this, path, st);
    this.nodes.set(path, node);
    return node;
  }

  /** Puts a node at `path`: a rename for nodes already on this mount, otherwise a write of its contents. */
  adopt(path: string, node: VNode): void {
    if (node instanceof HostBase && node.mount === this) {
      if (node.path === path) return;
      this.call(path, () => this.fs.rename(node.path, path));
      this.forget(node.path);
      this.forget(path);
      return;
    }
    if (node.kind === 'file') this.call(path, () => this.fs.writeFile(path, toBytes(node.content)));
    else if (node.kind === 'symlink') this.call(path, () => (this.fs.symlink ?? unsupported)(node.target, path));
    else {
      this.call(path, () => this.fs.mkdir(path));
      for (const [name, child] of node.children) this.adopt(join(path, name), child);
    }
    if (node.kind !== 'symlink') this.call(path, () => this.fs.chmod?.(path, node.mode));
  }

  remove(path: string): boolean {
    const st = this.call(path, () => this.fs.lstat(path));
    if (!st) return false;
    if (st.kind === 'dir') {
      for (const name of this.call(path, () => this.fs.readdir(path))) this.remove(join(path, name));
      this.call(path, () => this.fs.rmdir(path));
    } else this.call(path, () => this.fs.unlink(path));
    this.forget(path);
    return true;
  }

  private forget(path: string): void {
    for (const key of this.nodes.keys()) if (key === path || key.startsWith(`${path}/`)) this.nodes.delete(key);
  }
}

function unsupported(): never {
  throw Object.assign(new Error('unsupported'), { code: 'EPERM' });
}

abstract class HostBase {
  readonly ino: number;
  readonly mount: Mount;
  path: string;
  nlink = 1;
  uid: number;
  gid: number;
  ctime: number;
  protected st: HostStat;

  constructor(mount: Mount, path: string, st: HostStat) {
    this.mount = mount;
    this.path = path;
    this.st = st;
    this.ino = mount.vfs.allocIno();
    this.uid = mount.uid;
    this.gid = mount.gid;
    this.ctime = st.mtime;
  }

  refresh(st: HostStat): void {
    this.st = st;
  }

  protected abstract defaultMode(): number;

  get mode(): number {
    return this.st.mode === undefined ? this.defaultMode() : this.st.mode & 0o7777;
  }

  set mode(mode: number) {
    this.mount.call(this.path, () => (this.mount.fs.chmod ?? unsupported)(this.path, mode));
    this.st = { ...this.st, mode };
  }

  get mtime(): number {
    return this.st.mtime;
  }

  /** The host stamps its own times on writes; only explicit changes (touch -d) need utimes. */
  set mtime(ms: number) {
    if (Math.abs(ms - this.st.mtime) < 2000) return;
    this.mount.call(this.path, () => this.mount.fs.utimes?.(this.path, ms));
    this.st = { ...this.st, mtime: ms };
  }
}

class HostFile extends HostBase implements FileNode {
  readonly kind = 'file';
  private cache: { mtime: number; size: number; text: string } | null = null;

  protected defaultMode(): number {
    return 0o644;
  }

  get size(): number {
    return this.st.size;
  }

  get content(): string {
    const { mtime, size } = this.st;
    if (this.cache?.mtime === mtime && this.cache.size === size) return this.cache.text;
    const text = fromBytes(this.mount.call(this.path, () => this.mount.fs.readFile(this.path)));
    this.cache = { mtime, size, text };
    return text;
  }

  set content(text: string) {
    const bytes = toBytes(text);
    this.mount.call(this.path, () => this.mount.fs.writeFile(this.path, bytes));
    this.st = this.mount.fs.lstat(this.path) ?? { ...this.st, size: bytes.length };
    this.cache = { mtime: this.st.mtime, size: this.st.size, text };
  }
}

class HostLink extends HostBase implements LinkNode {
  readonly kind = 'symlink';

  protected defaultMode(): number {
    return 0o777;
  }

  get target(): string {
    return this.mount.call(this.path, () => (this.mount.fs.readlink ?? unsupported)(this.path));
  }
}

/** Directory entries read live from the host, so changes made outside the machine show up immediately. */
class HostChildren extends Map<string, VNode> {
  private readonly mount: Mount;
  private readonly path: string;

  constructor(mount: Mount, path: string) {
    super();
    this.mount = mount;
    this.path = path;
  }

  override get(name: string): VNode | undefined {
    return this.mount.node(join(this.path, name));
  }

  override has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  override set(name: string, node: VNode): this {
    this.mount.adopt(join(this.path, name), node);
    return this;
  }

  override delete(name: string): boolean {
    return this.mount.remove(join(this.path, name));
  }

  override get size(): number {
    return this.names().length;
  }

  private names(): string[] {
    return this.mount.call(this.path, () => this.mount.fs.readdir(this.path)).sort();
  }

  override *entries(): MapIterator<[string, VNode]> {
    for (const name of this.names()) {
      const node = this.get(name);
      if (node) yield [name, node];
    }
  }

  override *keys(): MapIterator<string> {
    for (const [name] of this.entries()) yield name;
  }

  override *values(): MapIterator<VNode> {
    for (const [, node] of this.entries()) yield node;
  }

  override [Symbol.iterator](): MapIterator<[string, VNode]> {
    return this.entries();
  }

  override forEach(fn: (node: VNode, name: string, map: Map<string, VNode>) => void): void {
    for (const [name, node] of this.entries()) fn(node, name, this);
  }
}

class HostDir extends HostBase implements DirNode {
  readonly kind = 'dir';
  readonly children: HostChildren;

  constructor(mount: Mount, path: string, st: HostStat) {
    super(mount, path, st);
    this.children = new HostChildren(mount, path);
  }

  protected defaultMode(): number {
    return 0o755;
  }
}

/** Shows a host directory at `at` (parents created as needed), owned by uid/gid inside the machine. */
export function mountHost(vfs: VFS, at: string, fs: HostFs, owner: { uid: number; gid: number }): void {
  const path = normalize(at);
  const root = new Mount(vfs, path, fs, owner.uid, owner.gid).node('/');
  if (root?.kind !== 'dir') throw new FsError('ENOTDIR', path);
  const asRoot = vfs.view({ uid: 0, gid: 0, groups: [] });
  asRoot.mkdir(dirname(path), true);
  const parent = asRoot.lookup(dirname(path));
  if (parent.kind !== 'dir' || parent.mount) throw new FsError('EINVAL', path);
  parent.children.set(basename(path), root);
}
