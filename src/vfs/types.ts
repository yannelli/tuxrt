export interface Cred {
  uid: number;
  gid: number;
  groups: number[];
}

interface BaseNode {
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  mtime: number;
  ctime: number;
  /** Set on nodes backed by a host directory (see hostfs.ts); undefined for the in-memory filesystem. */
  mount?: object;
}

export interface FileNode extends BaseNode {
  kind: 'file';
  content: string;
  /** Byte size when it is known without reading `content` (host-backed files). */
  readonly size?: number;
  /** Dynamic content (procfs, devices). Writes go to `sink` when present. */
  generate?: () => string;
  sink?: (data: string) => void;
}

export interface DirNode extends BaseNode {
  kind: 'dir';
  children: Map<string, VNode>;
}

export interface LinkNode extends BaseNode {
  kind: 'symlink';
  target: string;
}

export type VNode = FileNode | DirNode | LinkNode;

export interface Stat {
  kind: VNode['kind'];
  ino: number;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  nlink: number;
  mtime: number;
  ctime: number;
}
