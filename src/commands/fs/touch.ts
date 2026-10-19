import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, msgOf, parseDate, q, usage } from './common.ts';

/** touch -t [[CC]YY]MMDDhhmm[.ss] */
function parseStamp(stamp: string): number | null {
  const m = /^(\d{8}|\d{10}|\d{12})(?:\.(\d{2}))?$/.exec(stamp);
  if (!m) return null;
  const digits = m[1];
  let year = new Date().getUTCFullYear();
  if (digits.length === 10) year = Number(digits.slice(0, 2)) + (Number(digits.slice(0, 2)) < 69 ? 2000 : 1900);
  if (digits.length === 12) year = Number(digits.slice(0, 4));
  const [mon, day, h, min] = digits.slice(-8).match(/../g)!.map(Number);
  const t = Date.UTC(year, mon - 1, day, h, min, Number(m[2] ?? 0));
  return mon >= 1 && mon <= 12 && day >= 1 && day <= 31 && h < 24 && min < 60 ? t : null;
}

function touch(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'acmfh',
    values: 'drt',
    long: { 'no-create': 'c', 'date=': 'd', 'reference=': 'r', 'no-dereference': 'h' },
  });
  if (!operands.length) return usage(ctx, 'missing file operand');
  let time: number | null = Date.now();
  if (typeof opts.d === 'string') time = parseDate(opts.d);
  if (typeof opts.t === 'string') time = parseStamp(opts.t);
  if (time === null) return err(ctx, `invalid date format ${q(String(opts.d ?? opts.t))}`);
  if (typeof opts.r === 'string') {
    try {
      time = ctx.vfs.stat(ctx.shell.abs(opts.r)).mtime;
    } catch (e) {
      return err(ctx, `failed to get attributes of ${q(opts.r)}: ${msgOf(e)}`);
    }
  }
  let status = 0;
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    const existed = ctx.vfs.tryLookup(path) !== null;
    if (!existed && opts.c) continue;
    try {
      ctx.vfs.touch(path, time);
      if (!existed) ctx.vfs.touch(path, time);
    } catch (e) {
      status = err(ctx, `cannot touch ${q(op)}: ${msgOf(e)}`);
    }
  }
  return status;
}

const SCALE = 'KMGTPEZY';

/** Parses truncate sizes like "10", "+1K", "<2MB", "%4KiB". */
function parseSize(spec: string): { op: string; bytes: number } | null {
  const m = /^([+\-<>/%]?)(\d+)(?:([KMGTPEZY])(B|iB)?)?$/.exec(spec);
  if (!m) return null;
  const base = m[4] === 'B' ? 1000 : 1024;
  return { op: m[1], bytes: Number(m[2]) * (m[3] ? base ** (SCALE.indexOf(m[3]) + 1) : 1) };
}

function resize(op: string, size: number, n: number): number {
  switch (op) {
    case '+': return size + n;
    case '-': return Math.max(0, size - n);
    case '<': return Math.min(size, n);
    case '>': return Math.max(size, n);
    case '/': return n ? Math.floor(size / n) * n : size;
    case '%': return n ? Math.ceil(size / n) * n : size;
    default: return n;
  }
}

function truncate(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'co',
    values: 'sr',
    long: { 'no-create': 'c', 'size=': 's', 'reference=': 'r', 'io-blocks': 'o' },
  });
  if (opts.s === undefined && opts.r === undefined) return usage(ctx, "you must specify either '--size' or '--reference'");
  if (!operands.length) return usage(ctx, 'missing file operand');
  let ref: number | null = null;
  if (typeof opts.r === 'string') {
    try {
      ref = ctx.vfs.stat(ctx.shell.abs(opts.r)).size;
    } catch (e) {
      return err(ctx, `cannot stat ${q(opts.r)}: ${msgOf(e)}`);
    }
  }
  let spec = { op: '', bytes: ref ?? 0 };
  if (typeof opts.s === 'string') {
    const parsed = parseSize(opts.s);
    if (!parsed) return err(ctx, `Invalid number: ${q(opts.s)}`);
    spec = parsed;
  }
  let status = 0;
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    try {
      if (!ctx.vfs.tryLookup(path)) {
        if (opts.c) continue;
        ctx.vfs.writeFile(path, '');
      }
      const data = Buffer.from(ctx.vfs.readFile(path));
      const size = resize(spec.op, ref ?? data.length, spec.bytes);
      if (size === data.length) continue;
      const next = size < data.length ? data.subarray(0, size).toString() : data.toString() + '\0'.repeat(size - data.length);
      ctx.vfs.writeFile(path, next);
    } catch (e) {
      status = err(ctx, `cannot open ${q(op)} for writing: ${msgOf(e)}`);
    }
  }
  return status;
}

export const touchCommands: CommandTable = {
  touch: { desc: 'change file timestamps', fn: command(touch) },
  truncate: { desc: 'set a file to a given size', fn: command(truncate) },
};
