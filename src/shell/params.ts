import { evaluate } from './arith.ts';
import { globSource } from './glob.ts';
import type { Shell } from './shell.ts';

export class ParamError extends Error {}

/** Values of $name, $1, $?, $#, $@ ... Returns undefined when unset. */
export function lookupParam(name: string, shell: Shell): string | undefined {
  switch (name) {
    case '?': return String(shell.status);
    case '$': return String(shell.pid);
    case '!': return shell.lastBg ? String(shell.lastBg) : undefined;
    case '#': return String(shell.positional.length);
    case '0': return shell.argv0;
    case '-': return [shell.options.errexit && 'e', shell.options.xtrace && 'x', shell.options.nounset && 'u', 'hB', shell.interactive && 'i'].filter(Boolean).join('');
    case '@':
    case '*': return shell.positional.join(name === '*' ? (shell.get('IFS') ?? ' ')[0] ?? '' : ' ');
  }
  if (/^\d+$/.test(name)) return shell.positional[Number(name) - 1];
  return shell.get(name);
}

export function checkSet(name: string, value: string | undefined, shell: Shell): string {
  if (value === undefined && shell.options.nounset && !['@', '*'].includes(name)) throw new ParamError(`${name}: unbound variable`);
  return value ?? '';
}

type Sub = (word: string) => Promise<string>;

/** Evaluates the inside of ${...}. `word` expands operands; `pattern` expands glob operands. */
export async function expandBraced(expr: string, shell: Shell, word: Sub, pattern: Sub): Promise<string> {
  if (expr === '#') return String(shell.positional.length);
  const len = /^#([A-Za-z_]\w*|\d+|[@*])$/.exec(expr);
  if (len) {
    if (len[1] === '@' || len[1] === '*') return String(shell.positional.length);
    return String([...checkSet(len[1], lookupParam(len[1], shell), shell)].length);
  }
  const m = /^(!?)([A-Za-z_]\w*|\d+|[@*#?$!0-])([\s\S]*)$/.exec(expr);
  if (!m) throw new ParamError(`\${${expr}}: bad substitution`);
  let [, indirect, name, rest] = m;
  if (indirect) name = lookupParam(name, shell) ?? '';
  const value = lookupParam(name, shell);
  if (rest === '') return checkSet(name, value, shell);

  const op = /^(:?[-=?+])([\s\S]*)$/.exec(rest);
  if (op) {
    const [, kind, operand] = op;
    const missing = kind.startsWith(':') ? !value : value === undefined;
    switch (kind.replace(':', '')) {
      case '-': return missing ? word(operand) : value!;
      case '+': return missing ? '' : word(operand);
      case '=': {
        if (!missing) return value!;
        if (!/^[A-Za-z_]/.test(name)) throw new ParamError(`$${name}: cannot assign in this way`);
        const v = await word(operand);
        shell.set(name, v);
        return v;
      }
      case '?':
        if (missing) throw new ParamError(`${name}: ${operand ? await word(operand) : 'parameter null or not set'}`);
        return value!;
    }
  }
  const v = checkSet(name, value, shell);

  const trim = /^(##?|%%?)([\s\S]*)$/.exec(rest);
  if (trim) return trimPattern(v, trim[1], await pattern(trim[2]));

  const sub = /^\/([/#%]?)((?:\\.|[^/])*)(?:\/([\s\S]*))?$/.exec(rest);
  if (sub) {
    const [, mode, pat, rep = ''] = sub;
    const src = globSource(await pattern(pat));
    const replacement = await word(rep);
    const re = new RegExp(mode === '#' ? `^${src}` : mode === '%' ? `${src}$` : src, mode === '/' ? 'g' : '');
    return v.replace(re, () => replacement);
  }

  const slice = /^:\s*(-?[^:]*)(?::([\s\S]*))?$/.exec(rest);
  if (slice) {
    const vars = { get: (n: string) => shell.get(n) ?? '', set: (n: string, val: string) => shell.set(n, val) };
    let start = evaluate(slice[1], vars);
    if (start < 0) start = Math.max(0, v.length + start);
    if (slice[2] === undefined) return v.slice(start);
    const length = evaluate(slice[2], vars);
    return length < 0 ? v.slice(start, v.length + length) : v.slice(start, start + length);
  }

  const kase = /^(\^\^|,,|\^|,)$/.exec(rest);
  if (kase) {
    if (rest === '^^') return v.toUpperCase();
    if (rest === ',,') return v.toLowerCase();
    const first = rest === '^' ? v.charAt(0).toUpperCase() : v.charAt(0).toLowerCase();
    return first + v.slice(1);
  }
  throw new ParamError(`\${${expr}}: bad substitution`);
}

function trimPattern(value: string, op: string, pattern: string): string {
  const re = new RegExp(`^${globSource(pattern)}$`);
  const fromStart = op.startsWith('#');
  const greedy = op.length === 2;
  const idx = [...Array(value.length + 1).keys()];
  const order = greedy === fromStart ? idx.reverse() : idx;
  for (const i of order) {
    if (fromStart && re.test(value.slice(0, i))) return value.slice(i);
    if (!fromStart && re.test(value.slice(i))) return value.slice(0, i);
  }
  return value;
}
