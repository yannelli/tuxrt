import { literal } from './literal.ts';
import { CompileError, type Value } from './value.ts';

export type Tok =
  | { t: 'num'; v: Value; pos: number }
  | { t: 'str'; parts: (string | Tok[])[]; pos: number }
  | { t: 'field' | 'ident' | 'var' | 'fmt' | 'op'; v: string; pos: number }
  | { t: 'eof'; pos: number };

export const KEYWORDS = new Set([
  'def', 'if', 'then', 'elif', 'else', 'end', 'as', 'reduce', 'foreach', 'try', 'catch', 'label', 'import', 'include', 'module', 'and', 'or', '__loc__',
]);

const OPS = ['?//', '|=', '+=', '-=', '*=', '/=', '%=', '//=', '//', '==', '!=', '<=', '>=', '..', ...'.[]{}()|,:;=<>+-*/%?$'];
const IDENT = /[a-zA-Z_][a-zA-Z0-9_]*/y;
/** Function and variable names may be module-qualified: `mod::fn`, `$data::data`. */
const QUALIFIED = /[a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)*/y;
const NUM = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const STR_ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

const invalid = (pos: number) => new CompileError('syntax error, unexpected INVALID_CHARACTER', pos);

function sticky(re: RegExp, src: string, i: number): string | null {
  re.lastIndex = i;
  return re.exec(src)?.[0] ?? null;
}

function lexString(src: string, start: number): { tok: Tok; end: number } {
  const parts: (string | Tok[])[] = [];
  let buf = '';
  let i = start + 1;
  for (;;) {
    if (i >= src.length) throw new CompileError('syntax error, unexpected end of file', src.length);
    const c = src[i];
    if (c === '"') break;
    if (c !== '\\') {
      buf += c;
      i++;
      continue;
    }
    const e = src[i + 1];
    if (e === '(') {
      if (buf) parts.push(buf);
      buf = '';
      const inner = lex(src, i + 2, true);
      parts.push(inner.toks);
      i = inner.end + 1;
    } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
      buf += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (e in STR_ESC) {
      buf += STR_ESC[e];
      i += 2;
    } else throw new CompileError('syntax error, unexpected INVALID_CHARACTER', i);
  }
  if (buf || !parts.length) parts.push(buf);
  return { tok: { t: 'str', parts, pos: start }, end: i + 1 };
}

/** Tokenizes from `start`; with `interp`, stops at the `)` closing a string interpolation. */
export function lex(src: string, start = 0, interp = false): { toks: Tok[]; end: number } {
  const toks: Tok[] = [];
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      const { tok, end } = lexString(src, i);
      toks.push(tok);
      i = end;
      continue;
    }
    const n = sticky(NUM, src, i);
    if (n) {
      toks.push({ t: 'num', v: literal(n), pos: i });
      i += n.length;
      continue;
    }
    if (c === '.' || c === '$' || c === '@') {
      const id = sticky(c === '$' ? QUALIFIED : IDENT, src, i + 1) ?? (c === '@' ? sticky(/[a-zA-Z0-9_]+/y, src, i + 1) : null);
      if (id) {
        toks.push({ t: c === '.' ? 'field' : c === '$' ? 'var' : 'fmt', v: id, pos: i });
        i += id.length + 1;
        continue;
      }
      if (c === '@') throw invalid(i);
    }
    const id = sticky(QUALIFIED, src, i);
    if (id) {
      toks.push({ t: 'ident', v: id, pos: i });
      i += id.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op || op === '$') throw invalid(i);
    if (op === '(') depth++;
    if (op === ')' && interp && depth-- === 0) return { toks: [...toks, { t: 'eof', pos: i }], end: i };
    toks.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  if (interp) throw new CompileError('syntax error, unexpected end of file', src.length);
  toks.push({ t: 'eof', pos: src.length });
  return { toks, end: i };
}
