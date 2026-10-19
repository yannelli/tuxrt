import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs } from '../util.ts';
import { chomp, eachLine, readText } from './stream.ts';

type Range = [number, number];

function usage(ctx: Ctx, msg: string): number {
  return fail(ctx, `${msg}\nTry '${ctx.name} --help' for more information.`);
}

/** Parses "1,3-5,7-" into sorted ranges, merging overlaps like GNU cut. */
function parseList(spec: string, fields: boolean): Range[] | string {
  const ranges: Range[] = [];
  for (const part of spec.split(/[, ]/)) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || part === '') return fields ? `invalid field value '${part}'` : `invalid byte/character position '${part}'`;
    if (part === '-') return 'invalid range with no endpoint: -';
    const lo = m[1] ? Number(m[1]) : 1;
    const hi = m[2] ? (m[3] ? Number(m[3]) : Infinity) : lo;
    if ((m[1] && lo === 0) || (m[3] && Number(m[3]) === 0)) return fields ? 'fields are numbered from 1' : 'byte/character positions are numbered from 1';
    if (hi < lo) return 'invalid decreasing range';
    ranges.push([lo, hi]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

function complement(ranges: Range[]): Range[] {
  const out: Range[] = [];
  let next = 1;
  for (const [lo, hi] of ranges) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next !== Infinity) out.push([next, Infinity]);
  return out;
}

async function cut(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'nsz',
    values: 'bcfd',
    long: { 'bytes=': 'b', 'characters=': 'c', 'fields=': 'f', 'delimiter=': 'd', 'only-delimited': 's', complement: 'C', 'output-delimiter=': 'o', 'zero-terminated': 'z' },
  });
  const modes = (['b', 'c', 'f'] as const).filter((m) => opts[m] !== undefined);
  if (modes.length > 1) return usage(ctx, 'only one type of list may be specified');
  const mode = modes[0];
  if (!mode) return usage(ctx, 'you must specify a list of bytes, characters, or fields');
  if (mode !== 'f' && opts.d !== undefined) return usage(ctx, 'an input delimiter may be specified only when operating on fields');
  if (mode !== 'f' && opts.s) return usage(ctx, 'suppressing non-delimited lines makes sense\n\tonly when operating on fields');
  const delim = typeof opts.d === 'string' ? opts.d : '\t';
  if ([...delim].length !== 1) return usage(ctx, 'the delimiter must be a single character');
  const parsed = parseList(String(opts[mode]), mode === 'f');
  if (typeof parsed === 'string') return usage(ctx, parsed);
  const ranges = opts.C ? complement(parsed) : parsed;
  const selected = (i: number) => ranges.some(([lo, hi]) => i >= lo && i <= hi);
  const outDelim = typeof opts.o === 'string' ? opts.o : mode === 'f' ? delim : undefined;
  const eol = opts.z ? '\0' : '\n';
  return eachLine(ctx, operands, (raw) => {
    const line = chomp(raw);
    if (mode === 'f') {
      if (!line.includes(delim)) {
        if (!opts.s) ctx.stdout.write(line + eol);
        return;
      }
      ctx.stdout.write(line.split(delim).filter((_, i) => selected(i + 1)).join(outDelim) + eol);
      return;
    }
    let out = '';
    [...line].forEach((ch, i) => {
      if (!selected(i + 1)) return;
      if (outDelim !== undefined && out !== '' && ranges.some(([lo]) => lo === i + 1)) out += outDelim;
      out += ch;
    });
    ctx.stdout.write(out + eol);
  });
}

function delimiters(spec: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] !== '\\') out.push(spec[i]);
    else {
      const c = spec[++i];
      out.push(c === 'n' ? '\n' : c === 't' ? '\t' : c === '0' ? '' : c === undefined ? '\\' : c);
    }
  }
  return out.length ? out : [''];
}

async function paste(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'sz', values: 'd', long: { 'delimiters=': 'd', serial: 's', 'zero-terminated': 'z' } });
  const delims = delimiters(typeof opts.d === 'string' ? opts.d : '\t');
  const files = operands.length ? operands : ['-'];
  const stdinLines: string[] = [];
  const sources: string[][] = [];
  let stdinRead = false;
  for (const f of files) {
    if (f === '-' && stdinRead) {
      sources.push(stdinLines);
      continue;
    }
    const text = await readText(ctx, f);
    if (text === null) return 1;
    const lines = text === '' ? [] : chomp(text).split('\n');
    if (f === '-') {
      stdinRead = true;
      for (const l of lines) stdinLines.push(l);
      sources.push(stdinLines);
    } else sources.push(lines);
  }
  if (opts.s) {
    for (const src of new Set(sources)) {
      ctx.stdout.write(src.map((l, i) => (i ? delims[(i - 1) % delims.length] : '') + l).join('') + '\n');
      if (src === stdinLines) src.length = 0;
    }
    return 0;
  }
  const cursors = new Map<string[], number>();
  const take = (src: string[]) => {
    const i = cursors.get(src) ?? 0;
    cursors.set(src, i + 1);
    return src[i];
  };
  for (;;) {
    const row = sources.map(take);
    if (row.every((l) => l === undefined)) break;
    ctx.stdout.write(row.map((l, i) => (i ? delims[(i - 1) % delims.length] : '') + (l ?? '')).join('') + '\n');
  }
  return 0;
}

export const cutCommands: CommandTable = {
  cut: { fn: command(cut), desc: 'remove sections from each line of files' },
  paste: { fn: command(paste), desc: 'merge lines of files' },
};
