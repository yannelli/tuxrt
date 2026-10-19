import { escapeRe, globToRegExp } from '../../../shell/glob.ts';
import type { Ctx } from '../../types.ts';
import { abs, UsageError } from '../../util.ts';
import { getopt } from '../args.ts';
import { posixToJs } from '../regex.ts';
import { errMessage } from '../../../vfs/errors.ts';

/** Fatal grep errors (bad regex, unreadable -f file): exit 2. */
export class GrepError extends Error {}

export interface GrepOpts {
  tests: RegExp[];
  finders: RegExp[];
  invert: boolean;
  count: boolean;
  filesWith: boolean;
  filesWithout: boolean;
  quiet: boolean;
  only: boolean;
  lineNumber: boolean;
  byteOffset: boolean;
  withName: boolean | undefined;
  silent: boolean;
  max: number;
  before: number;
  after: number;
  color: boolean;
  label: string;
  nul: boolean;
  recursive: boolean;
  deref: boolean;
  text: boolean;
  skipBinary: boolean;
  include: RegExp[];
  exclude: RegExp[];
  excludeDir: RegExp[];
  files: string[];
}

const LONG: Record<string, string> = {
  'extended-regexp': 'E', 'fixed-strings': 'F', 'basic-regexp': 'G', 'perl-regexp': 'P', 'regexp=': 'e', 'file=': 'f',
  'ignore-case': 'i', 'no-ignore-case': 'Y', 'invert-match': 'v', 'word-regexp': 'w', 'line-regexp': 'x', count: 'c',
  'files-with-matches': 'l', 'files-without-match': 'L', quiet: 'q', silent: 'q', 'no-messages': 's', 'only-matching': 'o',
  'line-number': 'n', 'no-filename': 'h', 'with-filename': 'H', 'byte-offset': 'b', recursive: 'r', 'dereference-recursive': 'R',
  null: 'Z', text: 'a', 'max-count=': 'm', 'after-context=': 'A', 'before-context=': 'B', 'context=': 'C', color: 'K', colour: 'K',
  'include=': 'include', 'exclude=': 'exclude', 'exclude-dir=': 'exclude-dir', 'label=': 'label', 'line-buffered': 'U',
  'binary-files=': 'binary-files', 'directories=': 'd', 'devices=': 'D', 'initial-tab': 'T',
};

function count(v: string | true | undefined, what: string): number {
  if (v === undefined) return 0;
  if (!/^\d+$/.test(String(v))) throw new UsageError(`${v}: invalid ${what} argument`);
  return Number(v);
}

/** Parses grep's command line; bad patterns throw RegexError/GrepError, bad options UsageError. */
export function parseGrep(ctx: Ctx): GrepOpts {
  const { list, opts, operands } = getopt(ctx.args, {
    flags: 'EFGPiyYvwxclLqsonhHbrRZaITU',
    values: 'efmABCdD',
    numeric: 'C',
    long: LONG,
  });
  let mode = ctx.name === 'egrep' ? 'E' : ctx.name === 'fgrep' ? 'F' : 'G';
  let icase = false;
  let withName: boolean | undefined;
  const patterns: string[] = [];
  let explicit = false;
  for (const [k, v] of list) {
    if ('EFGP'.includes(k)) mode = k;
    else if (k === 'i' || k === 'y') icase = true;
    else if (k === 'Y') icase = false;
    else if (k === 'H' || k === 'h') withName = k === 'H';
    else if (k === 'e') {
      explicit = true;
      patterns.push(...String(v).split('\n'));
    } else if (k === 'f') {
      explicit = true;
      let text: string;
      try {
        text = ctx.vfs.readFile(abs(ctx, String(v)));
      } catch (e) {
        throw new GrepError(`${v}: ${errMessage(e)}`);
      }
      if (text !== '') for (const p of text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)) patterns.push(p);
    }
  }
  const files = [...operands];
  if (!explicit) {
    if (!files.length) throw new UsageError('no pattern');
    patterns.push(...files.shift()!.split('\n'));
  }
  const sources = patterns.map((p) => {
    let src = mode === 'F' ? escapeRe(p) : mode === 'P' ? p : posixToJs(p, mode === 'E');
    if (opts.w) src = `(?<!\\w)(?:${src})(?!\\w)`;
    if (opts.x) src = `^(?:${src})$`;
    return src;
  });
  const build = (flags: string) =>
    sources.map((s) => {
      try {
        return new RegExp(s, flags);
      } catch (e) {
        throw new GrepError((e as Error).message.replace(/^Invalid regular expression: \/.*\/\w*: /, ''));
      }
    });
  const context = count(opts.C, 'context length');
  const colorWhen = opts.K === true ? 'auto' : String(opts.K ?? 'never');
  if (!['always', 'never', 'auto', 'yes', 'no', 'force', 'none', 'tty', 'if-tty'].includes(colorWhen)) throw new UsageError(`invalid argument '${colorWhen}' for '--color'`);
  const recursive = !!(opts.r || opts.R) || opts.d === 'recurse';
  const globs = (key: string) => list.filter(([k]) => k === key).map(([, v]) => globToRegExp(String(v)));
  return {
    tests: build(icase ? 'i' : ''),
    finders: build(icase ? 'gi' : 'g'),
    invert: !!opts.v,
    count: !!opts.c,
    filesWith: !!opts.l,
    filesWithout: !!opts.L,
    quiet: !!opts.q,
    only: !!opts.o,
    lineNumber: !!opts.n,
    byteOffset: !!opts.b,
    withName,
    silent: !!opts.s,
    max: opts.m === undefined ? Infinity : Number(opts.m) < 0 ? Infinity : count(opts.m, 'max count'),
    before: opts.B !== undefined ? count(opts.B, 'context length') : context,
    after: opts.A !== undefined ? count(opts.A, 'context length') : context,
    color: ['always', 'yes', 'force'].includes(colorWhen) || (['auto', 'tty', 'if-tty'].includes(colorWhen) && !!ctx.stdout.isTTY),
    label: typeof opts.label === 'string' ? opts.label : '(standard input)',
    nul: !!opts.Z,
    recursive,
    deref: !!opts.R,
    text: !!opts.a || opts['binary-files'] === 'text',
    skipBinary: !!opts.I || opts['binary-files'] === 'without-match',
    include: globs('include'),
    exclude: globs('exclude'),
    excludeDir: globs('exclude-dir'),
    files,
  };
}
