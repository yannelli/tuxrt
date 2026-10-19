import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fail, fsFail, parseArgs, UsageError } from '../util.ts';
import { getopt } from './args.ts';
import { chomp, eachLine, readText } from './stream.ts';
import { cmpStr } from './sortkey.ts';

function usage(ctx: Ctx, msg: string): number {
  return fail(ctx, `${msg}\nTry '${ctx.name} --help' for more information.`);
}

async function uniq(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, {
    flags: 'cdDuiz',
    values: 'fsw',
    long: { count: 'c', repeated: 'd', 'all-repeated': 'D', unique: 'u', 'ignore-case': 'i', 'skip-fields=': 'f', 'skip-chars=': 's', 'check-chars=': 'w', 'zero-terminated': 'z' },
  });
  if (operands.length > 2) return usage(ctx, `extra operand '${operands[2]}'`);
  if (opts.c && opts.D) return usage(ctx, 'printing all duplicated lines and repeat counts is meaningless');
  const [skipF, skipC, width] = ['f', 's', 'w'].map((k) => (opts[k] === undefined ? undefined : Number(opts[k])));
  if ([skipF, skipC, width].some((n) => n !== undefined && !(n >= 0))) return fail(ctx, 'invalid number');
  const fields = new RegExp(`^(?:[ \\t]*[^ \\t]+){0,${skipF ?? 0}}`);
  const key = (line: string) => {
    let s = line;
    if (skipF) s = s.replace(fields, '');
    if (skipC) s = s.slice(skipC);
    if (width !== undefined) s = s.slice(0, width);
    return opts.i ? s.toLowerCase() : s;
  };
  let out = '';
  const emit = (s: string) => (operands[1] ? (out += s) : ctx.stdout.write(s));
  let group: string[] = [];
  const flush = () => {
    if (!group.length) return;
    const n = group.length;
    if ((opts.d || opts.D) && n < 2) return void (group = []);
    if (opts.u && n > 1) return void (group = []);
    const shown = opts.D ? group : [group[0]];
    for (const l of shown) emit(`${opts.c ? `${String(n).padStart(7)} ` : ''}${l}\n`);
    group = [];
  };
  const status = await eachLine(ctx, operands.slice(0, 1), (raw) => {
    const line = chomp(raw);
    if (group.length && key(group[0]) !== key(line)) flush();
    group.push(line);
  });
  flush();
  if (operands[1]) {
    try {
      ctx.vfs.writeFile(abs(ctx, operands[1]), out);
    } catch (e) {
      return fsFail(ctx, operands[1], e);
    }
  }
  return status;
}

async function comm(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: '123',
    long: { 'check-order': 'c', 'nocheck-order': 'N', 'output-delimiter=': 'o', total: 't' },
  });
  if (operands.length < 2) return usage(ctx, operands.length ? `missing operand after '${operands[0]}'` : 'missing operand');
  if (operands.length > 2) return usage(ctx, `extra operand '${operands[2]}'`);
  const texts = [await readText(ctx, operands[0]), await readText(ctx, operands[1])];
  if (texts[0] === null || texts[1] === null) return 1;
  const [a, b] = texts.map((t) => t!.split('\n').slice(0, t!.endsWith('\n') || t === '' ? -1 : undefined));
  const delim = typeof opts.o === 'string' ? opts.o : '\t';
  const show = [!opts['1'], !opts['2'], !opts['3']];
  const counts = [0, 0, 0];
  const warned = [false, false];
  let unsorted = false;
  const write = (col: number, line: string) => {
    counts[col]++;
    if (show[col]) ctx.stdout.write(delim.repeat(show.slice(0, col).filter(Boolean).length) + line + '\n');
  };
  const checkOrder = (side: number, lines: string[], i: number) => {
    if (opts.N || i === 0 || warned[side] || cmpStr(lines[i - 1], lines[i]) <= 0) return;
    warned[side] = unsorted = true;
    ctx.stderr.write(`comm: file ${side + 1} is not in sorted order\n`);
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const d = i >= a.length ? 1 : j >= b.length ? -1 : cmpStr(a[i], b[j]);
    if (d < 0) (checkOrder(0, a, i), write(0, a[i++]));
    else if (d > 0) (checkOrder(1, b, j), write(1, b[j++]));
    else (checkOrder(0, a, i), checkOrder(1, b, j), write(2, a[i]), i++, j++);
  }
  if (opts.t) ctx.stdout.write(`${counts.join(delim)}${delim}total\n`);
  if (unsorted) return fail(ctx, 'input is not in sorted order');
  return 0;
}

function joinFields(line: string, tab: string | undefined): string[] {
  return tab === undefined ? line.trim().split(/[ \t]+/).filter(Boolean) : line.split(tab);
}

async function join(ctx: Ctx): Promise<number> {
  const { list, opts, operands } = getopt(ctx.args, {
    flags: 'i',
    values: 'tj12aveo',
    long: { 'ignore-case': 'i', header: 'H', 'check-order': 'c', 'nocheck-order': 'N' },
  });
  if (operands.length !== 2) return usage(ctx, operands.length > 2 ? `extra operand '${operands[2]}'` : operands.length ? `missing operand after '${operands[0]}'` : 'missing operand');
  const tab = typeof opts.t === 'string' ? opts.t : undefined;
  const field = [Number(opts['1'] ?? opts.j ?? 1) - 1, Number(opts['2'] ?? opts.j ?? 1) - 1];
  if (field.some((f) => !(f >= 0))) throw new UsageError('invalid field number');
  const unpaired = new Set(list.filter(([k]) => k === 'a' || k === 'v').map(([, v]) => Number(v) - 1));
  const onlyUnpaired = list.some(([k]) => k === 'v');
  const empty = typeof opts.e === 'string' ? opts.e : '';
  const out = tab ?? ' ';
  const texts = [await readText(ctx, operands[0]), await readText(ctx, operands[1])];
  if (texts[0] === null || texts[1] === null) return 1;
  const rows = texts.map((t) => t!.split('\n').filter((l, i, all) => i < all.length - 1 || l !== '').map((l) => joinFields(l, tab)));
  const keyOf = (side: number, r: string[]) => (opts.i ? (r[field[side]] ?? '').toLowerCase() : r[field[side]] ?? '');
  const format = typeof opts.o === 'string' && opts.o !== 'auto' ? opts.o.split(/[, ]+/) : null;
  const emit = (r1: string[] | null, r2: string[] | null) => {
    const key = r1 ? r1[field[0]] : r2![field[1]];
    let fields: string[];
    if (format) {
      fields = format.map((spec) => {
        if (spec === '0') return key ?? empty;
        const [f, n] = spec.split('.').map(Number);
        const r = f === 1 ? r1 : r2;
        return r?.[n - 1] ?? empty;
      });
    } else {
      fields = [key ?? empty, ...(r1 ?? []).filter((_, i) => i !== field[0]), ...(r2 ?? []).filter((_, i) => i !== field[1])];
    }
    ctx.stdout.write(`${fields.join(out)}\n`);
  };
  const [a, b] = rows;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const d = i >= a.length ? 1 : j >= b.length ? -1 : cmpStr(keyOf(0, a[i]), keyOf(1, b[j]));
    if (d < 0) {
      if (unpaired.has(0)) emit(a[i], null);
      i++;
    } else if (d > 0) {
      if (unpaired.has(1)) emit(null, b[j]);
      j++;
    } else {
      const key = keyOf(0, a[i]);
      let i2 = i;
      let j2 = j;
      while (i2 < a.length && keyOf(0, a[i2]) === key) i2++;
      while (j2 < b.length && keyOf(1, b[j2]) === key) j2++;
      if (!onlyUnpaired) for (const r1 of a.slice(i, i2)) for (const r2 of b.slice(j, j2)) emit(r1, r2);
      [i, j] = [i2, j2];
    }
  }
  return 0;
}

export const uniqCommands: CommandTable = {
  uniq: { fn: command(uniq), desc: 'report or omit repeated lines' },
  comm: { fn: command(comm), desc: 'show lines shared by sorted files' },
  join: { fn: command(join), desc: 'merge two files on a key field' },
};
