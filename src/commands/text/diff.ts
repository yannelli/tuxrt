import { readAll } from '../../shell/io.ts';
import { errMessage } from '../../vfs/errors.ts';
import { basename } from '../../vfs/path.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { abs, command } from '../util.ts';
import { getopt } from './args.ts';
import { diffOps, type Op } from './myers.ts';

interface Side {
  name: string;
  lines: string[];
  keys: string[];
  noEol: boolean;
  mtime: number;
  binary: boolean;
}

interface Change {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

interface Opts {
  unified: number | null;
  brief: boolean;
  same: boolean;
  recursive: boolean;
  flags: string[];
  key: (l: string) => string;
}

function load(name: string, text: string, mtime: number, o: Opts): Side {
  const noEol = text !== '' && !text.endsWith('\n');
  const lines = text === '' ? [] : (noEol ? text : text.slice(0, -1)).split('\n');
  const keys = lines.map(o.key);
  if (noEol) keys[keys.length - 1] += '\0';
  return { name, lines, keys, noEol, mtime, binary: text.includes('\0') };
}

function changes(ops: Op[]): Change[] {
  const out: Change[] = [];
  let cur: Change | null = null;
  for (const op of ops) {
    if (op.kind === '=') {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { a0: op.a, a1: op.a, b0: op.b, b1: op.b }));
    if (op.kind === '-') cur.a1 = op.a + 1;
    else cur.b1 = op.b + 1;
  }
  return out;
}

function stamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${String(ms % 1000).padStart(3, '0')}000000 +0000`;
}

function lineOut(side: Side, i: number, prefix: string): string {
  const eol = side.noEol && i === side.lines.length - 1 ? '\n\\ No newline at end of file\n' : '\n';
  return prefix + side.lines[i] + eol;
}

function normal(a: Side, b: Side, cs: Change[]): string {
  const r = (lo: number, hi: number) => (hi - lo === 1 ? `${lo + 1}` : `${lo + 1},${hi}`);
  let out = '';
  for (const c of cs) {
    const del = c.a1 > c.a0;
    const ins = c.b1 > c.b0;
    out += del && ins ? `${r(c.a0, c.a1)}c${r(c.b0, c.b1)}\n` : del ? `${r(c.a0, c.a1)}d${c.b0}\n` : `${c.a0}a${r(c.b0, c.b1)}\n`;
    for (let i = c.a0; i < c.a1; i++) out += lineOut(a, i, '< ');
    if (del && ins) out += '---\n';
    for (let j = c.b0; j < c.b1; j++) out += lineOut(b, j, '> ');
  }
  return out;
}

function unified(a: Side, b: Side, cs: Change[], ctxLines: number): string {
  const range = (s: number, len: number) => (len === 0 ? `${s},0` : len === 1 ? `${s + 1}` : `${s + 1},${len}`);
  let out = `--- ${a.name}\t${stamp(a.mtime)}\n+++ ${b.name}\t${stamp(b.mtime)}\n`;
  for (let g = 0; g < cs.length; ) {
    let h = g;
    while (h + 1 < cs.length && cs[h + 1].a0 - cs[h].a1 <= 2 * ctxLines) h++;
    const aStart = Math.max(0, cs[g].a0 - ctxLines);
    const bStart = cs[g].b0 - (cs[g].a0 - aStart);
    const aEnd = Math.min(a.lines.length, cs[h].a1 + ctxLines);
    const bEnd = cs[h].b1 + (aEnd - cs[h].a1);
    out += `@@ -${range(aStart, aEnd - aStart)} +${range(bStart, bEnd - bStart)} @@\n`;
    let pos = aStart;
    for (const c of cs.slice(g, h + 1)) {
      for (; pos < c.a0; pos++) out += lineOut(a, pos, ' ');
      for (let i = c.a0; i < c.a1; i++) out += lineOut(a, i, '-');
      for (let j = c.b0; j < c.b1; j++) out += lineOut(b, j, '+');
      pos = c.a1;
    }
    for (; pos < aEnd; pos++) out += lineOut(a, pos, ' ');
    g = h + 1;
  }
  return out;
}

/** Compares two files; returns 0 same, 1 different. */
function compareFiles(ctx: Ctx, a: Side, b: Side, o: Opts): number {
  const cs = changes(diffOps(a.keys, b.keys));
  if (!cs.length) {
    if (o.same) ctx.stdout.write(`Files ${a.name} and ${b.name} are identical\n`);
    return 0;
  }
  if (o.brief) ctx.stdout.write(`Files ${a.name} and ${b.name} differ\n`);
  else if (a.binary || b.binary) ctx.stdout.write(`Binary files ${a.name} and ${b.name} differ\n`);
  else ctx.stdout.write(o.unified === null ? normal(a, b, cs) : unified(a, b, cs, o.unified));
  return 1;
}

function readSide(ctx: Ctx, name: string, o: Opts): Side {
  const p = abs(ctx, name);
  return load(name, ctx.vfs.readFile(p), ctx.vfs.stat(p).mtime, o);
}

function compareDirs(ctx: Ctx, da: string, db: string, o: Opts): number {
  const [la, lb] = [ctx.vfs.readdir(abs(ctx, da)), ctx.vfs.readdir(abs(ctx, db))];
  let status = 0;
  for (const name of [...new Set([...la, ...lb])].sort()) {
    const [pa, pb] = [`${da.replace(/\/$/, '')}/${name}`, `${db.replace(/\/$/, '')}/${name}`];
    if (!la.includes(name) || !lb.includes(name)) {
      ctx.stdout.write(`Only in ${la.includes(name) ? da : db}: ${name}\n`);
      status = 1;
      continue;
    }
    const [dirA, dirB] = [ctx.vfs.isDir(abs(ctx, pa)), ctx.vfs.isDir(abs(ctx, pb))];
    if (dirA && dirB) {
      if (o.recursive) status = Math.max(status, compareDirs(ctx, pa, pb, o));
      else ctx.stdout.write(`Common subdirectories: ${pa} and ${pb}\n`);
    } else if (dirA !== dirB) {
      ctx.stdout.write(`File ${dirA ? pa : pb} is a directory while file ${dirA ? pb : pa} is a regular file\n`);
      status = 1;
    } else {
      const [a, b] = [readSide(ctx, pa, o), readSide(ctx, pb, o)];
      if (!o.brief && a.keys.join('\n') !== b.keys.join('\n')) ctx.stdout.write(`diff ${[...o.flags, pa, pb].join(' ')}\n`);
      status = Math.max(status, compareFiles(ctx, a, b, o));
    }
  }
  return status;
}

async function diff(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, {
    flags: 'uqsibwBrNaT',
    values: 'U',
    long: { 'unified=': 'U', brief: 'q', 'report-identical-files': 's', 'ignore-case': 'i', 'ignore-space-change': 'b', 'ignore-all-space': 'w', 'ignore-blank-lines': 'B', recursive: 'r', 'new-file': 'N', text: 'a', 'color=': 'C', 'strip-trailing-cr': 'R' },
  });
  if (operands.length !== 2) {
    ctx.stderr.write(`diff: ${operands.length < 2 ? `missing operand after '${operands.at(-1) ?? 'diff'}'` : `extra operand '${operands[2]}'`}\ndiff: Try 'diff --help' for more information.\n`);
    return 2;
  }
  const o: Opts = {
    unified: opts.U !== undefined ? Number(opts.U) : opts.u ? 3 : null,
    brief: !!opts.q,
    same: !!opts.s,
    recursive: !!opts.r,
    flags: ctx.args.filter((a) => a.startsWith('-') && a !== '-' && !operands.includes(a)),
    key: (l) => {
      let k = opts.R ? l.replace(/\r$/, '') : l;
      if (opts.i) k = k.toLowerCase();
      if (opts.w) k = k.replace(/[ \t]+/g, '');
      else if (opts.b) k = k.replace(/[ \t]+/g, ' ').replace(/ $/, '');
      return k;
    },
  };
  let [fa, fb] = operands;
  const isDir = (f: string) => f !== '-' && ctx.vfs.isDir(abs(ctx, f));
  try {
    if (isDir(fa) && isDir(fb)) return compareDirs(ctx, fa, fb, o);
  } catch (e) {
    ctx.stderr.write(`diff: ${errMessage(e)}\n`);
    return 2;
  }
  if (isDir(fa)) fa = `${fa.replace(/\/$/, '')}/${basename(fb)}`;
  else if (isDir(fb)) fb = `${fb.replace(/\/$/, '')}/${basename(fa)}`;
  const sides: Side[] = [];
  for (const f of [fa, fb]) {
    try {
      sides.push(f === '-' ? load('-', await readAll(ctx.stdin), Date.now(), o) : readSide(ctx, f, o));
    } catch (e) {
      ctx.stderr.write(`diff: ${f}: ${errMessage(e)}\n`);
      return 2;
    }
  }
  return compareFiles(ctx, sides[0], sides[1], o);
}

export const diffCommands: CommandTable = {
  diff: { fn: command(diff), desc: 'compare files line by line' },
};
