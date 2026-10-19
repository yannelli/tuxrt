import { Runtime, type ExecResult } from '../src/runtime.ts';

/** Boots a fresh machine and returns a runner bound to it. State persists across calls on the same runner. */
export async function machine(user?: string): Promise<(cmd: string, stdin?: string) => Promise<ExecResult>> {
  const rt = await Runtime.boot({ user });
  return (cmd, stdin) => rt.exec(cmd, stdin);
}

/** One-shot: run a command on a fresh machine. */
export async function sh(cmd: string, stdin?: string): Promise<ExecResult> {
  return (await machine())(cmd, stdin);
}
