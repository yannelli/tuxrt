import { FsError } from '../../vfs/errors.ts';
import { readAll } from '../../shell/io.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fsFail, parseArgs } from '../util.ts';
import { toBytes } from './stream.ts';

type Counts = [lines: number, words: number, chars: number, bytes: number, maxlen: number];

function count(text: string): Counts {
  let lines = 0;
  let maxlen = 0;
  for (const line of text.split('\n')) {
    let col = 0;
    for (const ch of line) col = ch === '\t' ? col + 8 - (col % 8) : col + 1;
    maxlen = Math.max(maxlen, col);
  }
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  const words = text.match(/[^ \t\n\v\f\r]+/g)?.length ?? 0;
  const chars = text.length - (text.match(/[\ud800-\udbff][\udc00-\udfff]/g)?.length ?? 0);
  return [lines, words, chars, toBytes(text).length, maxlen];
}

async function wc(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'lwcmL',
    long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm', 'max-line-length': 'L', 'total=': 'T' },
  });
  let show = [opts.l, opts.w, opts.m, opts.c, opts.L].map(Boolean);
  if (!show.some(Boolean)) show = [true, true, false, true, false];
  const files = operands.length ? operands : ['-'];
  const rows: [Counts, string | undefined][] = [];
  let status = 0;
  let regular = 0;
  let minWidth = 1;
  for (const f of files) {
    try {
      const text = f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
      if (f === '-') minWidth = 7;
      else regular += ctx.vfs.stat(abs(ctx, f)).size;
      rows.push([count(text), operands.length ? f : undefined]);
    } catch (e) {
      status = fsFail(ctx, f, e);
      if (e instanceof FsError && e.code === 'EISDIR') {
        minWidth = 7;
        rows.push([[0, 0, 0, 0, 0], f]);
      }
    }
  }
  const single = files.length === 1 && show.filter(Boolean).length === 1;
  const width = single ? 1 : Math.max(minWidth, String(regular).length);
  const mode = opts.T ?? 'auto';
  if (mode === 'always' || mode === 'only' || (mode === 'auto' && files.length > 1)) {
    const total = rows.reduce<Counts>((t, [c]) => t.map((v, i) => (i === 4 ? Math.max(v, c[i]) : v + c[i])) as Counts, [0, 0, 0, 0, 0]);
    if (mode === 'only') rows.length = 0;
    rows.push([total, mode === 'only' ? undefined : 'total']);
  }
  for (const [c, name] of rows) {
    const cols = c.filter((_, i) => show[i]).map((v) => String(v).padStart(mode === 'only' ? 1 : width));
    ctx.stdout.write(`${cols.join(' ')}${name === undefined ? '' : ` ${name}`}\n`);
  }
  return status;
}

export const wcCommands: CommandTable = {
  wc: { fn: command(wc), desc: 'count lines, words and bytes' },
};
