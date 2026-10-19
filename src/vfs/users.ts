import type { VFS } from './vfs.ts';

export interface User {
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: number[];
}

export interface Group {
  name: string;
  gid: number;
  members: string[];
}

function rows(vfs: VFS, path: string): string[][] {
  const saved = vfs.cred;
  vfs.cred = { uid: 0, gid: 0, groups: [] };
  try {
    return vfs.readFile(path).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(':'));
  } catch {
    return [];
  } finally {
    vfs.cred = saved;
  }
}

export function listGroups(vfs: VFS): Group[] {
  return rows(vfs, '/etc/group').map(([name, , gid, members]) => ({
    name,
    gid: Number(gid),
    members: members ? members.split(',') : [],
  }));
}

export function listUsers(vfs: VFS): User[] {
  const groups = listGroups(vfs);
  return rows(vfs, '/etc/passwd').map(([name, , uid, gid, , home, shell]) => ({
    name,
    uid: Number(uid),
    gid: Number(gid),
    home,
    shell,
    groups: [Number(gid), ...groups.filter((g) => g.members.includes(name)).map((g) => g.gid)],
  }));
}

export function findUser(vfs: VFS, nameOrUid: string | number): User | undefined {
  return listUsers(vfs).find((u) => u.name === nameOrUid || u.uid === Number(nameOrUid));
}

export function findGroup(vfs: VFS, nameOrGid: string | number): Group | undefined {
  return listGroups(vfs).find((g) => g.name === nameOrGid || g.gid === Number(nameOrGid));
}

export function userName(vfs: VFS, uid: number): string {
  return findUser(vfs, uid)?.name ?? String(uid);
}

export function groupName(vfs: VFS, gid: number): string {
  return findGroup(vfs, gid)?.name ?? String(gid);
}
