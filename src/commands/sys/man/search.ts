import type { Ctx } from '../../types.ts';
import { parseArgs } from '../../util.ts';
import { index, MANPATH, type Entry } from './lookup.ts';

export interface SearchOpts {
  sections?: string[];
  long?: boolean;
  /** apropos: every keyword must match (-a). */
  and?: boolean;
  mode?: 'regex' | 'exact' | 'wildcard';
}

const SPEC = {
  flags: 'adehlrvwV',
  values: 'sSmMLC',
  long: { 'and': 'a', 'exact': 'e', 'long': 'l', 'regex': 'r', 'wildcard': 'w', 'sections=': 's', 'section=': 's', 'manpath=': 'M', help: 'h', version: 'V' },
};

export function env(ctx: Ctx, key: string): string | undefined {
  return ctx.env[key] ?? ctx.shell.get(key);
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const glob = (s: string) => `^${literal(s).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`;

function pattern(word: string, mode: SearchOpts['mode']): RegExp {
  const source = mode === 'wildcard' ? glob(word) : mode === 'exact' ? `^${literal(word)}$` : word;
  try {
    return new RegExp(source, 'i');
  } catch {
    return new RegExp(literal(word), 'i');
  }
}

/** One whatis line; on a terminal man-db trims it to the screen width unless -l. */
function line(ctx: Ctx, e: Entry, long?: boolean): string {
  const text = `${`${e.name} (${e.section})`.padEnd(20)} - ${e.summary}`;
  const width = Number(env(ctx, 'COLUMNS')) || 80;
  return ctx.stdout.isTTY && !long && text.length > width ? `${text.slice(0, width - 3)}...\n` : `${text}\n`;
}

function inSections(e: Entry, sections?: string[]): boolean {
  return !sections || sections.some((s) => e.section.startsWith(s));
}

export function runWhatis(ctx: Ctx, names: string[], opts: SearchOpts): number {
  if (!names.length) return (ctx.stderr.write('whatis what?\n'), 1);
  const all = index(ctx).filter((e) => inSections(e, opts.sections));
  let status = 0;
  for (const name of names) {
    const re = opts.mode === 'regex' || opts.mode === 'wildcard' ? pattern(name, opts.mode) : pattern(name, 'exact');
    const hits = all.filter((e) => re.test(e.name));
    if (!hits.length) status = (ctx.stderr.write(`${name}: nothing appropriate.\n`), 16);
    for (const e of hits) ctx.stdout.write(line(ctx, e, opts.long));
  }
  return status;
}

export function runApropos(ctx: Ctx, words: string[], opts: SearchOpts): number {
  if (!words.length) return (ctx.stderr.write('apropos what?\n'), 1);
  const matchers = words.map((w) => {
    const re = pattern(w, opts.mode);
    const wordRe = new RegExp(`(^|\\W)${literal(w)}(\\W|$)`, 'i');
    return (e: Entry) => re.test(e.name) || (opts.mode === 'exact' ? wordRe.test(e.summary) : re.test(e.summary));
  });
  const all = index(ctx).filter((e) => inSections(e, opts.sections));
  const hits = all.filter((e) => (opts.and ? matchers.every((m) => m(e)) : matchers.some((m) => m(e))));
  for (const e of hits) ctx.stdout.write(line(ctx, e, opts.long));
  if (hits.length) return 0;
  for (const w of words) ctx.stderr.write(`${w}: nothing appropriate.\n`);
  return 16;
}

export function searchOpts(opts: Record<string, string | true>): SearchOpts {
  const list = opts.s ?? opts.S;
  return {
    sections: typeof list === 'string' ? list.split(/[:,]/).filter(Boolean) : undefined,
    long: !!opts.l,
    and: !!opts.a,
    mode: opts.w ? 'wildcard' : opts.e ? 'exact' : 'regex',
  };
}

export function whatis(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, SPEC);
  if (opts.V) return (ctx.stdout.write('whatis 2.12.0\n'), 0);
  if (opts.h) return (ctx.stdout.write('Usage: whatis [-dlrvw?V] [-s LIST] KEYWORD...\n'), 0);
  return runWhatis(ctx, operands, { ...searchOpts(opts), mode: opts.r ? 'regex' : opts.w ? 'wildcard' : 'exact' });
}

export function apropos(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, SPEC);
  if (opts.V) return (ctx.stdout.write('apropos 2.12.0\n'), 0);
  if (opts.h) return (ctx.stdout.write('Usage: apropos [-adelrvw?V] [-s LIST] KEYWORD...\n'), 0);
  return runApropos(ctx, operands, searchOpts(opts));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function mandb(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, { flags: 'cdhpqstuV', long: { quiet: 'q', create: 'c', debug: 'd', help: 'h', version: 'V' } });
  if (opts.V) return (ctx.stdout.write('mandb 2.12.0\n'), 0);
  const entries = index(ctx);
  if (opts.q) return 0;
  const dirs = new Set(entries.map((e) => e.path.replace(/\/[^/]+$/, '')));
  for (const root of ['/usr/share/man', MANPATH[0]]) {
    ctx.stdout.write(`Purging old database entries in ${root}...\nProcessing manual pages under ${root}...\n`);
  }
  ctx.stdout.write(
    `${count(dirs.size, 'man subdirectory contained', 'man subdirectories contained')} newer manual pages.\n` +
      `${count(entries.length, 'manual page was', 'manual pages were')} added.\n` +
      '0 stray cats were added.\n0 old database entries were purged.\n',
  );
  return 0;
}
