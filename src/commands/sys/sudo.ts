import { runSource } from '../../shell/interpreter.ts';
import { dispatch } from '../../shell/simple.ts';
import type { Shell } from '../../shell/shell.ts';
import { findUser, type User } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail } from '../util.ts';
import { isProgram, leadingOpts, streams } from './exec.ts';
import { hostname } from './info.ts';
import { asUser, login, loginOrRunStdin } from './login.ts';

const SUDO_GID = 27;
const USAGE = 'usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n';

function mayRunAsRoot(ctx: Ctx): boolean {
  const user = findUser(ctx.vfs, ctx.shell.user.name) ?? ctx.shell.user;
  return user.uid === 0 || user.groups.includes(SUDO_GID);
}

function lookupTarget(ctx: Ctx, spec: string | true | undefined): User | undefined {
  if (typeof spec !== 'string') return findUser(ctx.vfs, 'root');
  return findUser(ctx.vfs, spec.startsWith('#') ? Number(spec.slice(1)) : spec);
}

function listPrivileges(ctx: Ctx): number {
  const { name } = ctx.shell.user;
  const host = hostname(ctx);
  ctx.stdout.write(`Matching Defaults entries for ${name} on ${host}:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin, use_pty\n\n`);
  ctx.stdout.write(`User ${name} may run the following commands on ${host}:\n    (ALL : ALL) ALL\n`);
  return 0;
}

function tagSudo(sub: Shell, caller: User, argv: string[]): void {
  sub.export('SUDO_USER', caller.name);
  sub.export('SUDO_UID', String(caller.uid));
  sub.export('SUDO_GID', String(caller.gid));
  sub.export('SUDO_COMMAND', argv.length ? argv.join(' ') : caller.shell);
}

async function sudo(ctx: Ctx): Promise<number> {
  const { opts, rest } = leadingOpts(ctx.args, {
    flags: 'isklvVKEHnSPAbN',
    values: 'ugpCDhTRU',
    long: { login: 'i', shell: 's', list: 'l', validate: 'v', version: 'V', 'reset-timestamp': 'k', 'remove-timestamp': 'K', 'preserve-env': 'E', 'non-interactive': 'n', stdin: 'S', 'user=': 'u', 'group=': 'g', 'prompt=': 'p' },
  });
  if (opts.V) return (ctx.stdout.write('Sudo version 1.9.15p5\nSudoers policy plugin version 1.9.15p5\n'), 0);
  if ((opts.k || opts.K) && !rest.length) return 0;
  const assigns: string[] = [];
  while (rest.length && /^[A-Za-z_]\w*=/.test(rest[0])) assigns.push(rest.shift()!);
  if (!rest.length && !opts.i && !opts.s && !opts.l && !opts.v) return (ctx.stderr.write(USAGE), 1);
  const caller = ctx.shell.user;
  if (!mayRunAsRoot(ctx)) return (ctx.stderr.write(`${caller.name} is not in the sudoers file.\n`), 1);
  if (opts.v) return 0;
  if (opts.l) return listPrivileges(ctx);
  const target = lookupTarget(ctx, opts.u);
  if (!target) return fail(ctx, `unknown user ${opts.u}`);
  if (!rest.length) {
    if (!ctx.shell.interactive && !ctx.stdin.isTTY) return loginOrRunStdin(ctx, target, opts.i ? target.home : undefined);
    login(ctx.shell, target, opts.i ? target.home : undefined);
    ctx.shell.export('SUDO_USER', caller.name);
    return 0;
  }
  const sub = asUser(ctx.shell, target);
  tagSudo(sub, caller, rest);
  for (const a of assigns) sub.export(a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1));
  if (opts.i) sub.cwd = target.home;
  try {
    if (!opts.i && !opts.s && !isProgram(rest[0], sub)) return fail(ctx, `${rest[0]}: command not found`);
    return await dispatch(rest, sub, streams(ctx));
  } finally {
    const { user } = ctx.shell;
    ctx.vfs.cred = { uid: user.uid, gid: user.gid, groups: user.groups };
  }
}

async function su(ctx: Ctx): Promise<number> {
  const args = [...ctx.args];
  let isLogin = false;
  let cmd: string | undefined;
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' || a === '-l' || a === '--login') isLogin = true;
    else if (a === '-c' || a === '--command') cmd = args[++i];
    else if (a.startsWith('--command=')) cmd = a.slice(10);
    else if (a === '-s' || a === '--shell') i++;
    else if (a === '-m' || a === '-p' || a === '--preserve-environment') continue;
    else if (a.startsWith('-')) return (ctx.stderr.write(`su: invalid option -- '${a.slice(1)}'\nTry 'su --help' for more information.\n`), 1);
    else if (name === undefined) name = a;
  }
  const target = findUser(ctx.vfs, name ?? 'root');
  if (!target) return fail(ctx, `user ${name} does not exist or the user entry does not contain all the required fields`);
  if (ctx.shell.user.uid !== 0) return fail(ctx, 'Authentication failure');
  if (target.shell.endsWith('nologin') || target.shell.endsWith('/false')) return (ctx.stdout.write('This account is currently not available.\n'), 1);
  if (cmd !== undefined) {
    const sub = asUser(ctx.shell, target);
    if (isLogin) sub.cwd = target.home;
    try {
      return await runSource(sub, cmd, streams(ctx), { subshell: true });
    } finally {
      const { user } = ctx.shell;
      ctx.vfs.cred = { uid: user.uid, gid: user.gid, groups: user.groups };
    }
  }
  return loginOrRunStdin(ctx, target, isLogin ? target.home : undefined);
}

export const sudoCommands: CommandTable = {
  sudo: { fn: command(sudo), desc: 'execute a command as another user' },
  su: { fn: su, desc: 'run a command with substitute user and group ID' },
};
