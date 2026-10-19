import { readAll } from '../../shell/io.ts';
import { errMessage } from '../../vfs/errors.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, parseArgs } from '../util.ts';
import { readText, toBytes } from './stream.ts';
import { latin1 } from '../../vfs/bytes.ts';

function printable(b: number): string {
  if (b >= 128) return `M-${printable(b - 128)}`;
  if (b < 32) return `^${String.fromCharCode(b + 64)}`;
  return b === 127 ? '^?' : String.fromCharCode(b);
}

async function cmp(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'bls',
    values: 'ni',
    long: { 'print-bytes': 'b', verbose: 'l', quiet: 's', silent: 's', 'bytes=': 'n', 'ignore-initial=': 'i' },
  });
  if (!operands.length) {
    ctx.stderr.write(`cmp: missing operand after 'cmp'\ncmp: Try 'cmp --help' for more information.\n`);
    return 2;
  }
  const names = [operands[0], operands[1] ?? '-'];
  const data: Uint8Array[] = [];
  for (const f of names) {
    try {
      data.push(toBytes(f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f))));
    } catch (e) {
      ctx.stderr.write(`cmp: ${f}: ${errMessage(e)}\n`);
      return 2;
    }
  }
  const skip = Number(opts.i ?? 0);
  const limit = opts.n === undefined ? Infinity : Number(opts.n);
  const [a, b] = data.map((d) => d.subarray(skip, skip + Math.min(limit, d.length)));
  const common = Math.min(a.length, b.length);
  let line = 1;
  let differ = false;
  const width = String(common).length;
  for (let i = 0; i < common; i++) {
    if (a[i] !== b[i]) {
      differ = true;
      if (opts.s) return 1;
      if (opts.l) {
        ctx.stdout.write(`${String(i + 1).padStart(width)} ${a[i].toString(8).padStart(3)} ${b[i].toString(8).padStart(3)}\n`);
        continue;
      }
      const detail = opts.b ? ` is ${a[i].toString(8).padStart(3)} ${printable(a[i])} ${b[i].toString(8).padStart(3)} ${printable(b[i])}` : '';
      ctx.stdout.write(`${names[0]} ${names[1]} differ: byte ${i + 1}, line ${line}${detail}\n`);
      return 1;
    }
    if (a[i] === 10) line++;
  }
  if (a.length !== b.length) {
    if (!opts.s) {
      const short = a.length < b.length ? names[0] : names[1];
      const endsLine = common > 0 && a[common - 1] === 10;
      ctx.stderr.write(common === 0 ? `cmp: EOF on ${short} which is empty\n` : `cmp: EOF on ${short} after byte ${common}, line ${endsLine ? line - 1 : line}\n`);
    }
    return 1;
  }
  return differ ? 1 : 0;
}

async function strings(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'af',
    values: 'nt',
    long: { all: 'a', 'print-file-name': 'f', 'bytes=': 'n', 'radix=': 't' },
  });
  const min = Number(opts.n ?? 4);
  const radix = { o: 8, d: 10, x: 16 }[String(opts.t)] as number | undefined;
  let status = 0;
  for (const f of operands.length ? operands : ['-']) {
    const text = await readText(ctx, f);
    if (text === null) {
      status = 1;
      continue;
    }
    const bytes = toBytes(text);
    let out = '';
    for (const m of latin1(bytes).matchAll(new RegExp(`[\\t\\x20-\\x7e]{${min},}`, 'g'))) {
      const offset = radix ? `${m.index.toString(radix).padStart(7)} ` : '';
      out += `${opts.f ? `${f}: ` : ''}${offset}${m[0]}\n`;
    }
    ctx.stdout.write(out);
  }
  return status;
}

export const cmpCommands: CommandTable = {
  cmp: { fn: command(cmp), desc: 'compare two files byte by byte' },
  strings: { fn: command(strings), desc: 'extract printable text from files' },
};
