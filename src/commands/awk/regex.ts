export class RegexError extends Error {}

const CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  print: ' -~',
  graph: '!-~',
  cntrl: '\\x00-\\x1f\\x7f',
  xdigit: '0-9A-Fa-f',
  word: '\\w',
};

const SIMPLE_ESCAPES: Record<string, string> = { n: '\\n', t: '\\t', r: '\\r', f: '\\f', v: '\\v', a: '\\x07', b: '\\x08' };
const GNU_ESCAPES: Record<string, string> = {
  y: '\\b', B: '\\B', '<': '\\b(?=\\w)', '>': '\\b(?<=\\w)', s: '\\s', S: '\\S', w: '\\w', W: '\\W', '`': '^', "'": '$',
};

function literal(c: string): string {
  return /[\\^$.|?*+()[\]{}/-]/.test(c) ? `\\${c}` : c;
}

function codeUnit(code: number): string {
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

/** Translates the escape after a backslash at src[i - 1]; returns the JS text and the next index. */
function escape(src: string, i: number, inBracket: boolean): [string, number] {
  const c = src[i];
  if (c === undefined) return ['\\\\', i];
  if (SIMPLE_ESCAPES[c]) return [SIMPLE_ESCAPES[c], i + 1];
  if (!inBracket && GNU_ESCAPES[c]) return [GNU_ESCAPES[c], i + 1];
  const oct = /^[0-7]{1,3}/.exec(src.slice(i, i + 3));
  if (oct) return [codeUnit(parseInt(oct[0], 8)), i + oct[0].length];
  const hex = c === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 1, i + 3)) : null;
  if (hex) return [codeUnit(parseInt(hex[0], 16)), i + 1 + hex[0].length];
  return [literal(c), i + 1];
}

function bracket(src: string, start: number): [string, number] {
  let i = start + 1;
  let out = '[';
  if (src[i] === '^') {
    out += '^';
    i++;
  }
  for (let first = true; ; first = false) {
    if (i >= src.length) throw new RegexError('bad class -- [], [^] or [');
    const c = src[i];
    if (c === ']' && !first) return [`${out}]`, i + 1];
    const kind = src[i + 1];
    if (c === '[' && (kind === ':' || kind === '.' || kind === '=')) {
      const end = src.indexOf(`${kind}]`, i + 2);
      if (end !== -1) {
        const name = src.slice(i + 2, end);
        if (kind === ':' && !CLASSES[name]) throw new RegexError(`invalid character class [:${name}:]`);
        out += kind === ':' ? CLASSES[name] : [...name].map(literal).join('');
        i = end + 2;
        continue;
      }
    }
    if (c === '\\') {
      const [s, n] = escape(src, i + 1, true);
      out += s;
      i = n;
      continue;
    }
    out += c === ']' || c === '[' || c === '\\' ? `\\${c}` : c;
    i++;
  }
}

/** POSIX ERE (awk dialect) to JS RegExp source. `.` must match newlines, so compile with the "s" flag. */
export function ereToJs(src: string): string {
  let out = '';
  let atom = -1;
  let quantified = false;
  const groups: number[] = [];
  const emit = (s: string) => {
    atom = out.length;
    quantified = false;
    out += s;
  };
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const interval = c === '{' ? /^\{\d+(,\d*)?\}/.exec(src.slice(i)) : null;
    if (c === '*' || c === '+' || c === '?' || interval) {
      const q = interval ? interval[0] : c;
      i += q.length;
      if (atom < 0) emit(literal(q[0]) + q.slice(1).replace(/[{}]/g, '\\$&'));
      else if (quantified) out = `${out.slice(0, atom)}(?:${out.slice(atom)})${q}`;
      else {
        out += q;
        quantified = true;
      }
      continue;
    }
    i++;
    if (c === '\\') {
      const [s, n] = escape(src, i, false);
      emit(s);
      i = n;
    } else if (c === '[') {
      const [s, n] = bracket(src, i - 1);
      emit(s);
      i = n;
    } else if (c === '(') {
      groups.push(out.length);
      out += '(';
      atom = -1;
    } else if (c === ')') {
      if (!groups.length) throw new RegexError("missing '('");
      const start = groups.pop()!;
      out += ')';
      atom = start;
      quantified = false;
    } else if (c === '|' || c === '^' || c === '$') {
      out += c;
      atom = -1;
    } else emit(c === '{' || c === '}' || c === '/' ? `\\${c}` : c);
  }
  if (groups.length) throw new RegexError("missing ')'");
  return out;
}

const cache = new Map<string, RegExp>();

/** Compiled regexes are shared; callers of the global form must set lastIndex before each use. */
export function compile(src: string, global = false): RegExp {
  const key = (global ? 'g' : '-') + src;
  let re = cache.get(key);
  if (!re) {
    try {
      re = new RegExp(ereToJs(src), global ? 'gs' : 's');
    } catch (e) {
      if (e instanceof RegexError) throw e;
      throw new RegexError((e as Error).message.replace(/^Invalid regular expression: /, ''));
    }
    if (cache.size > 1000) cache.clear();
    cache.set(key, re);
  }
  return re;
}
