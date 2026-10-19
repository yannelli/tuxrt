import { escapeRe } from '../../shell/glob.ts';

/** POSIX bracket classes as JS class bodies. */
const CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: '0-9A-Za-z', upper: 'A-Z', lower: 'a-z', space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', print: ' -~', graph: '!-~', cntrl: '\\x00-\\x1f\\x7f', xdigit: '0-9A-Fa-f',
};

export class RegexError extends Error {}

function classChar(c: string): string {
  return /[\\\]\[^]/.test(c) ? `\\${c}` : c;
}

/** Converts a bracket expression starting at src[i] ("["). Returns the JS class and the index after "]". */
function bracket(src: string, i: number): [string, number] {
  let j = i + 1;
  let neg = '';
  if (src[j] === '^') {
    neg = '^';
    j++;
  }
  let body = '';
  for (let first = true; ; first = false) {
    if (j >= src.length) throw new RegexError('Unmatched [, [^, [:, [., or [=');
    const c = src[j];
    if (c === ']' && !first) return [`[${neg}${body}]`, j + 1];
    const kind = c === '[' ? src[j + 1] : '';
    if (kind === ':' || kind === '=' || kind === '.') {
      const close = src.indexOf(`${kind}]`, j + 2);
      if (close === -1) throw new RegexError('Unmatched [, [^, [:, [., or [=');
      const name = src.slice(j + 2, close);
      if (kind === ':' && !(name in CLASSES)) throw new RegexError('Invalid character class name');
      body += kind === ':' ? CLASSES[name] : [...name].map(classChar).join('');
      j = close + 2;
      continue;
    }
    body += classChar(c);
    j++;
  }
}

/** Translates a POSIX BRE (or ERE when `ere`) with GNU extensions into JavaScript regex source. */
export function posixToJs(src: string, ere: boolean): string {
  let out = '';
  let depth = 0;
  let start = true;
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '[') {
      const [cls, next] = bracket(src, i);
      out += cls;
      i = next;
      start = false;
      continue;
    }
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) throw new RegexError('Trailing backslash');
      i += 2;
      const special = !ere && '(){}|+?'.includes(n);
      if (special && n === '(') {
        out += '(';
        depth++;
        start = true;
      } else if (special && n === ')') {
        if (!depth--) throw new RegexError('Unmatched ) or \\)');
        out += ')';
        start = false;
      } else if (special && n === '{') {
        const close = src.indexOf('\\}', i);
        if (close === -1) throw new RegexError('Unmatched \\{');
        out += start ? `\\{${src.slice(i, close)}\\}` : interval(src.slice(i, close));
        i = close + 2;
        start = false;
      } else if (special && n === '|') {
        out += '|';
        start = true;
      } else if (special) out += n;
      else {
        out += escape(n);
        start = false;
      }
      continue;
    }
    i++;
    if (ere && c === '(') {
      out += '(';
      depth++;
      start = true;
    } else if (ere && c === ')') {
      out += depth ? ')' : '\\)';
      if (depth) depth--;
      start = false;
    } else if (ere && c === '|') {
      out += '|';
      start = true;
    } else if (ere && c === '{') {
      const close = src.indexOf('}', i);
      const body = close === -1 ? '' : src.slice(i, close);
      if (start || !/^\d*(,\d*)?$/.test(body) || body === '' || body === ',') out += '\\{';
      else {
        out += interval(body);
        i = close + 1;
      }
    } else if (c === '*' || (ere && (c === '+' || c === '?'))) out += start ? `\\${c}` : c;
    else if (c === '^') {
      const anchor = ere || start;
      out += anchor ? '^' : '\\^';
      if (!anchor) start = false;
    } else if (c === '$') {
      const rest = src.slice(i);
      out += ere || rest === '' || rest.startsWith('\\)') || rest.startsWith('\\|') ? '$' : '\\$';
      start = false;
    } else if (!ere && '+?(){}|'.includes(c)) {
      out += `\\${c}`;
      start = false;
    } else {
      out += c === '.' ? '.' : escapeRe(c);
      start = false;
    }
  }
  if (depth) throw new RegexError('Unmatched ( or \\(');
  return out;
}

function interval(body: string): string {
  if (!/^\d*(,\d*)?$/.test(body) || body === '' || body === ',') throw new RegexError('Invalid content of \\{\\}');
  return `{${body.startsWith(',') ? `0${body}` : body}}`;
}

/** Escaped letters and digits that GNU regex gives meaning to. */
function escape(n: string): string {
  if (/[1-9]/.test(n)) return `\\${n}`;
  switch (n) {
    case '<': return '\\b(?=\\w)';
    case '>': return '\\b(?<=\\w)';
    case 'b': case 'B': case 'w': case 'W': case 's': case 'S': return `\\${n}`;
    case '`': return '(?<![\\s\\S])';
    case "'": return '(?![\\s\\S])';
    case 'n': return '\\n';
    case 't': return '\\t';
    default: return escapeRe(n);
  }
}

/** Compiles a POSIX regex; JS syntax errors surface as RegexError. */
export function compile(src: string, ere: boolean, flags = ''): RegExp {
  const js = posixToJs(src, ere);
  try {
    return new RegExp(js, flags);
  } catch (e) {
    throw new RegexError((e as Error).message.replace(/^Invalid regular expression: \/.*\/\w*: /, ''));
  }
}
