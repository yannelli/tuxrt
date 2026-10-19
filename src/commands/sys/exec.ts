import type { IO } from '../../shell/io.ts';
import { resolveCommand } from '../../shell/resolve.ts';
import type { Shell } from '../../shell/shell.ts';
import type { Ctx } from '../types.ts';
import { parseArgs, type OptSpec, type Parsed } from '../util.ts';

/** Just the streams of a Ctx: dispatch spreads its io argument over the callee's name and args. */
export function streams(ctx: Ctx): IO {
  return { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr };
}

/** Parses options only up to the first operand, which starts a command line (`env -i cmd -x`). */
export function leadingOpts(args: string[], spec: OptSpec): Parsed & { rest: string[] } {
  let i = 0;
  let skip = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      skip = 1;
      break;
    }
    if (a.length < 2 || a[0] !== '-') break;
    if (a.startsWith('--')) {
      if (!a.includes('=') && spec.long?.[`${a.slice(2)}=`] !== undefined) i++;
      continue;
    }
    const valued = [...a.slice(1)].findIndex((c) => spec.values?.includes(c));
    if (valued === a.length - 2) i++;
  }
  return { ...parseArgs(args.slice(0, i), spec), rest: args.slice(i + skip) };
}

/** A forked shell for exec'ing a program: functions do not cross an exec boundary. */
export function programShell(shell: Shell): Shell {
  const sub = shell.fork();
  sub.functions.clear();
  return sub;
}

/** Whether execvp() would find `name`: a binary or script, not a pure shell builtin. */
export function isProgram(name: string, shell: Shell): boolean {
  const r = resolveCommand(name, shell);
  return !!r && !(r.kind === 'builtin' && !r.def.stub) && r.kind !== 'function';
}

const UNITS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };

/** Seconds for `5`, `1.5m`, `2h`, `infinity`; null when invalid. */
export function parseDuration(s: string): number | null {
  if (/^inf(inity)?$/.test(s)) return Infinity;
  const m = /^(\d+\.?\d*|\.\d+)([smhd]?)$/.exec(s);
  return m ? Number(m[1]) * UNITS[m[2]] : null;
}
