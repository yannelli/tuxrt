import { readAll } from '../../../../shell/io.ts';
import { errMessage } from '../../../../vfs/errors.ts';
import type { CommandFn, Ctx } from '../../../types.ts';
import { sleep } from '../../../util.ts';
import type { Node } from './ast.ts';
import { check } from './check.ts';
import { CliError, HELP, HINT, parseCli, type Options } from './cli.ts';
import { DEFAULT_COLORS, dump, quote, tojson, type DumpOpts } from './dump.ts';
import { ev } from './eval.ts';
import { Inputs, type Source } from './inputs.ts';
import { ParseError, parseJson } from './json.ts';
import { parse } from './parser.ts';
import { builtinKeys, rootEnv } from './prelude.ts';
import { Halt, type Runtime } from './registry.ts';
import { CompileError, JqError, truthy, type Value } from './value.ts';

class Exit {
  readonly code: number;

  constructor(code: number) {
    this.code = code;
  }
}

function compileError(ctx: Ctx, src: string, errs: CompileError[]): number {
  for (const e of errs) {
    const lineNo = src.slice(0, e.pos).split('\n').length;
    const start = src.lastIndexOf('\n', e.pos - 1) + 1;
    const nl = src.indexOf('\n', start);
    const text = nl === -1 ? src.slice(start) : src.slice(start, nl + 1);
    const hint = e.message.includes('unexpected') ? ' (Unix shell quoting issues?)' : '';
    ctx.stderr.write(`jq: error: ${e.message}${hint} at <top-level>, line ${lineNo}:\n${text}${' '.repeat(e.pos - start)}\n`);
  }
  ctx.stderr.write(`jq: ${errs.length} compile error${errs.length > 1 ? 's' : ''}\n`);
  return 3;
}

function dumpOpts(ctx: Ctx, o: Options): DumpOpts {
  const f = o.flags;
  const tty = !!ctx.stdout.isTTY && !ctx.env.NO_COLOR;
  const custom = (ctx.env.JQ_COLORS ?? '').split(':');
  const colors = DEFAULT_COLORS.map((c, i) => (/^[0-9;]+$/.test(custom[i] ?? '') ? custom[i] : c));
  const indent = f.has('compact-output') ? '' : f.has('tab') ? '\t' : ' '.repeat(o.indent);
  return { indent, sort: f.has('sort-keys'), ascii: f.has('ascii-output'), colors: f.has('color-output') || (tty && !f.has('monochrome-output')) ? colors : null };
}

function readSource(ctx: Ctx, file: string): string {
  try {
    return ctx.vfs.readFile(ctx.shell.abs(file));
  } catch (e) {
    ctx.stderr.write(`jq: error: Could not open ${file}: ${errMessage(e)}\n`);
    throw new Exit(2);
  }
}

function globals(ctx: Ctx, o: Options): [string, Value][] {
  const named = new Map<string, Value>();
  for (const n of o.named) {
    if (n.file === undefined) named.set(n.name, n.value!);
    else if (n.raw) named.set(n.name, readSource(ctx, n.file));
    else {
      try {
        named.set(n.name, [...parseJson(readSource(ctx, n.file))].map((x) => x.value));
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        ctx.stderr.write(`jq: Bad JSON in --slurpfile ${n.name} ${n.file}: ${e.message}\n`);
        throw new Exit(2);
      }
    }
  }
  const args = new Map<string, Value>([['positional', o.positional], ['named', named]]);
  return [['ENV', new Map(Object.entries(ctx.env))], ['ARGS', args], ...named];
}

const usesInput = (n: Node): boolean => JSON.stringify(n).includes('"name":"input');

async function sources(ctx: Ctx, o: Options, ast: Node): Promise<{ list: Source[]; failed: boolean }> {
  const list: Source[] = [];
  let failed = false;
  if (!o.files.length && o.flags.has('null-input') && !usesInput(ast)) return { list, failed };
  for (const f of o.files.length ? o.files : ['-']) {
    try {
      list.push({ name: f, text: f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(ctx.shell.abs(f)) });
    } catch (e) {
      ctx.stderr.write(`jq: error: Could not open ${f}: ${errMessage(e)}\n`);
      failed = true;
    }
  }
  return { list, failed };
}

async function main(ctx: Ctx): Promise<number> {
  const o = parseCli(ctx.args);
  const f = o.flags;
  if (f.has('help')) return ctx.stdout.write(HELP), 0;
  if (f.has('version')) return ctx.stdout.write('jq-1.7.1\n'), 0;
  let src = o.filter;
  if (src !== null && f.has('from-file')) src = readSource(ctx, src);
  if (src === null) {
    if (ctx.stdin.isTTY && ctx.stdout.isTTY) return ctx.stderr.write(`${HELP.split('\n\n')[0]}\n\n${HINT}`), 2;
    src = '.';
  }
  const vars = globals(ctx, o);
  let ast: Node;
  try {
    ast = parse(src);
    const errs = check(ast, new Set(builtinKeys()), vars.map(([n]) => n));
    if (errs.length) return compileError(ctx, src, errs);
  } catch (e) {
    if (e instanceof CompileError) return compileError(ctx, src, [e]);
    throw e;
  }
  const { list, failed } = await sources(ctx, o, ast);
  const inputs = new Inputs(list, f.has('raw-input'), f.has('slurp'), f.has('stream'));
  const rt: Runtime = { input: () => inputs.next(), filename: () => inputs.filename, stderr: (s) => ctx.stderr.write(s), env: vars[0][1] as Map<string, Value> };
  const env = rootEnv(rt, vars);
  const opts = dumpOpts(ctx, o);
  const raw = f.has('raw-output') || f.has('join-output') || f.has('raw-output0');
  const end = f.has('join-output') ? '' : f.has('raw-output0') ? '\0' : '\n';
  const write = (x: Value) => {
    if (f.has('raw-output0') && typeof x === 'string' && x.includes('\0')) throw new JqError('Cannot dump a string containing NUL with --raw-output0 option');
    const s = raw && typeof x === 'string' ? (opts.ascii ? quote(x, true) : x) : dump(x, opts);
    ctx.stdout.write(`${f.has('seq') ? '\x1e' : ''}${s}${end}`);
  };

  let ret = 0;
  let lastResult = -1;
  let lastYield = Date.now();
  const run = async (v: Value): Promise<void> => {
    let last: Value | undefined;
    try {
      for (const [x] of ev(ast, env, v, null)) {
        write(x);
        last = x;
        if (Date.now() - lastYield > 50) {
          await sleep(0, ctx.signal);
          lastYield = Date.now();
        }
        if (ctx.signal.aborted) throw new Exit(130);
      }
      ret = last === undefined ? -4 : truthy(last) ? 0 : -1;
      if (ret !== -4) lastResult = ret === 0 ? 1 : 0;
    } catch (e) {
      // Stack exhaustion and oversized strings surface as RangeError; report them like jq errors.
      if (e instanceof RangeError) e = new JqError(e.message);
      if (!(e instanceof JqError)) throw e;
      const msg = typeof e.value === 'string' ? `: ${e.value}` : ` (not a string): ${tojson(e.value)}`;
      ctx.stderr.write(`jq: error (at ${inputs.loc})${msg}\n`);
      ret = 5;
    }
  };
  try {
    if (f.has('null-input')) await run(null);
    else for (let v = inputs.next(); v !== undefined; v = inputs.next()) await run(v);
  } catch (e) {
    if (e instanceof Halt) return e.code;
    if (!(e instanceof ParseError)) throw e;
    ctx.stderr.write(`jq: parse error: ${e.message}\n`);
    ret = 2;
  }
  if (failed) ret = 2;
  if (!f.has('exit-status')) return Math.max(ret, 0);
  if (ret !== -4) return Math.abs(ret);
  return lastResult === -1 ? 4 : lastResult === 0 ? 1 : 0;
}

export const jq: CommandFn = async (ctx) => {
  try {
    return await main(ctx);
  } catch (e) {
    if (e instanceof Exit) return e.code;
    if (e instanceof CliError) return ctx.stderr.write(`jq: ${e.message}\n${HINT}`), 2;
    throw e;
  }
};
