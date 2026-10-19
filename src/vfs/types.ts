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
}

export interface FileNode extends BaseNode {
  kind: 'file';
  content: string;
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
