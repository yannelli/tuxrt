import { randomBytes } from 'node:crypto';
import { createHome } from '../../vfs/bootstrap.ts';
import { findGroup, findUser, listGroups, listUsers } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { addGroup, addUser, asRoot, nextId, removeGroup, removeTree, removeUser, setGroups, setPassword, shadowEntry, updateUser } from './usersdb.ts';

const NAME = /^[a-z_][a-z0-9_-]*\$?$/;

function denied(ctx: Ctx, file = '/etc/passwd', code = 1): number {
  ctx.stderr.write(`${ctx.name}: Permission denied.\n${ctx.name}: cannot lock ${file}; try again later.\n`);
  return code;
}

const err = (ctx: Ctx, msg: string, code: number) => (ctx.stderr.write(`${ctx.name}: ${msg}\n`), code);

interface NewUser {
  name: string;
  uid?: string;
  group?: string;
  groups: string[];
  gecos: string;
  home?: string;
  shell: string;
  makeHome: boolean;
  system: boolean;
}

/** Shared by useradd and adduser: validates, then writes passwd, shadow, group and the home directory. */
function createUser(ctx: Ctx, s: NewUser): number {
  const { vfs } = ctx;
  if (!NAME.test(s.name)) return err(ctx, `invalid user name '${s.name}': use --badname to ignore`, 3);
  if (findUser(vfs, s.name)) return err(ctx, `user '${s.name}' already exists`, 9);
  let gid = s.group === undefined ? undefined : findGroup(vfs, s.group)?.gid;
  if (s.group !== undefined && gid === undefined) return err(ctx, `group '${s.group}' does not exist`, 6);
  if (gid === undefined && findGroup(vfs, s.name)) return err(ctx, `group ${s.name} exists - if you want to add this user to that group, use -g.`, 9);
  const missing = s.groups.find((g) => !findGroup(vfs, g));
  if (missing) return err(ctx, `group '${missing}' does not exist`, 6);
  const [min, max] = s.system ? [100, 999] : [1000, 59999];
  const uid = s.uid !== undefined ? Number(s.uid) : nextId(listUsers(vfs).map((u) => u.uid), min, max);
  if (listUsers(vfs).some((u) => u.uid === uid)) return err(ctx, `UID ${uid} is not unique`, 4);
  if (gid === undefined) {
    const gids = listGroups(vfs).map((g) => g.gid);
    gid = gids.includes(uid) ? nextId(gids, min, max) : uid;
    addGroup(vfs, s.name, gid);
  }
  const home = s.home ?? `/home/${s.name}`;
  addUser(vfs, { name: s.name, uid, gid, gecos: s.gecos, home, shell: s.shell });
  if (s.groups.length) setGroups(vfs, s.name, s.groups, true);
  if (s.makeHome && vfs.exists(home)) ctx.stderr.write(`${ctx.name}: warning: the home directory ${home} already exists.\n`);
  else if (s.makeHome) createHome(vfs, { uid, gid, home });
  return 0;
}

function useradd(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'mMrUNl',
    values: 'dsugGcepkK',
    long: {
      'create-home': 'm', 'no-create-home': 'M', system: 'r', 'user-group': 'U', 'no-user-group': 'N', 'home-dir=': 'd', 'shell=': 's',
      'uid=': 'u', 'gid=': 'g', 'groups=': 'G', 'comment=': 'c', 'expiredate=': 'e', 'password=': 'p', 'skel=': 'k',
    },
  });
  if (ctx.shell.user.uid !== 0) return denied(ctx);
  if (operands.length !== 1) return err(ctx, 'Usage: useradd [options] LOGIN', 2);
  const str = (k: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : undefined);
  return createUser(ctx, {
    name: operands[0], uid: str('u'), group: str('g'), groups: str('G')?.split(',').filter(Boolean) ?? [], gecos: str('c') ?? '',
    home: str('d'), shell: str('s') ?? '/bin/sh', makeHome: !!opts.m, system: !!opts.r,
  });
}

function adduser(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'qD',
    long: {
      system: 'system', 'home=': 'home', 'shell=': 'shell', 'disabled-password': 'np', 'disabled-login': 'np', 'gecos=': 'gecos',
      'comment=': 'gecos', 'ingroup=': 'ingroup', 'uid=': 'uid', 'no-create-home': 'nohome', quiet: 'q', 'allow-bad-names': 'bad',
    },
  });
  if (ctx.shell.user.uid !== 0) return (ctx.stderr.write('fatal: Only root may add a user or group to the system.\n'), 1);
  const [name, group] = operands;
  if (!name) return (ctx.stderr.write('fatal: Only one or two names allowed.\n'), 1);
  const say = (msg: string) => opts.q || ctx.stdout.write(`info: ${msg}\n`);
  if (group !== undefined) {
    if (!findUser(ctx.vfs, name)) return (ctx.stderr.write(`fatal: The user \`${name}' does not exist.\n`), 1);
    const g = findGroup(ctx.vfs, group);
    if (!g) return (ctx.stderr.write(`fatal: The group \`${group}' does not exist.\n`), 1);
    if (g.members.includes(name)) return (say(`The user \`${name}' is already a member of \`${group}'.`), 0);
    say(`Adding user \`${name}' to group \`${group}' ...`);
    setGroups(ctx.vfs, name, [group], true);
    return 0;
  }
  if (findUser(ctx.vfs, name)) return (ctx.stderr.write(`fatal: The user \`${name}' already exists.\n`), 1);
  const str = (k: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : undefined);
  const system = !!opts.system;
  say(`Adding ${system ? 'system ' : ''}user \`${name}' ...`);
  const code = createUser(ctx, {
    name, uid: str('uid'), group: str('ingroup') ?? (system ? 'nogroup' : undefined), groups: system ? [] : ['users'], gecos: str('gecos') ?? '',
    home: str('home') ?? (system ? '/nonexistent' : undefined), shell: str('shell') ?? (system ? '/usr/sbin/nologin' : '/bin/bash'),
    makeHome: !system && !opts.nohome, system,
  });
  if (code) return code;
  const user = findUser(ctx.vfs, name)!;
  if (!str('ingroup') && !system) say(`Selecting UID/GID from range 1000 to 59999 ...\ninfo: Adding new group \`${name}' (${user.gid}) ...`);
  say(`Adding new user \`${name}' (${user.uid}) with group \`${findGroup(ctx.vfs, user.gid)?.name} (${user.gid})' ...`);
  if (!system && !opts.nohome) say(`Creating home directory \`${user.home}' ...\ninfo: Copying files from \`/etc/skel' ...`);
  if (!system) say(`Adding new user \`${name}' to supplemental / extra groups \`users' ...\ninfo: Adding user \`${name}' to group \`users' ...`);
  return 0;
}

function userdel(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'rf', long: { remove: 'r', force: 'f' } });
  if (ctx.shell.user.uid !== 0) return denied(ctx);
  const user = operands[0] === undefined ? undefined : findUser(ctx.vfs, operands[0]);
  if (!user) return err(ctx, `user '${operands[0]}' does not exist`, 6);
  const busy = [...ctx.shell.kernel.procs.procs.values()].find((p) => p.uid === user.uid);
  if (busy && !opts.f) return err(ctx, `user ${user.name} is currently used by process ${busy.pid}`, 8);
  removeUser(ctx.vfs, user.name);
  const own = findGroup(ctx.vfs, user.gid);
  if (own?.name === user.name && !own.members.length && !listUsers(ctx.vfs).some((u) => u.gid === own.gid)) removeGroup(ctx.vfs, own.name);
  if (opts.r) {
    ctx.stderr.write(`userdel: ${user.name} mail spool (/var/mail/${user.name}) not found\n`);
    if (ctx.vfs.exists(user.home)) removeTree(ctx.vfs, user.home);
    else ctx.stderr.write(`userdel: ${user.name} home directory (${user.home}) not found\n`);
  }
  return 0;
}

function usermod(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'amLU',
    values: 'GsdlcguP',
    long: { append: 'a', 'groups=': 'G', 'shell=': 's', 'home=': 'd', 'move-home': 'm', 'login=': 'l', 'comment=': 'c', 'gid=': 'g', 'uid=': 'u', lock: 'L', unlock: 'U' },
  });
  if (ctx.shell.user.uid !== 0) return denied(ctx);
  const user = operands[0] === undefined ? undefined : findUser(ctx.vfs, operands[0]);
  if (!user) return err(ctx, `user '${operands[0]}' does not exist`, 6);
  if (opts.a && !opts.G) return err(ctx, '-a flag is ONLY allowed with the -G flag', 2);
  const str = (k: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : undefined);
  const groups = str('G')?.split(',').filter(Boolean);
  const missing = [...(groups ?? []), ...(str('g') ? [str('g')!] : [])].find((g) => !findGroup(ctx.vfs, g));
  if (missing) return err(ctx, `group '${missing}' does not exist`, 6);
  if (groups) setGroups(ctx.vfs, user.name, groups, !!opts.a);
  const patch: Record<string, string | number> = {};
  if (str('g')) patch.gid = findGroup(ctx.vfs, str('g')!)!.gid;
  if (str('s')) patch.shell = str('s')!;
  if (str('c') !== undefined) patch.gecos = str('c')!;
  if (str('u')) patch.uid = Number(str('u'));
  if (str('d')) {
    patch.home = str('d')!;
    if (opts.m && ctx.vfs.exists(user.home)) ctx.vfs.rename(user.home, patch.home);
  }
  if (str('l')) {
    if (findUser(ctx.vfs, str('l')!)) return err(ctx, `user '${str('l')}' already exists`, 9);
    patch.name = str('l')!;
  }
  if (opts.L || opts.U) setPassword(ctx.vfs, user.name, (h) => (opts.L ? `!${h.replace(/^!/, '')}` : h.replace(/^!/, '')));
  updateUser(ctx.vfs, user.name, patch);
  return 0;
}

function groupadd(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'rf', values: 'gK', long: { 'gid=': 'g', system: 'r', force: 'f' } });
  if (ctx.shell.user.uid !== 0) return denied(ctx, '/etc/group', 10);
  const [name] = operands;
  if (!name) return err(ctx, 'Usage: groupadd [options] GROUP', 2);
  if (!NAME.test(name)) return err(ctx, `'${name}' is not a valid group name`, 3);
  if (findGroup(ctx.vfs, name)) return opts.f ? 0 : err(ctx, `group '${name}' already exists`, 9);
  const gids = listGroups(ctx.vfs).map((g) => g.gid);
  const gid = typeof opts.g === 'string' ? Number(opts.g) : opts.r ? nextId(gids, 100, 999) : nextId(gids);
  if (gids.includes(gid)) return err(ctx, `GID '${gid}' already exists`, 4);
  addGroup(ctx.vfs, name, gid);
  return 0;
}

function groupdel(ctx: Ctx): number {
  if (ctx.shell.user.uid !== 0) return denied(ctx, '/etc/group', 10);
  const [name] = ctx.args;
  const group = name === undefined ? undefined : findGroup(ctx.vfs, name);
  if (!group || /^\d+$/.test(name)) return err(ctx, `group '${name}' does not exist`, 6);
  const primary = listUsers(ctx.vfs).find((u) => u.gid === group.gid);
  if (primary) return err(ctx, `cannot remove the primary group of user '${primary.name}'`, 8);
  removeGroup(ctx.vfs, group.name);
  return 0;
}

function passwd(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'Sludea', long: { status: 'S', lock: 'l', unlock: 'u', delete: 'd', expire: 'e', all: 'a' } });
  const name = operands[0] ?? ctx.shell.user.name;
  const root = ctx.shell.user.uid === 0;
  if (!findUser(ctx.vfs, name)) return err(ctx, `user '${name}' does not exist`, 1);
  if (!root && name !== ctx.shell.user.name) return err(ctx, `You may not view or modify password information for ${name}.`, 1);
  if (opts.S) {
    const [, hash = '!', days = '0', min = '0', max = '99999', warn = '7', inactive = ''] = shadowEntry(ctx.vfs, name) ?? [];
    const state = hash.startsWith('!') || hash === '*' ? 'L' : hash ? 'P' : 'NP';
    const changed = new Date(Number(days) * 86_400_000).toISOString().slice(0, 10);
    ctx.stdout.write(`${name} ${state} ${changed} ${min} ${max} ${warn} ${inactive || -1}\n`);
    return 0;
  }
  if ((opts.l || opts.u || opts.d || opts.e) && !root) return err(ctx, 'Permission denied.', 1);
  const fresh = `$y$j9T$${randomBytes(12).toString('base64')}`;
  setPassword(ctx.vfs, name, (h) => (opts.l ? `!${h.replace(/^!/, '')}` : opts.u ? h.replace(/^!/, '') : opts.d ? '' : opts.e ? h : fresh));
  ctx.stdout.write(opts.l || opts.u || opts.d || opts.e ? 'passwd: password changed.\n' : 'passwd: password updated successfully\n');
  return 0;
}

function chsh(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { values: 's', long: { 'shell=': 's' } });
  const name = operands[0] ?? ctx.shell.user.name;
  const user = findUser(ctx.vfs, name);
  if (!user) return err(ctx, `user '${name}' does not exist`, 1);
  if (ctx.shell.user.uid !== 0 && name !== ctx.shell.user.name) return err(ctx, `You may not change the shell for '${name}'.`, 1);
  if (typeof opts.s !== 'string') return (ctx.stdout.write(`Changing the login shell for ${name}\n`), 0);
  const valid = ctx.vfs.readFile('/etc/shells').split('\n').includes(opts.s);
  if (!valid && ctx.shell.user.uid !== 0) return err(ctx, `${opts.s} is an invalid shell`, 1);
  asRoot(ctx.vfs, () => updateUser(ctx.vfs, name, { shell: opts.s as string }));
  return 0;
}

export const userAdminCommands: CommandTable = {
  useradd: { fn: command(useradd), desc: 'create a user account (low level)' },
  adduser: { fn: command(adduser), desc: 'create a user or group, with defaults' },
  userdel: { fn: command(userdel), desc: 'remove a user account' },
  usermod: { fn: command(usermod), desc: 'modify a user account' },
  groupadd: { fn: command(groupadd), desc: 'create a new group' },
  groupdel: { fn: command(groupdel), desc: 'delete a group' },
  passwd: { fn: command(passwd), desc: 'change user password' },
  chsh: { fn: command(chsh), desc: 'change login shell' },
};
