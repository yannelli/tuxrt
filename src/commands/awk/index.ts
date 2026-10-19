import { errMessage } from '../../vfs/errors.ts';
import type { CommandDef, CommandTable, Ctx } from '../types.ts';
import { readAll } from '../../shell/io.ts';
import type { Program } from './ast.ts';
import { Interp } from './interp.ts';
import { AwkSyntaxError } from './lexer.ts';
import { parse } from './parser.ts';

const VERSION: Record<string, string> = {
  gawk: 'GNU Awk 5.2.1, API 3.2, PMA Avon 8-g1, (GNU MPFR 4.2.1, GNU MP 6.3.0)\n',
  default: 'mawk 1.3.4 20240123\nCopyright 2008-2023,2024, Thomas E. Dickey\nCopyright 1991-1996,2014, Michael D. Brennan\n\n',
};

interface Options {
  fs?: string;
  assigns: string[];
  progFiles: string[];
  rest: string[];
}

function usage(ctx: Ctx, msg?: string): number {
  if (msg) ctx.stderr.write(`${ctx.name}: ${msg}\n`);
  ctx.stderr.write(
    `usage: ${ctx.name} [-F value] [-v var=value] [--] 'program text' [file ...]\n` +
      `usage: ${ctx.name} [-F value] [-v var=value] [-f program-file] [--] [file ...]\n`,
  );
  return 2;
}

/** Returns parsed options, or an exit status when the command line is unusable or asks for the version. */
function parseOptions(ctx: Ctx): Options | number {
  const opts: Options = { assigns: [], progFiles: [], rest: [] };
  const args = ctx.args;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--version' || a === '-V' || /^-W ?v/.test(a) || (a === '-W' && args[i + 1]?.startsWith('v'))) {
      ctx.stdout.write(VERSION[ctx.name] ?? VERSION.default);
      return 0;
    }
    if (a.length < 2 || a[0] !== '-') break;
    const flag = a[1];
    if (!'FvfW'.includes(flag)) return usage(ctx, `not an option ${a}`);
    const value = a.length > 2 ? a.slice(2) : args[++i];
    if (value === undefined) return usage(ctx, `option requires an argument -- ${flag}`);
    if (flag === 'F') opts.fs = value;
    else if (flag === 'f') opts.progFiles.push(value);
    else if (flag === 'v') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) return usage(ctx, `improper assignment: -v ${value}`);
      opts.assigns.push(value);
    }
  }
  opts.rest = args.slice(i);
  return opts;
}

async function loadProgram(ctx: Ctx, opts: Options): Promise<string | number> {
  if (!opts.progFiles.length) {
    const src = opts.rest.shift();
    return src ?? usage(ctx);
  }
  const parts: string[] = [];
  for (const f of opts.progFiles) {
    try {
      parts.push(f === '-' || f === '/dev/stdin' ? await readAll(ctx.stdin) : ctx.vfs.readFile(ctx.shell.abs(f)));
    } catch (e) {
      ctx.stderr.write(`${ctx.name}: couldn't open file ${f} (${errMessage(e)})\n`);
      return 2;
    }
  }
  return parts.join('\n');
}

async function awk(ctx: Ctx): Promise<number> {
  const opts = parseOptions(ctx);
  if (typeof opts === 'number') return opts;
  const src = await loadProgram(ctx, opts);
  if (typeof src === 'number') return src;
  let prog: Program;
  try {
    prog = parse(src);
  } catch (e) {
    if (!(e instanceof AwkSyntaxError)) throw e;
    ctx.stderr.write(`${ctx.name}: line ${e.line}: ${e.message}\n`);
    return 2;
  }
  const interp = new Interp(ctx, prog);
  const assigns = opts.fs === undefined ? opts.assigns : [`FS=${opts.fs}`, ...opts.assigns];
  interp.init(opts.rest, assigns);
  return interp.run();
}

const def = (desc: string): CommandDef => ({ fn: awk, desc });

export const awkCommands: CommandTable = {
  awk: def('pattern scanning and text processing language'),
  mawk: def('pattern scanning and text processing language'),
  gawk: def('pattern scanning and processing language'),
};
