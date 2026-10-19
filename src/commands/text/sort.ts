import { errMessage, FsError } from '../../vfs/errors.ts';
import { readAll } from '../../shell/io.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fail, fsFail } from '../util.ts';
import { getopt } from './args.ts';
import { cmpStr, compareKey, keyText, parseKey, wholeLineKey, type Key } from './sortkey.ts';

const LONG: Record<string, string> = {
  'ignore-leading-blanks': 'b', check: 'c', 'dictionary-order': 'd', 'ignore-case': 'f', 'general-numeric-sort': 'g',
  'human-numeric-sort': 'h', 'ignore-nonprinting': 'i', 'month-sort': 'M', merge: 'm', 'numeric-sort': 'n',
  'random-sort': 'R', reverse: 'r', stable: 's', unique: 'u', 'version-sort': 'V', 'zero-terminated': 'z',
  'key=': 'k', 'output=': 'o', 'field-separator=': 't', 'buffer-size=': 'S', 'temporary-directory=': 'T', 'parallel=': 'P',
};

async function sort(ctx: Ctx): Promise<number> {
  const { list, opts, operands } = getopt(ctx.args, { flags: 'bcCdfghiMmnRrsuVz', values: 'kotST', long: LONG });
  const global = [...'bdfghiMnRrV'].filter((c) => opts[c]).join('');
  const keys: Key[] = [];
  for (const [k, v] of list) {
    if (k !== 'k') continue;
    const key = parseKey(String(v), global);
    if (typeof key === 'string') return fail(ctx, key) + 1;
    keys.push(key);
  }
  if (!keys.length) {
    const whole = wholeLineKey(global);
    if (whole) keys.push(whole);
  }
  let tab: string | undefined;
  if (typeof opts.t === 'string') {
    tab = opts.t === '\\0' ? '\0' : opts.t;
    if (tab.length !== 1) return fail(ctx, `multi-character tab '${opts.t}'`) + 1;
  }
  const sep = opts.z ? '\0' : '\n';
  const files = operands.length ? operands : ['-'];
  const check = opts.c || opts.C;
  if (check && files.length > 1) return fail(ctx, `extra operand '${files[1]}' not allowed with -${opts.c ? 'c' : 'C'}`) + 1;

  let lines: string[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
    } catch (e) {
      const isDir = e instanceof FsError && e.code === 'EISDIR';
      return fail(ctx, `${isDir ? 'read failed' : 'cannot read'}: ${f}: ${errMessage(e)}`) + 1;
    }
    const part = text.split(sep);
    if (part.at(-1) === '') part.pop();
    lines = lines.concat(part);
  }

  const compare = (a: string, b: string): number => {
    if (keys.length) {
      for (const k of keys) {
        const d = compareKey(keyText(a, k, tab), keyText(b, k, tab), k.opts);
        if (d) return d;
      }
      if (opts.u || opts.s) return 0;
    }
    const d = cmpStr(a, b);
    return global.includes('r') ? -d : d;
  };

  if (check) {
    for (let i = 1; i < lines.length; i++) {
      const d = compare(lines[i - 1], lines[i]);
      if (d > 0 || (opts.u && d === 0)) {
        if (opts.c && opts.c !== 'quiet' && opts.c !== 'silent') ctx.stderr.write(`sort: ${files[0]}:${i + 1}: disorder: ${lines[i]}\n`);
        return 1;
      }
    }
    return 0;
  }

  lines.sort(compare);
  if (opts.u) lines = lines.filter((l, i) => i === 0 || compare(lines[i - 1], l) !== 0);
  const out = lines.length ? lines.join(sep) + sep : '';
  if (typeof opts.o === 'string') {
    try {
      ctx.vfs.writeFile(abs(ctx, opts.o), out);
    } catch (e) {
      return fsFail(ctx, opts.o, e, 'open failed') + 1;
    }
  } else ctx.stdout.write(out);
  return 0;
}

export const sortCommands: CommandTable = {
  sort: { fn: command(sort), desc: 'sort lines of text files' },
};
