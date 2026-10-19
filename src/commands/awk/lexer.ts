export class AwkSyntaxError extends Error {
  line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

/** `t` is the token kind; `v` is the source text (unescaped contents for strings, body for regexes). */
export interface Token {
  t: string;
  v: string;
  line: number;
}

const KEYWORDS = new Set([
  'BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue',
  'next', 'nextfile', 'exit', 'return', 'delete', 'in', 'getline', 'print', 'printf',
]);

export const BUILTINS = new Set([
  'length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'sin', 'cos', 'atan2',
  'exp', 'log', 'sqrt', 'int', 'rand', 'srand', 'tolower', 'toupper', 'system', 'close', 'fflush',
]);

const OPS = [
  '**=', '**', '+=', '-=', '*=', '/=', '%=', '^=', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '!~', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '>', '<', '|', '?', ':', '~', '$', '=',
];

/** After these a `/` divides; anywhere else it opens a regex literal. */
const OPERAND_END = new Set(['num', 'str', 'ere', 'name', 'builtin', ')', ']', '++', '--']);

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '"': '"', '/': '/', '\\': '\\' };

/** Awk string escapes. Unknown escapes keep their backslash, like mawk, so "\." still works as a regex. */
export function unescape(s: string): string {
  if (!s.includes('\\')) return s;
  return s.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|(\n)|(.)|$)/gs, (all, oct?: string, hex?: string, nl?: string, c?: string) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (nl) return '';
    if (c === undefined) return '\\';
    return ESCAPES[c] ?? all;
  });
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let line = 1;
  const push = (t: string, v = t) => toks.push({ t, v, line });
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      push('nl', '\n');
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      i += src[i + 1] === '\n' ? 2 : 3;
      line++;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"') {
      const end = scanString(src, i + 1);
      if (end < 0) throw new AwkSyntaxError(`runaway string constant "${src.slice(i + 1, i + 11)} ...`, line);
      push('str', unescape(src.slice(i + 1, end)));
      line += src.slice(i, end).split('\n').length - 1;
      i = end + 1;
    } else if (c === '/' && !OPERAND_END.has(toks.at(-1)?.t ?? '')) {
      const end = scanRegex(src, i + 1);
      if (end < 0) throw new AwkSyntaxError(`runaway regular expression /${src.slice(i + 1, i + 11)} ...`, line);
      push('ere', src.slice(i + 1, end));
      i = end + 1;
    } else if (/[\d.]/.test(c) && ((NUMBER.lastIndex = i), NUMBER.test(src))) {
      push('num', src.slice(i, NUMBER.lastIndex));
      i = NUMBER.lastIndex;
    } else if (/[A-Za-z_]/.test(c)) {
      NAME.lastIndex = i;
      NAME.test(src);
      const word = src.slice(i, NAME.lastIndex);
      i = NAME.lastIndex;
      if (KEYWORDS.has(word)) push(word === 'func' ? 'function' : word, word);
      else if (BUILTINS.has(word)) push('builtin', word);
      else push(src[i] === '(' ? 'funcname' : 'name', word);
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new AwkSyntaxError(`syntax error at or near ${c}`, line);
      push(op === '**' ? '^' : op === '**=' ? '^=' : op, op);
      i += op.length;
    }
  }
  push('eof', '');
  return toks;
}

function scanString(src: string, i: number): number {
  for (; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '"') return i;
    else if (src[i] === '\n') return -1;
  }
  return -1;
}

function scanRegex(src: string, i: number): number {
  let inBracket = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') return -1;
    if (c === '\\') i++;
    else if (inBracket) {
      if (c === '[' && src[i + 1] === ':') i = Math.max(i, src.indexOf(':]', i + 2) + 1);
      else if (c === ']') inBracket = false;
    } else if (c === '[') {
      inBracket = true;
      if (src[i + 1] === '^') i++;
      if (src[i + 1] === ']') i++;
    } else if (c === '/') return i;
  }
  return -1;
}
