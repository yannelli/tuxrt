import { Big, isObj, type Obj, type Value } from './value.ts';

export class ParseError extends Error {}

type Frame = Value[] | Obj | string;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DELIM = /[ \t\r\n"[\]{}:,]/g;
const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const CONTROL = 'Invalid string: control characters from U+0000 through U+001F must be escaped';

function literal(tok: string): Value | string {
  const word = { t: 'true', f: 'false', n: tok.length === 3 ? 'nan' : 'null' }[tok[0]];
  if (word !== undefined) return tok !== word ? 'Invalid literal' : word === 'nan' ? NaN : word === 'null' ? null : word === 'true';
  if (tok[0] === "'") return "Invalid string literal; expected \", but got '";
  if (!NUMBER.test(tok)) return 'Invalid numeric literal';
  const n = Number(tok);
  return /^-?\d+$/.test(tok) && !Number.isSafeInteger(n) ? new Big(tok) : n;
}

function unescape(raw: string): string {
  if (!raw.includes('\\')) {
    if (/[\x01-\x1e]/.test(raw)) throw new Error(CONTROL);
    return raw;
  }
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') {
      if (c > '\x00' && c < '\x1f') throw new Error(CONTROL);
      out += c;
      continue;
    }
    const e = raw[++i];
    if (e === undefined) throw new Error('Expected escape character at end of string');
    if (e in ESC) out += ESC[e];
    else if (e === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (hex.length < 4) throw new Error('Invalid \\uXXXX escape');
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('Invalid characters in \\uXXXX escape');
      let cp = parseInt(hex, 16);
      i += 4;
      const lo = cp >= 0xd800 && cp <= 0xdbff ? /^\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(raw.slice(i + 1)) : null;
      if (lo) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (parseInt(lo[1], 16) - 0xdc00);
        i += 6;
      } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
      out += String.fromCodePoint(cp);
    } else throw new Error('Invalid escape');
  }
  return out;
}

/** jq's JSON state machine (same messages and positions); yields each top-level value and where it ended. */
export function* parseJson(text: string): Generator<{ value: Value; end: number }> {
  const stack: Frame[] = [];
  let next: Value | undefined;
  let line = 1;
  let lineStart = 0;
  let i = 0;
  const fail = (msg: string): never => {
    throw new ParseError(`${msg} at line ${line}, column ${i - lineStart}`);
  };
  const advance = (to: number) => {
    for (let j = i; j < to; j++) {
      if (text.charCodeAt(j) === 10) {
        line++;
        lineStart = j + 1;
      }
    }
    i = to;
  };
  const value = (v: Value) => {
    if (next !== undefined) fail('Expected separator between values');
    next = v;
  };
  while (i < text.length) {
    const c = text[i];
    let end = i + 1;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) {
        advance(text.length);
        fail('Unfinished string at EOF');
      }
      const raw = text.slice(i + 1, j);
      advance(j + 1);
      let s = '';
      try {
        s = unescape(raw);
      } catch (e) {
        fail((e as Error).message);
      }
      value(s);
    } else if ('[{:,]}'.includes(c)) {
      advance(i + 1);
      structure(c);
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      advance(i + 1);
    } else {
      DELIM.lastIndex = i;
      end = DELIM.exec(text)?.index ?? text.length;
      const v = literal(text.slice(i, end));
      advance(end);
      if (typeof v === 'string') {
        if (end >= text.length) fail(`${v} at EOF`);
        advance(end + 1);
        fail(v);
      }
      value(v as Value);
    }
    if (!stack.length && next !== undefined) {
      yield { value: next, end };
      next = undefined;
    }
  }
  if (stack.length) fail('Unfinished JSON term at EOF');

  function structure(c: string): void {
    const t = stack[stack.length - 1];
    switch (c) {
      case '[':
      case '{':
        if (next !== undefined) fail('Expected separator between values');
        stack.push(c === '[' ? [] : new Map());
        return;
      case ':':
        if (!isObj(t)) return fail("':' not as part of an object");
        if (typeof next !== 'string') return fail('Object keys must be strings');
        stack.push(next);
        next = undefined;
        return;
      case ',':
        if (next === undefined) return fail("Expected value before ','");
        if (t === undefined) return fail("',' not as part of an object or array");
        if (Array.isArray(t)) t.push(next);
        else if (typeof t === 'string') {
          stack.pop();
          (stack[stack.length - 1] as Obj).set(t, next);
        } else return fail('Objects must consist of key:value pairs');
        next = undefined;
        return;
      case ']':
        if (!Array.isArray(t)) return fail("Unmatched ']'");
        if (next !== undefined) t.push(next);
        else if (t.length) return fail('Expected another array element');
        next = stack.pop() as Value;
        return;
      case '}':
        if (t === undefined) return fail("Unmatched '}'");
        if (next !== undefined) {
          if (typeof t !== 'string') return fail('Objects must consist of key:value pairs');
          stack.pop();
          (stack[stack.length - 1] as Obj).set(t, next);
        } else if (!isObj(t)) return fail("Unmatched '}'");
        else if (t.size) return fail('Expected another key-value pair');
        next = stack.pop() as Value;
    }
  }
}

/** Parses exactly one JSON text (fromjson, --argjson). */
export function parseOne(text: string): Value {
  const all = [...parseJson(text)];
  if (all.length !== 1) throw new ParseError(all.length ? 'Unexpected extra JSON values' : 'Expected JSON value');
  return all[0].value;
}
