import { evaluate } from './arith.ts';
import { expandBraces } from './brace.ts';
import { escapeGlobChars } from './quote.ts';
import { expandGlob, hasGlob } from './glob.ts';
import { skipBalanced } from './lexer.ts';
import { checkSet, expandBraced, lookupParam } from './params.ts';
import type { Shell } from './shell.ts';
import { captureOutput } from './subst.ts';

interface Field {
  text: string;
  /** Same text, but with quoted characters backslash-escaped so globbing treats them literally. */
  pat: string;
  keep: boolean;
}

type Mode = 'fields' | 'single' | 'pattern' | 'heredoc';

/** Full expansion for command arguments: braces, tilde, parameters, substitutions, splitting, globbing. */
export async function expandWords(words: string[], shell: Shell): Promise<string[]> {
  const out: string[] = [];
  for (const braced of words.flatMap(expandBraces)) {
    for (const f of await expand(braced, shell, 'fields')) {
      const matches = !shell.options.noglob && hasGlob(f.pat) ? expandGlob(f.pat, shell.vfs, shell.cwd) : [];
      if (matches.length) out.push(...matches);
      else out.push(f.text);
    }
  }
  return out;
}

/** Expansion without splitting or globbing (assignments, redirect targets, case subjects). */
export async function expandWord(word: string, shell: Shell): Promise<string> {
  return (await expand(word, shell, 'single'))[0]?.text ?? '';
}

/** Expansion for glob patterns (case, [[ == ]], ${x#pat}): quoted characters come back escaped. */
export async function expandPattern(word: string, shell: Shell): Promise<string> {
  return (await expand(word, shell, 'pattern'))[0]?.pat ?? '';
}

export async function expandHeredoc(body: string, shell: Shell): Promise<string> {
  return (await expand(body, shell, 'heredoc'))[0]?.text ?? '';
}

async function expand(word: string, shell: Shell, mode: Mode): Promise<Field[]> {
  const fields: Field[] = [];
  let cur: Field = { text: '', pat: '', keep: false };
  const literal = (s: string, quoted: boolean) => {
    cur.text += s;
    cur.pat += quoted ? escapeGlobChars(s) : s;
    if (quoted || s) cur.keep = true;
  };
  const newField = (keep: boolean) => {
    fields.push(cur);
    cur = { text: '', pat: '', keep };
  };
  const splitValue = (value: string) => {
    const ifs = shell.get('IFS') ?? ' \t\n';
    if (mode !== 'fields' || ifs === '') return literal(value, false);
    const ws = [...ifs].filter((c) => /\s/.test(c)).join('');
    const hard = [...ifs].filter((c) => !/\s/.test(c)).join('');
    if (ws && ws.includes(value[0]) && cur.keep) newField(false);
    const trimmed = ws ? value.replace(new RegExp(`^[${escapeClass(ws)}]+|[${escapeClass(ws)}]+$`, 'g'), '') : value;
    const sep = hard ? `[${escapeClass(ws)}]*[${escapeClass(hard)}][${escapeClass(ws)}]*|[${escapeClass(ws)}]+` : `[${escapeClass(ws)}]+`;
    const parts = trimmed === '' ? [] : trimmed.split(new RegExp(ws ? sep : `[${escapeClass(hard)}]`));
    parts.forEach((part, idx) => {
      if (idx > 0) newField(true);
      literal(part, false);
    });
    if (parts.length && ws.includes(value.at(-1)!)) newField(false);
  };
  let dropEmptyAt = false;
  const quotedAt = () => {
    if (!shell.positional.length) dropEmptyAt = true;
    shell.positional.forEach((p, idx) => {
      if (idx > 0) newField(true);
      literal(p, true);
    });
  };

  const inQuotes = mode === 'heredoc';
  let i = 0;
  if (mode !== 'heredoc' && word.startsWith('~')) {
    const m = /^~([a-z_][a-z0-9_-]*)?(?=\/|$)/.exec(word);
    if (m) {
      const home = m[1] ? homeOf(shell, m[1]) : shell.get('HOME');
      if (home !== undefined) {
        literal(home, true);
        i = m[0].length;
      }
    }
  }
  const dollar = async (quoted: boolean): Promise<void> => {
    const { value, next, at } = await expandDollar(word, i, shell);
    i = next;
    if (at && quoted && mode === 'fields') return quotedAt();
    if (value === null) return literal('$', quoted);
    if (quoted) literal(value, true);
    else splitValue(value);
  };

  while (i < word.length) {
    const c = word[i];
    if (c === '\\' && !inQuotes) {
      literal(word[i + 1] ?? '', true);
      i += 2;
    } else if (c === '\\' && inQuotes) {
      const n = word[i + 1];
      literal(n === '$' || n === '`' || n === '\\' ? n : n === '\n' ? '' : `\\${n ?? ''}`, true);
      i += 2;
    } else if (c === "'" && !inQuotes) {
      const end = word.indexOf("'", i + 1);
      literal(word.slice(i + 1, end), true);
      i = end + 1;
    } else if (c === '$' && word[i + 1] === "'" && !inQuotes) {
      const end = ansiEnd(word, i + 2);
      literal(ansiC(word.slice(i + 2, end)), true);
      i = end + 1;
    } else if (c === '"' && !inQuotes) {
      cur.keep = true;
      i++;
      while (i < word.length && word[i] !== '"') {
        const d = word[i];
        if (d === '\\') {
          const n = word[i + 1];
          literal('$`"\\\n'.includes(n) ? (n === '\n' ? '' : n) : `\\${n}`, true);
          i += 2;
        } else if (d === '$') await dollar(true);
        else if (d === '`') literal(await backtick(), true);
        else {
          literal(d, true);
          i++;
        }
      }
      i++;
    } else if (c === '$') await dollar(inQuotes);
    else if (c === '`') {
      const out = await backtick();
      if (inQuotes) literal(out, true);
      else splitValue(out);
    } else {
      literal(c, inQuotes);
      i++;
    }
  }
  if (dropEmptyAt && cur.text === '' && !fields.length) return [];
  fields.push(cur);
  return mode === 'fields' ? fields.filter((f) => f.keep || f.text !== '') : fields;

  async function backtick(): Promise<string> {
    let j = i + 1;
    let src = '';
    while (j < word.length && word[j] !== '`') {
      if (word[j] === '\\' && '$`\\'.includes(word[j + 1])) j++;
      src += word[j++];
    }
    i = j + 1;
    return captureOutput(shell, src);
  }
}

async function expandDollar(word: string, i: number, shell: Shell): Promise<{ value: string | null; next: number; at?: boolean }> {
  const n = word[i + 1];
  if (n === '(') {
    const end = skipBalanced(word, i + 1);
    if (word[i + 2] === '(' && word[end - 2] === ')') {
      const expr = await expandHeredoc(word.slice(i + 3, end - 2), shell);
      const vars = { get: (k: string) => checkSet(k, lookupParam(k, shell), shell), set: (k: string, v: string) => shell.set(k, v) };
      return { value: String(evaluate(expr, vars)), next: end };
    }
    return { value: await captureOutput(shell, word.slice(i + 2, end - 1)), next: end };
  }
  if (n === '{') {
    const end = skipBalanced(word, i + 1);
    const inner = word.slice(i + 2, end - 1);
    const value = await expandBraced(inner, shell, (w) => expandWord(w, shell), (w) => expandPattern(w, shell));
    return { value, next: end, at: inner === '@' };
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(word.slice(i + 1));
  if (!m) return { value: null, next: i + 1 };
  return { value: checkSet(m[1], lookupParam(m[1], shell), shell), next: i + 1 + m[1].length, at: m[1] === '@' };
}

function homeOf(shell: Shell, name: string): string | undefined {
  const line = shell.vfs.tryLookup('/etc/passwd') ? shell.vfs.readFile('/etc/passwd').split('\n').find((l) => l.startsWith(`${name}:`)) : undefined;
  return line?.split(':')[5];
}

function escapeClass(s: string): string {
  return s.replace(/[\]\\^-]/g, '\\$&').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}

function ansiEnd(word: string, i: number): number {
  while (i < word.length && word[i] !== "'") i += word[i] === '\\' ? 2 : 1;
  return i;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '0': '\0' };

export function ansiC(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|0?[0-7]{1,3}|.)/g, (all, e: string) => {
    if (e[0] === 'x' || e[0] === 'u') return e.length > 1 ? String.fromCodePoint(parseInt(e.slice(1), 16)) : all;
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ESCAPES[e] ?? all;
  });
}
