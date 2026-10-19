import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, readInput } from '../util.ts';
import { getopt } from './args.ts';
import { chomp, eachLine } from './stream.ts';

function adjust(col: number, c: string, bytes: boolean): number {
  if (bytes) return col + 1;
  if (c === '\b') return Math.max(0, col - 1);
  if (c === '\r') return 0;
  return c === '\t' ? col + 8 - (col % 8) : col + 1;
}

/** Port of GNU fold's per-line loop. */
function foldLine(line: string, width: number, spaces: boolean, bytes: boolean): string {
  let out = '';
  let buf: string[] = [];
  let col = 0;
  for (const c of line) {
    for (;;) {
      const next = adjust(col, c, bytes);
      if (next <= width) {
        buf.push(c);
        col = next;
        break;
      }
      const blank = spaces ? buf.findLastIndex((b) => b === ' ' || b === '\t') : -1;
      if (blank !== -1) {
        out += buf.slice(0, blank + 1).join('') + '\n';
        buf = buf.slice(blank + 1);
        col = buf.reduce((n, b) => adjust(n, b, bytes), 0);
        continue;
      }
      if (!buf.length) {
        buf.push(c);
        col = next;
        break;
      }
      out += buf.join('') + '\n';
      buf = [];
      col = 0;
    }
  }
  return out + buf.join('');
}

async function fold(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, { flags: 'bs', values: 'w', numeric: 'w', long: { bytes: 'b', spaces: 's', 'width=': 'w' } });
  const width = Number(opts.w ?? 80);
  if (!(width > 0)) return fail(ctx, `invalid number of columns: '${opts.w}'`);
  return eachLine(ctx, operands, (l) => {
    ctx.stdout.write(foldLine(chomp(l), width, !!opts.s, !!opts.b) + (l.endsWith('\n') ? '\n' : ''));
  });
}

type Stops = (col: number) => number;

function tabStops(spec: string | true | undefined): Stops | null {
  if (spec === undefined || spec === true) return (c) => c + 8 - (c % 8);
  const list = spec.split(/[, ]+/).filter(Boolean).map(Number);
  if (list.some((n) => !(n > 0))) return null;
  if (list.length === 1) return (c) => c + list[0] - (c % list[0]);
  return (c) => list.find((s) => s > c) ?? c + 1;
}

async function expand(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, { flags: 'i', values: 't', numeric: 't', long: { initial: 'i', 'tabs=': 't' } });
  const next = tabStops(opts.t);
  if (!next) return fail(ctx, `tab size contains invalid character(s): '${opts.t}'`);
  return eachLine(ctx, operands, (l) => {
    let out = '';
    let col = 0;
    let leading = true;
    for (const c of chomp(l)) {
      if (c === '\t' && (leading || !opts.i)) {
        const to = next(col);
        out += ' '.repeat(to - col);
        col = to;
        continue;
      }
      if (c !== ' ' && c !== '\t') leading = false;
      out += c;
      col = adjust(col, c, false);
    }
    ctx.stdout.write(out + (l.endsWith('\n') ? '\n' : ''));
  });
}

async function unexpand(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, { flags: 'a', values: 't', numeric: 't', long: { all: 'a', 'first-only': 'f', 'tabs=': 't' } });
  const next = tabStops(opts.t);
  if (!next) return fail(ctx, `tab size contains invalid character(s): '${opts.t}'`);
  const all = (!!opts.a || opts.t !== undefined) && !opts.f;
  return eachLine(ctx, operands, (l) => {
    const chars = [...chomp(l)];
    let out = '';
    let col = 0;
    let blanks = '';
    let leading = true;
    chars.forEach((c, i) => {
      const blank = c === ' ' || c === '\t';
      if (!blank || (!leading && !all)) {
        out += blanks + c;
        blanks = '';
        if (!blank) leading = false;
        col = adjust(col, c, false);
        return;
      }
      const stop = next(col);
      col = c === '\t' ? stop : col + 1;
      blanks += c;
      if (col !== stop) return;
      const lone = blanks === ' ' && chars[i + 1] !== ' ' && chars[i + 1] !== '\t';
      out += lone ? ' ' : '\t';
      blanks = '';
    });
    ctx.stdout.write(out + blanks + (l.endsWith('\n') ? '\n' : ''));
  });
}

/** Greedy paragraph fill; GNU fmt's optimal-fit line breaking is not reproduced. */
async function fmt(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, { flags: 'cstu', values: 'wgp', numeric: 'w', long: { 'width=': 'w', 'uniform-spacing': 'u', 'split-only': 's' } });
  const width = Number(opts.w ?? 75);
  const { text, status } = await readInput(ctx, operands);
  const paragraphs: string[][] = [];
  let cur: string[] = [];
  let out = '';
  const flush = () => {
    if (cur.length) paragraphs.push(cur);
    cur = [];
  };
  for (const line of text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)) {
    if (line.trim() === '') {
      flush();
      paragraphs.push([]);
    } else if (opts.s) {
      paragraphs.push([line]);
    } else cur.push(line);
  }
  flush();
  for (const p of paragraphs) {
    if (!p.length) {
      out += '\n';
      continue;
    }
    const indent = /^\s*/.exec(p[0])![0];
    const rest = p.length > 1 ? /^\s*/.exec(p[1])![0] : indent;
    const words = p.flatMap((l) => l.trim().split(/\s+/).map((w, i, a) => {
      const sentence = /[.?!]['")\]]*$/.test(w) && (i === a.length - 1 || !!opts.u);
      return [w, sentence ? '  ' : ' '];
    }));
    let line = indent;
    let fresh = true;
    let gap = '';
    for (const [w, after] of words) {
      if (!fresh && line.length + gap.length + w.length > width) {
        out += line + '\n';
        line = rest;
        fresh = true;
      }
      line += (fresh ? '' : gap) + w;
      fresh = false;
      gap = after;
    }
    out += line + '\n';
  }
  ctx.stdout.write(out);
  return status;
}

export const wrapCommands: CommandTable = {
  fold: { fn: command(fold), desc: 'wrap each input line to fit in specified width' },
  expand: { fn: command(expand), desc: 'convert tabs to spaces' },
  unexpand: { fn: command(unexpand), desc: 'convert spaces to tabs' },
  fmt: { fn: command(fmt), desc: 'simple optimal text formatter' },
};
