import { fn } from './define.ts';
import { describe, tojson } from './dump.ts';
import { format } from './formats.ts';
import { parseOne } from './json.ts';
import { add, splitStr } from './ops.ts';
import { codepoints } from './paths.ts';
import { isNum, isObj, JqError, num, type Value } from './value.ts';

const SPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

function str(v: Value, what: string): string {
  if (typeof v !== 'string') throw new JqError(what);
  return v;
}

function parseFrom(s: string): Value {
  try {
    return parseOne(s);
  } catch (e) {
    throw new JqError(`${(e as Error).message} (while parsing '${s}')`);
  }
}

fn('ltrimstr', 1, (v, x) => (typeof v === 'string' && typeof x === 'string' && v.startsWith(x) ? v.slice(x.length) : v));
fn('rtrimstr', 1, (v, x) =>
  typeof v === 'string' && typeof x === 'string' && v.endsWith(x) && x.length ? v.slice(0, v.length - x.length) : v,
);
fn('trim', 0, (v) => str(v, 'trim input must be a string').replace(SPACE, ''));
fn('ltrim', 0, (v) => str(v, 'trim input must be a string').replace(/^[ \t\n\v\f\r]+/, ''));
fn('rtrim', 0, (v) => str(v, 'trim input must be a string').replace(/[ \t\n\v\f\r]+$/, ''));
fn('startswith', 1, (v, x) => {
  if (typeof v !== 'string' || typeof x !== 'string') throw new JqError('startswith() requires string inputs');
  return v.startsWith(x);
});
fn('endswith', 1, (v, x) => {
  if (typeof v !== 'string' || typeof x !== 'string') throw new JqError('endswith() requires string inputs');
  return v.endsWith(x);
});
fn('ascii_downcase', 0, (v) => str(v, 'ascii_downcase input must be a string').replace(/[A-Z]/g, (c) => c.toLowerCase()));
fn('ascii_upcase', 0, (v) => str(v, 'ascii_upcase input must be a string').replace(/[a-z]/g, (c) => c.toUpperCase()));
fn('explode', 0, (v) => codepoints(str(v, 'explode input must be a string')).map((c) => c.codePointAt(0)!));
fn('implode', 0, (v) => {
  if (!Array.isArray(v)) throw new JqError('implode input must be an array');
  return v
    .map((c) => {
      if (!isNum(c)) throw new JqError('Unicode codepoint must be numeric');
      const cp = Math.trunc(num(c));
      return cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
    })
    .join('');
});
fn('split', 1, (v, sep) => {
  if (typeof v !== 'string' || typeof sep !== 'string') throw new JqError('split input and separator must be strings');
  return splitStr(v, sep);
});
fn('join', 1, (v, sep) => {
  if (!Array.isArray(v) && !isObj(v)) throw new JqError(`Cannot iterate over ${v === null ? 'null' : describe(v)}`);
  let acc: Value = null;
  for (const x of Array.isArray(v) ? v : v.values()) {
    const part = typeof x === 'boolean' || isNum(x) ? tojson(x) : x === null ? '' : x;
    acc = add(acc === null ? '' : add(acc, sep), part);
  }
  return acc ?? '';
});
fn('tostring', 0, (v) => (typeof v === 'string' ? v : tojson(v)));
fn('tojson', 0, (v) => tojson(v));
fn('fromjson', 0, (v) => parseFrom(str(v, `${describe(v)} cannot be parsed as JSON`)));
fn('tonumber', 0, (v) => {
  if (isNum(v)) return v;
  if (typeof v !== 'string') throw new JqError(`${describe(v)} cannot be parsed as a number`);
  const x = parseFrom(v);
  if (!isNum(x)) throw new JqError(`${describe(v)} cannot be parsed as a number`);
  return x;
});
fn('format', 1, (v, name) => format(str(name, `${describe(name)} is not a valid format`), v));
fn('ascii', 0, (v) => {
  if (!isNum(v)) throw new JqError('ascii input must be a number');
  return String.fromCodePoint(num(v));
});
