import type { Shell } from '../../shell/shell.ts';
import type { User } from '../../vfs/users.ts';
import { programShell } from './exec.ts';

const origins = new WeakMap<Shell, Shell>();

/** A forked shell running as `user` (sudo). `su` inside it switches the shell sudo was invoked from. */
export function asUser(shell: Shell, user: User): Shell {
  const sub = programShell(shell);
  sub.applyUser(user);
  origins.set(sub, origins.get(shell) ?? shell);
  return sub;
}

/** Starts a nested login session (`su`, `sudo -i`); the `exit` builtin pops it. */
export function login(shell: Shell, user: User, cwd?: string): void {
  const target = origins.get(shell) ?? shell;
  target.logins.push({ user: target.user, cwd: target.cwd, vars: new Map(target.vars) });
  target.applyUser(user);
  if (cwd) target.cwd = cwd;
}

/** The user who logged in on this terminal, before any su/sudo -i. */
export function loginUser(shell: Shell): User {
  const target = origins.get(shell) ?? shell;
  return target.logins[0]?.user ?? target.user;
}
