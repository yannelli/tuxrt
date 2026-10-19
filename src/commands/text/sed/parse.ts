import { compile, RegexError } from '../regex.ts';
import { parseRepl, type Repl } from './repl.ts';

export type Addr =
  | { type: 'line'; n: number }
  | { type: 'last' }
  | { type: 're'; re: RegExp | null }
  | { type: 'step'; first: number; step: number }
  | { type: 'zero' }
  | { type: 'plus'; n: number }
  | { type: 'mult'; n: number };

export interface Cmd {
  name: string;
  a1?: Addr;
  a2?: Addr;
  neg: boolean;
  active?: boolean;
  rangeEnd?: number;
  end?: number;
  text?: string;
  label?: string;
  target?: number;
  re?: RegExp | null;
  repl?: Repl[];
  global?: boolean;
  nth?: number;
  print?: number;
  file?: string;
  map?: Map<string, string>;
  int?: number;
}

export class SedError extends Error {}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: '\x07' };

/** Parses a sed script into a flat program; `{` records the index of its `}` and branches resolve to indices. */
export function parseScript(script: string, ere: boolean): Cmd[] {
  let i = 0;
  const prog: Cmd[] = [];
  const blocks: number[] = [];
  const fail = (msg: string): never => {
    throw new SedError(`-e expression #1, char ${i}: ${msg}`);
  };
  const peek = () => script[i];
  const skipWs = () => {
    while (i < script.length && /[ \t]/.test(script[i])) i++;
  };
  const regex = (src: string, flags: string): RegExp | null => {
    if (src === '') return null;
    try {
      return compile(src, ere, `s${flags}`);
    } catch (e) {
      throw e instanceof RegexError ? new SedError(`-e expression #1, char ${i}: ${e.message}`) : e;
    }
  };
  /** Reads up to an unescaped `delim`; "\delim" becomes delim. With `escapes`, \n \t etc. become literal
   *  characters first, as GNU sed does, so they also work inside bracket expressions. */
  const delimited = (delim: string, what: string, escapes: boolean): string => {
    let out = '';
    for (;;) {
      if (i >= script.length) fail(`unterminated ${what}`);
      const c = script[i++];
      if (c === delim) return out;
      if (c === '\\' && i < script.length) {
        const n = script[i++];
        if (n === delim) out += delim;
        else if (n === '\n') out += '\n';
        else if (escapes && Object.hasOwn(ESCAPES, n)) out += ESCAPES[n];
        else out += `\\${n}`;
      } else out += c;
    }
  };
  const reFlags = () => {
    let flags = '';
    while (peek() === 'I' || peek() === 'M') flags += script[i++] === 'I' ? 'i' : 'm';
    return flags;
  };
  const number = () => {
    const m = /^\d+/.exec(script.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const address = (second: boolean): Addr | undefined => {
    const c = peek();
    if (c === '$') {
      i++;
      return { type: 'last' };
    }
    if (c === '/' || c === '\\') {
      i++;
      const delim = c === '/' ? '/' : script[i++];
      const src = delimited(delim, 'address regex', true);
      return { type: 're', re: regex(src, reFlags()) };
    }
    if (second && (c === '+' || c === '~')) {
      i++;
      return { type: c === '+' ? 'plus' : 'mult', n: number() ?? fail('expected newer version of sed') };
    }
    const n = number();
    if (n === null) return undefined;
    if (peek() === '~' && !second) {
      i++;
      return { type: 'step', first: n, step: number() ?? 0 };
    }
    return n === 0 && !second ? { type: 'zero' } : { type: 'line', n };
  };
  const toEol = () => {
    const end = script.indexOf('\n', i);
    const s = script.slice(i, end === -1 ? undefined : end);
    i = end === -1 ? script.length : end;
    return s;
  };
  const label = () => {
    skipWs();
    const m = /^[^;\n]*/.exec(script.slice(i))![0];
    i += m.length;
    return m.trim();
  };
  const endCommand = () => {
    skipWs();
    const c = peek();
    if (c === undefined || c === '\n' || c === ';') i++;
    else if (c !== '}' && c !== '#') fail('extra characters after command');
  };
  /** a/i/c text: one-liner GNU form or "a\" followed by lines continued with a trailing backslash. */
  const text = (): string => {
    skipWs();
    if (script[i] === '\\') {
      i++;
      if (script[i] === '\n') i++;
    }
    let raw = '';
    for (;;) {
      const line = toEol();
      if (!line.endsWith('\\') || i >= script.length) return (raw + line).replace(/\\(.)/gs, (_, c: string) => (c === 't' ? '\t' : c));
      raw += `${line.slice(0, -1)}\n`;
      i++;
    }
  };

  while (i < script.length) {
    while (i < script.length && /[\s;]/.test(script[i])) i++;
    if (i >= script.length) break;
    if (peek() === '#') {
      toEol();
      continue;
    }
    const cmd: Cmd = { name: '', neg: false };
    cmd.a1 = address(false);
    if (cmd.a1) {
      skipWs();
      if (peek() === ',') {
        i++;
        skipWs();
        cmd.a2 = address(true) ?? fail("unexpected `,'");
      }
    }
    if (cmd.a1?.type === 'zero' && cmd.a2?.type !== 're') fail('invalid usage of line address 0');
    skipWs();
    while (peek() === '!') {
      cmd.neg = true;
      i++;
      skipWs();
    }
    const name = script[i++];
    if (name === undefined) fail('missing command');
    cmd.name = name;
    switch (name) {
      case '{':
        blocks.push(prog.length);
        prog.push(cmd);
        continue;
      case '}':
        if (cmd.a1) fail("} doesn't want any addresses");
        if (!blocks.length) fail("unexpected `}'");
        prog[blocks.pop()!].end = prog.length;
        endCommand();
        break;
      case 'a': case 'i': case 'c':
        cmd.text = text();
        break;
      case ':':
        if (cmd.a1) fail(": doesn't want any addresses");
        cmd.label = label() || fail('":" lacks a label');
        break;
      case 'b': case 't': case 'T':
        cmd.label = label();
        break;
      case 'r': case 'R': case 'w': case 'W':
        skipWs();
        cmd.file = toEol();
        break;
      case 'q': case 'Q': case 'l': case 'L':
        skipWs();
        cmd.int = number() ?? undefined;
        endCommand();
        break;
      case 's': {
        const delim = script[i++];
        if (delim === undefined || delim === '\n' || delim === '\\') fail("unterminated `s' command");
        const src = delimited(delim, "`s' command", true);
        const repl = delimited(delim, "`s' command", false);
        let flags = '';
        for (let c = peek(); c !== undefined; c = peek()) {
          if (/\d/.test(c)) {
            cmd.nth = number() || fail("number option to `s' command may not be zero");
            continue;
          }
          if (c === 'w') {
            i++;
            skipWs();
            cmd.file = toEol();
            break;
          }
          if (c === 'g') cmd.global = true;
          else if (c === 'p') cmd.print = (cmd.print ?? 0) + 1;
          else if (c === 'i' || c === 'I') flags += 'i';
          else if (c === 'm' || c === 'M') flags += 'm';
          else if (c !== 'e') break;
          i++;
        }
        cmd.re = regex(src, flags);
        cmd.repl = parseRepl(repl);
        if (!cmd.file) endCommand();
        break;
      }
      case 'y': {
        const delim = script[i++];
        const unescape = (s: string) => [...s.replace(/\\(.)/gs, (_, c: string) => (c === 't' ? '\t' : c))];
        const from = unescape(delimited(delim, "`y' command", true));
        const to = unescape(delimited(delim, "`y' command", true));
        if (from.length !== to.length) fail("strings for `y' command are different lengths");
        cmd.map = new Map(from.map((c, k) => [c, to[k]]));
        endCommand();
        break;
      }
      case '=': case 'd': case 'D': case 'g': case 'G': case 'h': case 'H': case 'n': case 'N':
      case 'p': case 'P': case 'x': case 'z': case 'F':
        endCommand();
        break;
      default:
        fail(`unknown command: \`${name}'`);
    }
    prog.push(cmd);
  }
  if (blocks.length) throw new SedError("-e expression #1, char 0: unmatched `{'");
  const labels = new Map(prog.flatMap((c, k) => (c.name === ':' ? [[c.label!, k] as const] : [])));
  for (const c of prog) {
    if (!'btT'.includes(c.name) || !c.label) continue;
    c.target = labels.get(c.label);
    if (c.target === undefined) throw new SedError(`can't find label for jump to \`${c.label}'`);
  }
  return prog;
}
