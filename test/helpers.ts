import { Runtime, type ExecResult } from '../src/runtime.ts';

/** `npm run test:portable` (or TUXRT_PLATFORM=portable) runs the suite on the plain-ECMAScript platform JavaScriptCore hosts get. */
export const portable = process.env.TUXRT_PLATFORM === 'portable' || process.env.npm_lifecycle_event === 'test:portable';
if (!portable) await import('../src/node.ts');

/** Skip reason for features a Node host adds: the `node` command and the worker-thread jq. */
export const NODE_ONLY = portable && 'needs a Node host';

export { Runtime };

/** Boots a fresh machine and returns a runner bound to it. State persists across calls on the same runner. */
export async function machine(user?: string): Promise<(cmd: string, stdin?: string) => Promise<ExecResult>> {
  const rt = await Runtime.boot({ user });
  return (cmd, stdin) => rt.exec(cmd, stdin);
}

/** One-shot: run a command on a fresh machine. */
export async function sh(cmd: string, stdin?: string): Promise<ExecResult> {
  return (await machine())(cmd, stdin);
}
