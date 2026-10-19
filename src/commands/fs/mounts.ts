import { machine } from '../../vfs/machine.ts';
import { split } from '../../vfs/path.ts';
import type { VNode } from '../../vfs/types.ts';
import type { VFS } from '../../vfs/vfs.ts';

export interface Mount {
  source: string;
  type: string;
  target: string;
  dev: [number, number];
  sizeKb: number;
  /** Space taken by things outside the VFS (the installed OS, runtime state). */
  baseKb: number;
  /** Pseudo filesystems df only shows when asked (-a or a path on them). */
  hidden?: boolean;
}

/** In df's order on an Ubuntu 24.04 cloud VM. */
export function mounts(): Mount[] {
  return [
    { source: 'tmpfs', type: 'tmpfs', target: '/run', dev: [0, 25], sizeKb: Math.round(machine.memKb / 10), baseKb: 1004 },
    { source: '/dev/sda1', type: 'ext4', target: '/', dev: [8, 1], sizeKb: machine.diskKb, baseKb: 2_202_016 },
    { source: 'tmpfs', type: 'tmpfs', target: '/dev/shm', dev: [0, 26], sizeKb: Math.round(machine.memKb / 2), baseKb: 0 },
    { source: 'udev', type: 'devtmpfs', target: '/dev', dev: [0, 5], sizeKb: Math.round(machine.memKb / 2), baseKb: 0, hidden: true },
    { source: 'proc', type: 'proc', target: '/proc', dev: [0, 22], sizeKb: 0, baseKb: 0, hidden: true },
  ];
}

export function mountOf(path: string): Mount {
  const inside = (m: Mount) => m.target === '/' || path === m.target || path.startsWith(`${m.target}/`);
  return mounts().filter(inside).sort((a, b) => b.target.length - a.target.length)[0];
}

/** KiB allocated under a mount point, read straight from the node tree so permissions don't skew it. */
export function usedKb(vfs: VFS, m: Mount): number {
  let node: VNode | undefined = vfs.root;
  for (const part of split(m.target)) node = node?.kind === 'dir' ? node.children.get(part) : undefined;
  const others = new Set(mounts().map((o) => o.target).filter((t) => t !== m.target));
  const size = (n: VNode, path: string): number => {
    if (n.kind === 'symlink') return 0;
    if (n.kind === 'file') return n.generate ? 0 : Math.ceil(Buffer.byteLength(n.content) / 4096) * 4;
    let kb = path === m.target ? 0 : 4;
    for (const [name, child] of n.children) {
      const childPath = `${path === '/' ? '' : path}/${name}`;
      if (!others.has(childPath)) kb += size(child, childPath);
    }
    return kb;
  };
  return m.type === 'proc' ? 0 : m.baseKb + (node ? size(node, m.target) : 0);
}
