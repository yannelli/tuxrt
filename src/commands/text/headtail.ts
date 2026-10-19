import { FsError } from '../../vfs/errors.ts';
import { lineReader, readAll } from '../../shell/io.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fail } from '../util.ts';
import { getopt, parseCount } from './args.ts';
import { chunks, displayName, fromBytes, isRaw, splitKeep, textLines, toBytes, type LineSource } from './stream.ts';

interface Plan {
  bytes: boolean;
  n: number;
  sign: string;
  files: string[];
  headers: boolean;
}

function plan(ctx: Ctx, verbs: { flags: string; values: string; long: Record<string, string> }): Plan | number {
  const { list, operands } = getopt(ctx.args, { ...verbs, numeric: 'n' });
  let bytes = false;
  let spec = '10';
  let quiet = false;
  let verbose = false;
  for (const [k, v] of list) {
    if (k === 'n' || k === 'c') [bytes, spec] = [k === 'c', String(v)];
    else if (k === 'q') [quiet, verbose] = [true, false];
    else if (k === 'v') [quiet, verbose] = [false, true];
  }
  const count = parseCount(spec);
  if (!count) return fail(ctx, `invalid number of ${bytes ? 'bytes' : 'lines'}: '${spec}'`);
  const files = operands.length ? operands : ['-'];
  return { bytes, ...count, files, headers: verbose || (files.length > 1 && !quiet) };
}

/** Runs `each` per input with GNU "==> f <==" headers and "cannot open" errors. */
async function perFile(ctx: Ctx, p: Plan, each: (f: string) => Promise<void>): Promise<number> {
  let status = 0;
  let first = true;
  for (const f of p.files) {
    if (f !== '-') {
      const node = ctx.vfs.tryLookup(abs(ctx, f));
      if (!node || (node.kind === 'file' && !ctx.vfs.access(abs(ctx, f), 'r'))) {
        status = fail(ctx, `cannot open '${f}' for reading: ${node ? 'Permission denied' : 'No such file or directory'}`);
        continue;
      }
    }
    if (p.headers) ctx.stdout.write(`${first ? '' : '\n'}==> ${displayName(f)} <==\n`);
    first = false;
    try {
      await each(f);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      status = fail(ctx, `error reading '${f}': ${e.message}`);
    }
  }
  return status;
}

function source(ctx: Ctx, f: string): LineSource {
  return f === '-' ? lineReader(ctx.stdin) : textLines(ctx.vfs.readFile(abs(ctx, f)));
}

async function head(ctx: Ctx): Promise<number> {
  const p = plan(ctx, { flags: 'qv', values: 'nc', long: { 'lines=': 'n', 'bytes=': 'c', quiet: 'q', silent: 'q', verbose: 'v' } });
  if (typeof p === 'number') return p;
  return perFile(ctx, p, async (f) => {
    if (p.bytes && p.sign !== '-') {
      let text = '';
      if (f === '-') {
        for await (const c of chunks(ctx.stdin)) if ((text += c).length >= p.n) break;
      } else text = ctx.vfs.readFile(abs(ctx, f));
      ctx.stdout.write(fromBytes(toBytes(text).subarray(0, p.n), isRaw(text)));
    } else if (p.bytes) {
      const text = f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
      const b = toBytes(text);
      ctx.stdout.write(fromBytes(b.subarray(0, Math.max(0, b.length - p.n)), isRaw(text)));
    } else if (p.sign !== '-') {
      const src = source(ctx, f);
      for (let left = p.n; left > 0; left--) {
        const l = await src.next();
        if (l === null) break;
        ctx.stdout.write(l);
      }
    } else {
      const all = splitKeep(f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f)));
      ctx.stdout.write(all.slice(0, Math.max(0, all.length - p.n)).join(''));
    }
  });
}

async function tail(ctx: Ctx): Promise<number> {
  const p = plan(ctx, {
    flags: 'qvfF',
    values: 'ncs',
    long: { 'lines=': 'n', 'bytes=': 'c', quiet: 'q', silent: 'q', verbose: 'v', follow: 'f', retry: 'F', 'sleep-interval=': 's', 'pid=': 's' },
  });
  if (typeof p === 'number') return p;
  return perFile(ctx, p, async (f) => {
    const text = f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
    const fromStart = p.sign === '+';
    if (p.bytes) {
      const b = toBytes(text);
      const start = fromStart ? Math.max(0, p.n - 1) : Math.max(0, b.length - p.n);
      ctx.stdout.write(fromBytes(b.subarray(start), isRaw(text)));
      return;
    }
    const all = splitKeep(text);
    const start = fromStart ? Math.max(0, p.n - 1) : Math.max(0, all.length - p.n);
    ctx.stdout.write(all.slice(start).join(''));
  });
}

export const headTailCommands: CommandTable = {
  head: { fn: command(head), desc: 'output the first part of files' },
  tail: { fn: command(tail), desc: 'output the last part of files' },
};
