import { readAll } from '../../../shell/io.ts';
import { FsError, errMessage } from '../../../vfs/errors.ts';
import { basename } from '../../../vfs/path.ts';
import type { Stat } from '../../../vfs/types.ts';
import type { Ctx } from '../../types.ts';
import { command, parseArgs } from '../../util.ts';
import { fromBytes, toBytes } from '../../../vfs/bytes.ts';
import { GzipError, gunzip, gzip, gzipOverhead, isGzip } from './gzfmt.ts';

interface GzOpts {
  decompress: boolean;
  stdout: boolean;
  keep: boolean;
  force: boolean;
  verbose: boolean;
  quiet: boolean;
  test: boolean;
  noName: boolean;
  level: number;
}

const SUFFIXES: [string, string][] = [['.gz', ''], ['.tgz', '.tar'], ['.taz', '.tar'], ['.z', ''], ['-gz', ''], ['-z', ''], ['_z', '']];

const HELP = `Usage: gzip [OPTION]... [FILE]...
Shrink each FILE with DEFLATE, replacing it with FILE.gz (or the reverse with -d).

  -c, --stdout      send the result to stdout and leave inputs alone
  -d, --decompress  expand .gz files instead of creating them
  -f, --force       replace existing outputs; also follow symlinks
  -h, --help        show this summary and exit
  -k, --keep        do not remove the input after success
  -n, --no-name     ignore the stored file name and mtime
  -q, --quiet       hide warnings
  -t, --test        check that compressed files decode cleanly
  -v, --verbose     report the name and ratio of each file
  -1, --fast        favour speed over size
  -9, --best        favour size over speed

Reads stdin when FILE is omitted or is -.
`;

class Run {
  ctx: Ctx;
  o: GzOpts;
  error = false;
  warning = false;

  constructor(ctx: Ctx, o: GzOpts) {
    this.ctx = ctx;
    this.o = o;
  }

  fail(msg: string): void {
    this.ctx.stderr.write(`gzip: ${msg}\n`);
    this.error = true;
  }

  warn(msg: string): void {
    if (!this.o.quiet) this.ctx.stderr.write(`gzip: ${msg}\n`);
    this.warning = true;
  }

  status(): number {
    return this.error ? 1 : this.warning ? 2 : 0;
  }
}

function suffixOf(name: string): [string, string] | undefined {
  const base = basename(name);
  return SUFFIXES.find(([s]) => base.length > s.length && base.endsWith(s));
}

const ratio = (whole: number, packed: number) => `${(whole ? ((whole - packed) * 100) / whole : 0).toFixed(1).padStart(5)}%`;

function levelOf(args: string[]): number {
  let level = 6;
  for (const a of args) {
    if (a === '--') break;
    if (a === '--fast') level = 1;
    else if (a === '--best') level = 9;
    else if (/^-[^-]/.test(a)) for (const c of a.slice(1)) if (c >= '1' && c <= '9') level = Number(c);
  }
  return level;
}

/** Returns [output bytes, packed stream size], or null after reporting why `label` was rejected. */
function transform(run: Run, data: Uint8Array, label: string, header: { name?: string; mtime: number }): [Uint8Array, number] | null {
  const { o } = run;
  if (!o.decompress) {
    const { out, packed } = gzip(data, { ...(o.noName ? { mtime: 0 } : header), level: o.level });
    return [out, packed];
  }
  if (!isGzip(data) && o.force && o.stdout && !o.test) return [data, data.length];
  try {
    const out = gunzip(data);
    return [out, data.length - gzipOverhead(data)];
  } catch (e) {
    run.fail(`${label}: ${e instanceof GzipError ? e.message : errMessage(e)}`);
    return null;
  }
}

async function treatStdin(run: Run): Promise<void> {
  const { ctx, o } = run;
  if (!o.force && (o.decompress ? ctx.stdin.isTTY : ctx.stdout.isTTY)) {
    const dir = o.decompress ? 'read from' : 'written to';
    if (!o.quiet) ctx.stderr.write(`gzip: compressed data not ${dir} a terminal. Use -f to force ${o.decompress ? 'de' : ''}compression.\nFor help, type: gzip -h\n`);
    run.error = true;
    return;
  }
  const data = toBytes(await readAll(ctx.stdin));
  const res = transform(run, data, 'stdin', { mtime: 0 });
  if (!res) return;
  if (o.test) {
    if (o.verbose) ctx.stderr.write(' OK\n');
    return;
  }
  if (o.verbose && !o.decompress) ctx.stderr.write(`${ratio(data.length, res[1])}\n`);
  ctx.stdout.write(fromBytes(res[0]));
}

/** Like gzip -d, a missing "foo" falls back to "foo.gz" and is then reported under that name. */
function locate(run: Run, name: string): { name: string; path: string; st: Stat } | null {
  const { ctx, o } = run;
  const candidates = [name, ...(o.decompress && !suffixOf(name) ? ['.gz', '.z'].map((s) => name + s) : [])];
  for (const candidate of candidates) {
    const path = ctx.shell.abs(candidate);
    try {
      return { name: candidate, path, st: ctx.vfs.stat(path, false) };
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT') continue;
      run.fail(`${candidate}: ${errMessage(e)}`);
      return null;
    }
  }
  run.fail(`${candidates[Math.min(1, candidates.length - 1)]}: No such file or directory`);
  return null;
}

function treatFile(run: Run, arg: string): void {
  const { ctx, o } = run;
  const { vfs } = ctx;
  const found = locate(run, arg);
  if (!found) return;
  const { name, path } = found;
  let st = found.st;
  if (st.kind === 'symlink') {
    if (!o.stdout && !o.force) return run.fail(`${name}: Too many levels of symbolic links`);
    try {
      st = vfs.stat(path);
    } catch (e) {
      return run.fail(`${name}: ${errMessage(e)}`);
    }
  }
  if (st.kind === 'dir') return run.warn(`${name} is a directory -- ignored`);
  const suffix = suffixOf(name);
  const toStdout = o.stdout || o.test;
  if (!toStdout && !o.decompress && suffix) return run.warn(`${name} already has ${suffix[0]} suffix -- unchanged`);
  if (!toStdout && o.decompress && !suffix) return run.warn(`${name}: unknown suffix -- ignored`);
  const outName = !o.decompress ? `${name}.gz` : suffix ? name.slice(0, -suffix[0].length) + suffix[1] : name;
  const outPath = ctx.shell.abs(outName);
  let data: Uint8Array;
  try {
    data = toBytes(vfs.readFile(path));
  } catch (e) {
    return run.fail(`${name}: ${errMessage(e)}`);
  }
  const res = transform(run, data, name, { name: basename(name), mtime: Math.floor(st.mtime / 1000) });
  if (!res) return;
  if (!toStdout && !o.force && vfs.tryLookup(outPath, false)) return run.warn(`${outName} already exists; not overwritten`);
  const [out, packed] = res;
  const stats = o.decompress ? ratio(out.length, packed) : ratio(data.length, packed);
  if (o.test) {
    if (o.verbose) ctx.stderr.write(`${name}:\t OK\n`);
    return;
  }
  if (o.stdout) {
    if (o.verbose) ctx.stderr.write(`${name}:\t${stats}\n`);
    ctx.stdout.write(fromBytes(out));
    return;
  }
  try {
    if (vfs.tryLookup(outPath, false)) vfs.unlink(outPath);
    vfs.writeFile(outPath, fromBytes(out));
    vfs.chmod(outPath, st.mode);
    if (vfs.cred.uid === 0) vfs.chown(outPath, st.uid, st.gid);
    vfs.touch(outPath, st.mtime);
  } catch (e) {
    return run.fail(`${outName}: ${errMessage(e)}`);
  }
  try {
    if (!o.keep) vfs.unlink(path);
  } catch (e) {
    run.warn(`${name}: ${errMessage(e)}`);
  }
  if (o.verbose) ctx.stderr.write(`${name}:\t${stats} -- ${o.keep ? 'created' : 'replaced with'} ${outName}\n`);
}

export function gzipCommand(variant: 'gzip' | 'gunzip' | 'zcat') {
  return command(async (ctx) => {
    const { opts, operands } = parseArgs(ctx.args, {
      flags: 'cdkfvqtnNh123456789',
      long: {
        stdout: 'c', 'to-stdout': 'c', decompress: 'd', uncompress: 'd', keep: 'k', force: 'f', verbose: 'v',
        quiet: 'q', test: 't', 'no-name': 'n', name: 'N', help: 'h', fast: '1', best: '9',
      },
    });
    if (opts.h) {
      ctx.stdout.write(HELP);
      return 0;
    }
    const run = new Run(ctx, {
      decompress: variant !== 'gzip' || !!opts.d || !!opts.t,
      stdout: variant === 'zcat' || !!opts.c,
      keep: !!opts.k,
      force: !!opts.f,
      verbose: !!opts.v && !opts.q,
      quiet: !!opts.q,
      test: !!opts.t,
      noName: !!opts.n,
      level: levelOf(ctx.args),
    });
    for (const f of operands.length ? operands : ['-']) {
      if (f === '-') await treatStdin(run);
      else treatFile(run, f);
    }
    return run.status();
  });
}
