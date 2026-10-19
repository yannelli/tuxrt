import { Big, isObj, kind, sortedKeys, trunc, type Value } from './value.ts';

export interface DumpOpts {
  /** Indent unit: '' prints compact, otherwise spaces or a tab. */
  indent: string;
  sort: boolean;
  ascii: boolean;
  /** SGR codes for null, false, true, numbers, strings, arrays, objects, object keys. */
  colors: string[] | null;
}

export const DEFAULT_COLORS = ['1;30', '0;39', '0;39', '0;39', '0;32', '1;39', '1;39', '34;1'];
const COMPACT: DumpOpts = { indent: '', sort: false, ascii: false, colors: null };
const ESCAPES: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 0x22: '\\"', 0x5c: '\\\\' };
const hex4 = (c: number) => `\\u${c.toString(16).padStart(4, '0')}`;

/** jq's dtoa formatting: shortest round-trip digits, exponent past 17 significant places or below 1e-4. */
function fmtNum(n: number): string {
  if (Number.isNaN(n)) return 'null';
  if (!Number.isFinite(n)) n = n > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const [mant, e] = Math.abs(n).toExponential().split('e');
  const digits = mant.replace('.', '');
  const decpt = Number(e) + 1;
  let s: string;
  if (decpt <= -4 || decpt > digits.length + 15) {
    const x = Math.abs(decpt - 1);
    s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${decpt - 1 < 0 ? '-' : '+'}${x < 10 ? '0' : ''}${x}`;
  } else if (decpt <= 0) s = `0.${'0'.repeat(-decpt)}${digits}`;
  else if (decpt >= digits.length) s = digits + '0'.repeat(decpt - digits.length);
  else s = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  return n < 0 ? `-${s}` : s;
}

export function quote(s: string, ascii = false): string {
  if (!(ascii ? /[^\x20-\x7e]|["\\]/ : /[\x00-\x1f\x7f"\\\ud800-\udfff]/).test(s)) return `"${s}"`;
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ESCAPES[c]) out += ESCAPES[c];
    else if (c < 0x20 || c === 0x7f) out += hex4(c);
    else if (c >= 0xd800 && c <= 0xdfff) out += ascii ? '\\ufffd' : '\ufffd';
    else if (!ascii || c < 0x7f) out += ch;
    else if (c > 0xffff) out += hex4(0xd800 + ((c - 0x10000) >> 10)) + hex4(0xdc00 + ((c - 0x10000) & 0x3ff));
    else out += hex4(c);
  }
  return `${out}"`;
}

function colorIndex(v: Value): number {
  if (v === null) return 0;
  if (v === false) return 1;
  if (v === true) return 2;
  return { number: 3, string: 4, array: 5, object: 6 }[kind(v) as 'number'];
}

function scalar(v: Value, o: DumpOpts): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return fmtNum(v);
  if (v instanceof Big) return v.s;
  return quote(v as string, o.ascii);
}

function term(v: Value, o: DumpOpts, depth: number): string {
  const col = o.colors ? `\x1b[${o.colors[colorIndex(v)]}m` : '';
  const reset = o.colors ? '\x1b[0m' : '';
  const nl = o.indent ? `\n${o.indent.repeat(depth + 1)}` : '';
  const end = o.indent ? `\n${o.indent.repeat(depth)}` : '';
  if (Array.isArray(v)) {
    if (!v.length) return `${col}[]${reset}`;
    const items = v.map((x) => term(x, o, depth + 1) + col);
    return `${col}[${nl}${items.join(`,${nl}`)}${end}${col}]${reset}`;
  }
  if (isObj(v)) {
    if (!v.size) return `${col}{}${reset}`;
    const keys = o.sort ? sortedKeys(v) : [...v.keys()];
    const key = (k: string) => (o.colors ? `${reset}\x1b[${o.colors[7]}m${quote(k, o.ascii)}${reset}${col}` : quote(k, o.ascii));
    const fields = keys.map((k) => `${key(k)}:${o.indent ? ' ' : ''}${reset}${term(v.get(k)!, o, depth + 1)}${col}`);
    return `${col}{${nl}${fields.join(`,${nl}`)}${end}${col}}${reset}`;
  }
  return col + scalar(v, o) + reset;
}

export function dump(v: Value, o: DumpOpts = COMPACT): string {
  if (!o.colors && !Array.isArray(v) && !isObj(v)) return scalar(v, o);
  return term(v, o, 0);
}

export const tojson = (v: Value): string => dump(v);

/** "number (1)" style operand description used in jq type errors. */
export const describe = (v: Value, max = 14): string => `${kind(v)} (${trunc(tojson(v), max)})`;
