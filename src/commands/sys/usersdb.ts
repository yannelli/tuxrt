import type { VFS } from '../../vfs/vfs.ts';

const PASSWD = '/etc/passwd';
const GROUP = '/etc/group';
const SHADOW = '/etc/shadow';

export const daysSinceEpoch = () => Math.floor(Date.now() / 86_400_000);

/** Runs `fn` with root credentials, like the setuid passwd/chsh binaries. */
export function asRoot<T>(vfs: VFS, fn: () => T): T {
  const saved = vfs.cred;
  vfs.cred = { uid: 0, gid: 0, groups: [] };
  try {
    return fn();
  } finally {
    vfs.cred = saved;
  }
}

function rows(vfs: VFS, path: string): string[][] {
  return vfs.exists(path) ? vfs.readFile(path).split('\n').filter(Boolean).map((l) => l.split(':')) : [];
}

function edit(vfs: VFS, path: string, fn: (rows: string[][]) => string[][]): void {
  vfs.writeFile(path, fn(rows(vfs, path)).map((r) => `${r.join(':')}\n`).join(''));
}

/** Highest id in [min, max] plus one, the way useradd/groupadd allocate. */
export function nextId(used: number[], min = 1000, max = 59999): number {
  return Math.max(min - 1, ...used.filter((id) => id >= min && id <= max)) + 1;
}

export interface Account {
  name: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}

export function addUser(vfs: VFS, a: Account): void {
  edit(vfs, PASSWD, (r) => [...r, [a.name, 'x', String(a.uid), String(a.gid), a.gecos, a.home, a.shell]]);
  edit(vfs, SHADOW, (r) => [...r, [a.name, '!', String(daysSinceEpoch()), '0', '99999', '7', '', '', '']]);
}

export function addGroup(vfs: VFS, name: string, gid: number): void {
  edit(vfs, GROUP, (r) => [...r, [name, 'x', String(gid), '']]);
}

/** Adds `user` to `groups`; without `append` it is also dropped from every other group. */
export function setGroups(vfs: VFS, user: string, groups: string[], append: boolean): void {
  edit(vfs, GROUP, (r) =>
    r.map(([name, pw, gid, members = '']) => {
      let list = members.split(',').filter(Boolean);
      if (!append) list = list.filter((m) => m !== user);
      if (groups.includes(name) && !list.includes(user)) list.push(user);
      return [name, pw, gid, list.join(',')];
    }),
  );
}

const FIELDS = { name: 0, uid: 2, gid: 3, gecos: 4, home: 5, shell: 6 } as const;

export function updateUser(vfs: VFS, name: string, patch: Partial<Account>): void {
  edit(vfs, PASSWD, (r) =>
    r.map((row) => {
      if (row[0] !== name) return row;
      const out = [...row];
      for (const [k, v] of Object.entries(patch)) out[FIELDS[k as keyof Account]] = String(v);
      return out;
    }),
  );
  if (patch.name && patch.name !== name) {
    edit(vfs, SHADOW, (r) => r.map((row) => (row[0] === name ? [patch.name!, ...row.slice(1)] : row)));
    edit(vfs, GROUP, (r) => r.map(([g, pw, gid, members = '']) => [g, pw, gid, members.split(',').map((m) => (m === name ? patch.name! : m)).join(',')]));
  }
}

export function removeUser(vfs: VFS, name: string): void {
  edit(vfs, PASSWD, (r) => r.filter((row) => row[0] !== name));
  edit(vfs, SHADOW, (r) => r.filter((row) => row[0] !== name));
  setGroups(vfs, name, [], false);
}

export function removeGroup(vfs: VFS, name: string): void {
  edit(vfs, GROUP, (r) => r.filter((row) => row[0] !== name));
}

export function shadowEntry(vfs: VFS, name: string): string[] | undefined {
  return asRoot(vfs, () => rows(vfs, SHADOW).find((r) => r[0] === name));
}

export function setPassword(vfs: VFS, name: string, update: (hash: string) => string): void {
  asRoot(vfs, () =>
    edit(vfs, SHADOW, (r) => {
      const known = r.some((row) => row[0] === name);
      const all = known ? r : [...r, [name, '!', '0', '0', '99999', '7', '', '', '']];
      return all.map((row) => (row[0] === name ? [name, update(row[1] ?? ''), String(daysSinceEpoch()), ...row.slice(3)] : row));
    }),
  );
}

/** `rm -r` without the command around it, for userdel -r. */
export function removeTree(vfs: VFS, path: string): void {
  if (vfs.lookup(path, false).kind === 'dir') {
    for (const child of vfs.readdir(path)) removeTree(vfs, `${path}/${child}`);
    vfs.rmdir(path);
  } else vfs.unlink(path);
}
