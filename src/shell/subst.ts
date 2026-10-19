import { BufferWriter, EMPTY } from './io.ts';
import type { Shell } from './shell.ts';
import { runSource } from './interpreter.ts';

/** $(...) and `...`: runs in a forked shell; trailing newlines are stripped. */
export async function captureOutput(shell: Shell, src: string): Promise<string> {
  const sub = shell.fork();
  const out = new BufferWriter();
  shell.status = shell.lastSubst = await runSource(sub, src, { stdin: EMPTY, stdout: out, stderr: shell.kernel.stderr }, { subshell: true });
  return out.data.replace(/\n+$/, '');
}
