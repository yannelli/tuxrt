import { inspect, types } from 'node:util';
import { lineReader } from '../../../shell/io.ts';
import { NODE_VERSION, ProcessExit } from './errors.ts';
import type { NodeRuntime } from './runtime.ts';

const HELP = `.break     Sometimes you get stuck, this gets you out
.clear     Alias for .break
.exit      Exit the REPL
.help      Print this help message

Press Ctrl+C to abort current expression, Ctrl+D to exit the REPL
`;

const INCOMPLETE = /Unexpected end of input|Unterminated template literal|missing \) after argument list/;

export function describeUncaught(e: unknown): string {
  const isError = types.isNativeError(e) || (e instanceof Object && typeof (e as Error).stack === 'string');
  return `Uncaught ${isError ? String((e as Error).stack).split('\n')[0] : inspect(e)}\n`;
}

/** A line-oriented Node REPL; multi-line input continues while the code is incomplete. */
export async function repl(rt: NodeRuntime): Promise<void> {
  const { ctx } = rt;
  const lines = lineReader(ctx.stdin);
  const aborted = new Promise<null>((resolve) => ctx.signal.addEventListener('abort', () => resolve(null), { once: true }));
  const mod = rt.modules.evalModule('<repl>');
  Object.assign(rt.globals, { require: mod.require, module: mod, exports: mod.exports });
  rt.write(1, `Welcome to Node.js ${NODE_VERSION}.\nType ".help" for more information.\n`);
  let buffer = '';
  for (let n = 1; ; n++) {
    rt.write(1, buffer ? '... ' : '> ');
    const line = await Promise.race([lines.next(), aborted]);
    if (line === null || rt.loop.stopped) {
      if (line === null && !ctx.signal.aborted) rt.write(1, '\n');
      return;
    }
    const input = buffer + line;
    const cmd = input.trim();
    if (!buffer && cmd.startsWith('.')) {
      if (cmd === '.exit') return;
      rt.write(1, cmd === '.help' ? HELP : cmd === '.break' || cmd === '.clear' ? '' : 'Invalid REPL keyword\n');
      continue;
    }
    if (!cmd) continue;
    try {
      const { script, async } = rt.modules.compileEval(input, `REPL${n}`, true);
      buffer = '';
      let value = script.runInContext(rt.context, { displayErrors: false });
      if (async) value = await value;
      rt.globals._ = value;
      rt.write(1, `${inspect(value, { colors: !!ctx.stdout.isTTY })}\n`);
    } catch (e) {
      if (e instanceof ProcessExit) return;
      if (e instanceof SyntaxError && INCOMPLETE.test(e.message)) {
        buffer = input;
        continue;
      }
      buffer = '';
      rt.write(1, describeUncaught(e));
    }
  }
}
