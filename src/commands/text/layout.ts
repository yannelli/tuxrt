import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs, readInput } from '../util.ts';
import { compile, RegexError } from './regex.ts';
import { chomp, eachLine } from './stream.ts';

async function nl(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    values: 'bnwsvihfd',
    long: { 'body-numbering=': 'b', 'number-format=': 'n', 'number-width=': 'w', 'number-separator=': 's', 'starting-line-number=': 'v', 'line-increment=': 'i', 'header-numbering=': 'h', 'footer-numbering=': 'f', 'section-delimiter=': 'd' },
  });
  const style = String(opts.b ?? 't');
  const format = String(opts.n ?? 'rn');
  const width = Number(opts.w ?? 6);
  const sep = String(opts.s ?? '\t');
  const incr = Number(opts.i ?? 1);
  let num = Number(opts.v ?? 1);
  if (!['ln', 'rn', 'rz'].includes(format)) return fail(ctx, `invalid line numbering format: '${format}'`);
  if (!(width > 0)) return fail(ctx, `invalid line number field width: '${opts.w}'`);
  let pick: (line: string) => boolean;
  if (style === 'a') pick = () => true;
  else if (style === 't') pick = (l) => l !== '';
  else if (style === 'n') pick = () => false;
  else if (style.startsWith('p')) {
    try {
      const re = compile(style.slice(1), false);
      pick = (l) => re.test(l);
    } catch (e) {
      if (e instanceof RegexError) return fail(ctx, e.message);
      throw e;
    }
  } else return fail(ctx, `invalid body numbering style: '${style}'`);
  const blank = ' '.repeat(width + sep.length);
  return eachLine(ctx, operands, (raw) => {
    const line = chomp(raw);
    if (!pick(line)) return ctx.stdout.write(`${blank}${line}\n`);
    const n = String(num);
    const field = format === 'ln' ? n.padEnd(width) : format === 'rz' ? n.padStart(width, '0') : n.padStart(width);
    ctx.stdout.write(`${field}${sep}${line}\n`);
    num += incr;
  });
}

function table(rows: string[][], outSep: string, right: Set<number>): string {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, [...c].length)));
  return rows
    .map((r) => r.map((c, i) => {
      if (i === r.length - 1 && !right.has(i)) return c;
      const pad = ' '.repeat(widths[i] - [...c].length);
      return right.has(i) ? pad + c : c + pad;
    }).join(outSep))
    .map((l) => `${l}\n`)
    .join('');
}

function fill(items: string[], width: number, across: boolean): string {
  const maxlen = items.reduce((m, s) => Math.max(m, [...s].length), 0);
  const colw = (maxlen + 8) & ~7;
  const cols = Math.max(1, Math.floor(width / colw));
  const rows = Math.ceil(items.length / cols);
  let out = '';
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const item = items[across ? r * cols + c : c * rows + r];
      if (item !== undefined) row.push(item);
    }
    out += row.map((s, i) => (i === row.length - 1 ? s : s + '\t'.repeat(Math.ceil((colw - [...s].length) / 8)))).join('') + '\n';
  }
  return out;
}

async function column(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'txne',
    values: 'scoRNl',
    long: { table: 't', 'fillrows': 'x', 'separator=': 's', 'output-separator=': 'o', 'output-width=': 'c', 'table-right=': 'R', 'table-columns=': 'N', 'table-noextreme=': 'E' },
  });
  const { text, status } = await readInput(ctx, operands);
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return status;
  if (opts.t) {
    const seps = typeof opts.s === 'string' ? opts.s : ' \t';
    const splitter = new RegExp(`[${seps.replace(/[\\\]^-]/g, '\\$&')}]+`);
    const rows = lines.map((l) => l.replace(new RegExp(`^${splitter.source}`), '').split(splitter));
    const right = new Set(String(opts.R ?? '').split(',').filter(Boolean).map((n) => Number(n) - 1));
    ctx.stdout.write(table(rows, typeof opts.o === 'string' ? opts.o : '  ', right));
  } else {
    ctx.stdout.write(fill(lines, Number(opts.c ?? ctx.env.COLUMNS ?? 80), !!opts.x));
  }
  return status;
}

export const layoutCommands: CommandTable = {
  nl: { fn: command(nl), desc: 'number lines of files' },
  column: { fn: command(column), desc: 'columnate lists' },
};
