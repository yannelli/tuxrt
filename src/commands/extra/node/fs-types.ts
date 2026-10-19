import type { Stat } from '../../../vfs/types.ts';

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const typeBits = { file: S_IFREG, dir: S_IFDIR, symlink: S_IFLNK };

export class Stats {
  dev = 2049;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev = 0;
  size: number;
  blksize = 4096;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor(st: Stat) {
    this.ino = st.ino;
    this.mode = typeBits[st.kind] | st.mode;
    this.nlink = st.nlink;
    this.uid = st.uid;
    this.gid = st.gid;
    this.size = st.size;
    this.blocks = Math.ceil(st.size / 4096) * 8;
    this.atimeMs = this.mtimeMs = st.mtime;
    this.ctimeMs = st.ctime;
    this.birthtimeMs = Math.min(st.mtime, st.ctime);
    this.atime = new Date(st.mtime);
    this.mtime = new Date(st.mtime);
    this.ctime = new Date(st.ctime);
    this.birthtime = new Date(this.birthtimeMs);
  }

  isFile(): boolean {
    return (this.mode & S_IFMT) === S_IFREG;
  }

  isDirectory(): boolean {
    return (this.mode & S_IFMT) === S_IFDIR;
  }

  isSymbolicLink(): boolean {
    return (this.mode & S_IFMT) === S_IFLNK;
  }

  isFIFO(): boolean {
    return false;
  }

  isSocket(): boolean {
    return false;
  }

  isBlockDevice(): boolean {
    return false;
  }

  isCharacterDevice(): boolean {
    return false;
  }
}

export class Dirent {
  name: string;
  parentPath: string;
  path: string;
  private readonly kind: Stat['kind'];

  constructor(name: string, parentPath: string, kind: Stat['kind']) {
    this.name = name;
    this.parentPath = this.path = parentPath;
    this.kind = kind;
  }

  isFile(): boolean {
    return this.kind === 'file';
  }

  isDirectory(): boolean {
    return this.kind === 'dir';
  }

  isSymbolicLink(): boolean {
    return this.kind === 'symlink';
  }

  isFIFO(): boolean {
    return false;
  }

  isSocket(): boolean {
    return false;
  }

  isBlockDevice(): boolean {
    return false;
  }

  isCharacterDevice(): boolean {
    return false;
  }
}
