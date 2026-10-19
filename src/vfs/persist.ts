import { installStubs, mountVirtual } from './bootstrap.ts';
import type { VNode } from './types.ts';
import { VFS } from './vfs.ts';

type Meta = { m: number; u: number; g: number; t: number };
type SNode = (Meta & { k: 'f'; c: string }) | (Meta & { k: 'd'; e: Record<string, SNode> }) | (Meta & { k: 'l'; l: string });

interface Snapshot {
  version: 1;
  umask: number;
  root: SNode;
}

/** Virtual mounts are regenerated on restore rather than saved; host mounts are the host's to re-attach. */
const VIRTUAL = new Set(['/proc', '/dev']);

export function snapshot(vfs: VFS): string {
  const save = (node: VNode, path: string): SNode => {
    const meta = { m: node.mode, u: node.uid, g: node.gid, t: node.mtime };
    if (node.kind === 'file') return { ...meta, k: 'f', c: node.content };
    if (node.kind === 'symlink') return { ...meta, k: 'l', l: node.target };
    const e: Record<string, SNode> = {};
    for (const [name, child] of node.children) {
      const childPath = `${path === '/' ? '' : path}/${name}`;
      if (!VIRTUAL.has(childPath) && !child.mount) e[name] = save(child, childPath);
    }
    return { ...meta, k: 'd', e };
  };
  const snap: Snapshot = { version: 1, umask: vfs.umask, root: save(vfs.root, '/') };
  return JSON.stringify(snap);
}

export function restore(json: string, commands: Iterable<string>, tty: (d: string) => void = () => {}): VFS {
  const snap = JSON.parse(json) as Snapshot;
  if (snap.version !== 1) throw new Error(`unsupported snapshot version ${snap.version}`);
  const vfs = new VFS();
  const load = (s: SNode): VNode => {
    const node: VNode =
      s.k === 'f' ? vfs.newFile(s.c, s.m) : s.k === 'l' ? vfs.newLink(s.l) : vfs.newDir(s.m);
    if (node.kind === 'dir' && s.k === 'd') for (const [name, child] of Object.entries(s.e)) node.children.set(name, load(child));
    Object.assign(node, { uid: s.u, gid: s.g, mtime: s.t });
    return node;
  };
  vfs.root = load(snap.root) as VFS['root'];
  installStubs(vfs, commands);
  mountVirtual(vfs, tty);
  vfs.umask = snap.umask;
  return vfs;
}
