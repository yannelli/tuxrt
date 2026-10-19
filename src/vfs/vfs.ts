import { FsError } from './errors.ts';
import { basename, dirname, normalize, split } from './path.ts';
import type { Cred, DirNode, FileNode, LinkNode, Stat, VNode } from './types.ts';

const R = 4;
const W = 2;
const X = 1;
const MAX_LINKS = 40;

export class VFS {
  root: DirNode;
  cred: Cred = { uid: 0, gid: 0, groups: [] };
  umask = 0o022;
  /** Boxed so views created by `view()` share one inode counter with the base filesystem. */
  private readonly inodes = { next: 1 };

  constructor() {
    this.root = this.newDir(0o755);
  }

  private base(mode: number) {
    const now = Date.now();
    return { ino: this.inodes.next++, mode, nlink: 1, uid: this.cred.uid, gid: this.cred.gid, mtime: now, ctime: now };
  }

  newDir(mode = 0o777 & ~this.umask): DirNode {
    return { ...this.base(mode), kind: 'dir', children: new Map() };
  }

  newFile(content = '', mode = 0o666 & ~this.umask): FileNode {
    return { ...this.base(mode), kind: 'file', content };
  }

  newLink(target: string): LinkNode {
    return { ...this.base(0o777), kind: 'symlink', target };
  }

  /** Same tree and state, separate credentials and umask: one per shell/process, like Linux. */
  view(cred: Cred): VFS {
    const v = Object.create(this) as VFS;
    v.cred = { ...cred, groups: [...cred.groups] };
    return v;
  }

  can(node: VNode, want: number): boolean {
    const { uid, gid, groups } = this.cred;
    if (uid === 0) return want !== X || node.kind === 'dir' || (node.mode & 0o111) !== 0;
    const shift = node.uid === uid ? 6 : node.gid === gid || groups.includes(node.gid) ? 3 : 0;
    return ((node.mode >> shift) & want) === want;
  }

  private check(node: VNode, want: number, path: string): void {
    if (!this.can(node, want)) throw new FsError('EACCES', path);
  }

  /** Resolves an absolute path, following symlinks (the last component only if `follow`). */
  lookup(path: string, follow = true): VNode {
    let parts = split(normalize(path));
    let node: VNode = this.root;
    let hops = 0;
    for (let i = 0; i < parts.length; i++) {
      if (node.kind !== 'dir') throw new FsError('ENOTDIR', path);
      this.check(node, X, path);
      const child = node.children.get(parts[i]);
      if (!child) throw new FsError('ENOENT', path);
      const isLast = i === parts.length - 1;
      if (child.kind === 'symlink' && (!isLast || follow)) {
        if (++hops > MAX_LINKS) throw new FsError('ELOOP', path);
        const here = `/${parts.slice(0, i).join('/')}`;
        const rest = parts.slice(i + 1).join('/');
        parts = split(normalize(`${child.target}/${rest}`, here));
        node = this.root;
        i = -1;
        continue;
      }
      node = child;
    }
    return node;
  }

  tryLookup(path: string, follow = true): VNode | null {
    try {
      return this.lookup(path, follow);
    } catch {
      return null;
    }
  }

  exists(path: string): boolean {
    return this.tryLookup(path) !== null;
  }

  isDir(path: string): boolean {
    return this.tryLookup(path)?.kind === 'dir';
  }

  access(path: string, want: 'r' | 'w' | 'x'): boolean {
    const node = this.tryLookup(path);
    return node !== null && this.can(node, want === 'r' ? R : want === 'w' ? W : X);
  }

  realpath(path: string): string {
    const out: string[] = [];
    let parts = split(normalize(path));
    let hops = 0;
    while (parts.length) {
      const name = parts.shift()!;
      const node = this.lookup(`/${[...out, name].join('/')}`, false);
      if (node.kind === 'symlink') {
        if (++hops > MAX_LINKS) throw new FsError('ELOOP', path);
        const target = normalize(node.target, `/${out.join('/')}`);
        parts = [...split(target), ...parts];
        out.length = 0;
      } else out.push(name);
    }
    return `/${out.join('/')}`;
  }

  private parentOf(path: string): { dir: DirNode; name: string } {
    const abs = normalize(path);
    const name = basename(abs);
    if (abs === '/') throw new FsError('EBUSY', path);
    const dir = this.lookup(dirname(abs));
    if (dir.kind !== 'dir') throw new FsError('ENOTDIR', path);
    return { dir, name };
  }

  /** In a sticky directory (/tmp) only root, the directory owner or the entry owner may remove it. */
  private checkSticky(dir: DirNode, node: VNode, path: string): void {
    const { uid } = this.cred;
    if (dir.mode & 0o1000 && uid !== 0 && uid !== dir.uid && uid !== node.uid) throw new FsError('EPERM', path);
  }

  private insert(path: string, node: VNode): void {
    const { dir, name } = this.parentOf(path);
    this.check(dir, W | X, path);
    if (dir.children.has(name)) throw new FsError('EEXIST', path);
    dir.children.set(name, node);
    dir.mtime = Date.now();
  }

  stat(path: string, follow = true): Stat {
    const n = this.lookup(path, follow);
    const size =
      n.kind === 'dir' ? 4096 : n.kind === 'symlink' ? n.target.length : n.generate ? 0 : Buffer.byteLength(n.content);
    const nlink = n.kind === 'dir' ? 2 + [...n.children.values()].filter((c) => c.kind === 'dir').length : n.nlink;
    return { kind: n.kind, ino: n.ino, mode: n.mode, uid: n.uid, gid: n.gid, size, nlink, mtime: n.mtime, ctime: n.ctime };
  }

  readFile(path: string): string {
    const node = this.lookup(path);
    if (node.kind === 'dir') throw new FsError('EISDIR', path);
    if (node.kind !== 'file') throw new FsError('EINVAL', path);
    this.check(node, R, path);
    return node.generate ? node.generate() : node.content;
  }

  writeFile(path: string, data: string, append = false): void {
    const node = this.tryLookup(path);
    if (!node) {
      this.insert(this.resolveDangling(path), this.newFile(data));
      return;
    }
    if (node.kind === 'dir') throw new FsError('EISDIR', path);
    if (node.kind !== 'file') throw new FsError('EINVAL', path);
    this.check(node, W, path);
    if (node.sink) return node.sink(data);
    if (node.generate) throw new FsError('EACCES', path);
    node.content = append ? node.content + data : data;
    node.mtime = node.ctime = Date.now();
  }

  /** Writing through a dangling symlink creates its target, like Linux. */
  private resolveDangling(path: string): string {
    const link = this.tryLookup(path, false);
    return link?.kind === 'symlink' ? normalize(link.target, dirname(normalize(path))) : path;
  }

  mkdir(path: string, parents = false, mode?: number): void {
    if (parents) {
      let cur = '';
      for (const part of split(normalize(path))) {
        cur += `/${part}`;
        const node = this.tryLookup(cur);
        if (node && node.kind !== 'dir') throw new FsError('ENOTDIR', cur);
        if (!node) this.insert(cur, this.newDir(mode));
      }
      return;
    }
    this.insert(path, this.newDir(mode));
  }

  readdir(path: string): string[] {
    const node = this.lookup(path);
    if (node.kind !== 'dir') throw new FsError('ENOTDIR', path);
    this.check(node, R, path);
    return [...node.children.keys()].sort();
  }

  unlink(path: string): void {
    const { dir, name } = this.parentOf(path);
    const node = dir.children.get(name);
    if (!node) throw new FsError('ENOENT', path);
    if (node.kind === 'dir') throw new FsError('EISDIR', path);
    this.check(dir, W | X, path);
    this.checkSticky(dir, node, path);
    dir.children.delete(name);
    node.nlink--;
  }

  rmdir(path: string): void {
    const { dir, name } = this.parentOf(path);
    const node = dir.children.get(name);
    if (!node) throw new FsError('ENOENT', path);
    if (node.kind !== 'dir') throw new FsError('ENOTDIR', path);
    if (node.children.size) throw new FsError('ENOTEMPTY', path);
    this.check(dir, W | X, path);
    this.checkSticky(dir, node, path);
    dir.children.delete(name);
  }

  rename(from: string, to: string): void {
    const src = this.parentOf(from);
    const node = src.dir.children.get(src.name);
    if (!node) throw new FsError('ENOENT', from);
    if (node.kind === 'dir' && `${normalize(to)}/`.startsWith(`${normalize(from)}/`)) throw new FsError('EINVAL', to);
    const dst = this.parentOf(to);
    this.check(src.dir, W | X, from);
    this.check(dst.dir, W | X, to);
    this.checkSticky(src.dir, node, from);
    const existing = dst.dir.children.get(dst.name);
    if (existing === node) return;
    if (existing?.kind === 'dir' && (node.kind !== 'dir' || existing.children.size)) {
      throw new FsError(node.kind === 'dir' ? 'ENOTEMPTY' : 'EISDIR', to);
    }
    if (existing && existing.kind !== 'dir' && node.kind === 'dir') throw new FsError('ENOTDIR', to);
    if (existing) {
      this.checkSticky(dst.dir, existing, to);
      existing.nlink--;
    }
    src.dir.children.delete(src.name);
    dst.dir.children.set(dst.name, node);
    node.ctime = Date.now();
  }

  symlink(target: string, path: string): void {
    this.insert(path, this.newLink(target));
  }

  link(existing: string, path: string): void {
    const node = this.lookup(existing);
    if (node.kind === 'dir') throw new FsError('EPERM', existing);
    this.insert(path, node);
    node.nlink++;
  }

  readlink(path: string): string {
    const node = this.lookup(path, false);
    if (node.kind !== 'symlink') throw new FsError('EINVAL', path);
    return node.target;
  }

  chmod(path: string, mode: number): void {
    const node = this.lookup(path);
    if (this.cred.uid !== 0 && node.uid !== this.cred.uid) throw new FsError('EPERM', path);
    node.mode = mode & 0o7777;
    node.ctime = Date.now();
  }

  chown(path: string, uid: number, gid: number, follow = true): void {
    const node = this.lookup(path, follow);
    const { uid: me, gid: myGid, groups } = this.cred;
    // Owners may change the group to one they belong to (chgrp); only root may change the owner.
    const ownerChgrp = uid === node.uid && node.uid === me && (gid === myGid || groups.includes(gid));
    if (me !== 0 && !ownerChgrp) throw new FsError('EPERM', path);
    node.uid = uid;
    node.gid = gid;
    node.ctime = Date.now();
  }

  touch(path: string, time = Date.now()): void {
    const node = this.tryLookup(path);
    if (!node) {
      this.writeFile(path, '');
      this.lookup(path).mtime = time;
      return;
    }
    if (this.cred.uid !== 0 && node.uid !== this.cred.uid && !this.can(node, W)) throw new FsError('EACCES', path);
    node.mtime = time;
  }
}
