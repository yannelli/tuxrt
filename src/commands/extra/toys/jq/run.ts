import type { Node } from './ast.ts';
import { check } from './check.ts';
import { CliError, HELP, HINT, parseCli, type Options } from './cli.ts';
import { DEFAULT_COLORS, dump, quote, tojson, type DumpOpts } from './dump.ts';
import { ev } from './eval.ts';
import { Inputs, PENDING, UnbufferedInput, type Source } from './inputs.ts';
import { ParseError, parseJson } from './json.ts';
import { DEFAULT_LIBRARY_PATHS, ModuleError, Modules } from './modules.ts';
import { parseProgram } from './parser.ts';
import { builtinKeys, rootEnv } from './prelude.ts';
import { Halt, type Runtime } from './registry.ts';
import { CompileError, JqError, truthy, type Value } from './value.ts';
import { normalize } from '../../../../vfs/path.ts';

/** Everything a jq run needs from the shell, captured so it can run on a worker thread. */
export interface Job {
  args: string[];
  env: Record<string, string>;
  cwd: string;
  home: string;
  stdinTTY: boolean;
  stdoutTTY: boolean;
}

export interface JobIO {
  out(s: string): void;
  err(s: string): void;
  /** Throws an Error whose message is the OS-style reason. */
  readFile(path: string): string;
  /** The next stdin chunk; null at end of input, undefined when none is buffered yet (see Pause). */
  readStdin(): string | null | undefined;
}

/** Why runJob paused: it needs another stdin chunk, all of stdin before it starts, or it just wrote an output. */
export type Pause = 'more' | 'all' | 'out';

export class Exit {
  readonly code: number;

  constructor(code: number) {
    this.code = code;
  }
}

/** Exit status for an exception that escaped runJob, reported the way jq would. */
export function failure(e: unknown, err: (s: string) => void): number {
  if (e instanceof Exit) return e.code;
  if (e instanceof CliError) return err(`jq: ${e.message}\n${HINT}`), 2;
  return err(`jq: error: ${e instanceof Error ? e.message : String(e)}\n`), 5;
}

function compileError(io: JobIO, src: string, errs: CompileError[]): number {
  for (const e of errs) {
    const lineNo = src.slice(0, e.pos).split('\n').length;
    const start = src.lastIndexOf('\n', e.pos - 1) + 1;
    const nl = src.indexOf('\n', start);
    const text = nl === -1 ? src.slice(start) : src.slice(start, nl + 1);
    const hint = e.message.includes('unexpected') ? ' (Unix shell quoting issues?)' : '';
    io.err(`jq: error: ${e.message}${hint} at <top-level>, line ${lineNo}:\n${text}${' '.repeat(e.pos - start)}\n`);
  }
  io.err(`jq: ${errs.length} compile error${errs.length > 1 ? 's' : ''}\n`);
  return 3;
}

function dumpOpts(job: Job, o: Options): DumpOpts {
  const f = o.flags;
  const tty = job.stdoutTTY && !job.env.NO_COLOR;
  const custom = (job.env.JQ_COLORS ?? '').split(':');
  const colors = DEFAULT_COLORS.map((c, i) => (/^[0-9;]+$/.test(custom[i] ?? '') ? custom[i] : c));
  const indent = f.has('compact-output') ? '' : f.has('tab') ? '\t' : ' '.repeat(o.indent);
  return { indent, sort: f.has('sort-keys'), ascii: f.has('ascii-output'), colors: f.has('color-output') || (tty && !f.has('monochrome-output')) ? colors : null };
}

export function* runJob(job: Job, io: JobIO): Generator<Pause, number> {
  const abs = (p: string) => normalize(p, job.cwd);
  const readSource = (file: string): string => {
    try {
      return io.readFile(abs(file));
    } catch (e) {
      io.err(`jq: error: Could not open ${file}: ${(e as Error).message}\n`);
      throw new Exit(2);
    }
  };
  const o = parseCli(job.args);
  const f = o.flags;
  if (f.has('help')) return io.out(HELP), 0;
  if (f.has('version')) return io.out('jq-1.7.1\n'), 0;
  let src = o.filter;
  if (src !== null && f.has('from-file')) src = readSource(src);
  if (src === null) {
    if (job.stdinTTY && job.stdoutTTY) return io.err(`${HELP.split('\n\n')[0]}\n\n${HINT}`), 2;
    src = '.';
  }
  const vars = globals(job, o, readSource);
  let mods: Modules | null = null;
  const rt: Runtime = {
    input: () => {
      const v = inputs.next();
      if (v === PENDING) throw new UnbufferedInput();
      return v;
    },
    filename: () => inputs.filename,
    line: () => inputs.line,
    stderr: io.err,
    env: vars[0][1] as Map<string, Value>,
    modulemeta: (name) => mods!.meta(name),
  };
  const base = rootEnv(rt, vars);
  let ast: Node;
  let env = base;
  try {
    const prog = parseProgram(src);
    const read = (p: string) => {
      try {
        return io.readFile(p);
      } catch {
        return null;
      }
    };
    mods = new Modules({ read, home: job.home, cwd: job.cwd, libraryPaths: o.libraryPaths.length ? o.libraryPaths : DEFAULT_LIBRARY_PATHS }, base);
    // Like jq, -L replaces the default search path and skips the ~/.jq library.
    env = mods.link(prog.deps, o.libraryPaths.length ? base : mods.autoInclude(base), job.cwd, true);
    ast = prog.body;
    const errs = check(ast, new Set([...builtinKeys(), ...mods.keys]), [...vars.map(([n]) => n), ...mods.vars]);
    if (errs.length) return compileError(io, src, errs);
  } catch (e) {
    if (e instanceof CompileError) return compileError(io, src, [e]);
    if (e instanceof ModuleError || e instanceof ParseError) return io.err(`jq: error: ${e.message}\njq: 1 compile error\n`), 3;
    throw e;
  }
  const failed = { value: false };
  const inputs = new Inputs(sources(o, ast, abs, io, failed), f.has('raw-input'), f.has('slurp'), f.has('stream'));
  // `input`, `inputs` and --slurp read stdin from inside the evaluator, where pausing is impossible.
  if (f.has('slurp') || usesInput(ast)) yield 'all';
  return yield* evaluate(ast, env, inputs, o, dumpOpts(job, o), io, failed.value);
}

function globals(job: Job, o: Options, readSource: (f: string) => string): [string, Value][] {
  const named = new Map<string, Value>();
  for (const n of o.named) {
    if (n.file === undefined) named.set(n.name, n.value!);
    else if (n.raw) named.set(n.name, readSource(n.file));
    else {
      try {
        named.set(n.name, [...parseJson(readSource(n.file))].map((x) => x.value));
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        throw new Exit(2);
      }
    }
  }
  const args = new Map<string, Value>([['positional', o.positional], ['named', named]]);
  return [['ENV', new Map(Object.entries(job.env))], ['ARGS', args], ...named];
}

const usesInput = (n: Node): boolean => JSON.stringify(n).includes('"name":"input');

function sources(o: Options, ast: Node, abs: (p: string) => string, io: JobIO, failed: { value: boolean }): Source[] {
  if (!o.files.length && o.flags.has('null-input') && !usesInput(ast)) return [];
  const list: Source[] = [];
  for (const f of o.files.length ? o.files : ['-']) {
    if (f === '-') {
      list.push({ name: f, read: io.readStdin });
      continue;
    }
    try {
      list.push({ name: f, text: io.readFile(abs(f)) });
    } catch (e) {
      io.err(`jq: error: Could not open ${f}: ${(e as Error).message}\n`);
      failed.value = true;
    }
  }
  return list;
}

function* evaluate(ast: Node, env: ReturnType<typeof rootEnv>, inputs: Inputs, o: Options, opts: DumpOpts, io: JobIO, failed: boolean): Generator<Pause, number> {
  const f = o.flags;
  const raw = f.has('raw-output') || f.has('join-output') || f.has('raw-output0');
  const end = f.has('join-output') ? '' : f.has('raw-output0') ? '\0' : '\n';
  const write = (x: Value) => {
    if (f.has('raw-output0') && typeof x === 'string' && x.includes('\0')) throw new JqError('Cannot dump a string containing NUL with --raw-output0 option');
    const s = raw && typeof x === 'string' ? (opts.ascii ? quote(x, true) : x) : dump(x, opts);
    io.out(`${f.has('seq') ? '\x1e' : ''}${s}${end}`);
  };
  let ret = 0;
  let lastResult = -1;
  function* run(v: Value): Generator<Pause> {
    let last: Value | undefined;
    try {
      for (const [x] of ev(ast, env, v, null)) {
        write(x);
        last = x;
        yield 'out';
      }
      ret = last === undefined ? -4 : truthy(last) ? 0 : -1;
      if (ret !== -4) lastResult = ret === 0 ? 1 : 0;
    } catch (e) {
      // Stack exhaustion and oversized strings surface as RangeError; report them like jq errors.
      if (e instanceof RangeError) e = new JqError(e.message);
      if (!(e instanceof JqError)) throw e;
      const msg = typeof e.value === 'string' ? `: ${e.value}` : ` (not a string): ${tojson(e.value)}`;
      io.err(`jq: error (at ${inputs.loc})${msg}\n`);
      ret = 5;
    }
  }
  const next = function* (): Generator<Pause, Value | undefined> {
    for (let v = inputs.next(); ; v = inputs.next()) {
      if (v !== PENDING) return v;
      yield 'more';
    }
  };
  try {
    if (f.has('null-input')) yield* run(null);
    else for (let v = yield* next(); v !== undefined; v = yield* next()) yield* run(v);
  } catch (e) {
    if (e instanceof Halt) return e.code;
    if (!(e instanceof ParseError)) throw e;
    io.err(`jq: parse error: ${e.message}\n`);
    ret = 2;
  }
  if (failed) ret = 2;
  if (!f.has('exit-status')) return Math.max(ret, 0);
  if (ret !== -4) return Math.abs(ret);
  return lastResult === -1 ? 4 : lastResult === 0 ? 1 : 0;
}
