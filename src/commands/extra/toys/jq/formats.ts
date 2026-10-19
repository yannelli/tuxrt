import { Buffer } from 'node:buffer';
import { describe, tojson } from './dump.ts';
import { isNum, isObj, JqError, num, type Value } from './value.ts';

export const FORMATS = new Set(['text', 'json', 'html', 'uri', 'csv', 'tsv', 'sh', 'base64', 'base64d', 'base32', 'base32d']);
const HTML: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' };
const TSV: Record<string, string> = { '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' };
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const tostr = (v: Value): string => (typeof v === 'string' ? v : tojson(v));

function uri(s: string): string {
  let out = '';
  for (const b of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-_.~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function row(v: Value, name: 'csv' | 'tsv'): string {
  if (!Array.isArray(v)) throw new JqError(`${describe(v)} cannot be ${name}-formatted, only an array can be`);
  const cells = v.map((x) => {
    if (x === null) return '';
    if (typeof x === 'boolean') return String(x);
    if (isNum(x)) return Number.isNaN(num(x)) ? '' : tojson(x);
    if (typeof x === 'string') return name === 'csv' ? `"${x.replace(/"/g, '""')}"` : x.replace(/[\\\t\n\r]/g, (c) => TSV[c]);
    throw new JqError(`${describe(x)} is not valid in a ${name} row`);
  });
  return cells.join(name === 'csv' ? ',' : '\t');
}

function sh(v: Value): string {
  return (Array.isArray(v) ? v : [v])
    .map((x) => {
      if (typeof x === 'string') return `'${x.replace(/'/g, "'\\''")}'`;
      if (Array.isArray(x) || isObj(x)) throw new JqError(`${describe(x)} can not be escaped for shell`);
      return tojson(x);
    })
    .join(' ');
}

function base32(s: string): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of Buffer.from(s, 'utf8')) {
    acc = ((acc << 8) | b) & 0xffff;
    bits += 8;
    for (; bits >= 5; bits -= 5) out += B32[(acc >> (bits - 5)) & 31];
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out.padEnd(Math.ceil(out.length / 8) * 8, '=');
}

function base32d(s: string, v: Value): string {
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const c of s.replace(/=+$/, '')) {
    const d = B32.indexOf(c);
    if (d < 0) throw new JqError(`${describe(v)} is not valid base32 data`);
    acc = ((acc << 5) | d) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function base64d(s: string, v: Value): string {
  const body = s.replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(body) || body.length % 4 === 1) throw new JqError(`${describe(v)} is not valid base64 data`);
  return Buffer.from(body, 'base64').toString('utf8');
}

/** Applies `@name` to a value; every format but csv/tsv/sh/json stringifies its input first. */
export function format(name: string, v: Value): Value {
  switch (name) {
    case 'text': return tostr(v);
    case 'json': return tojson(v);
    case 'html': return tostr(v).replace(/[<>&'"]/g, (c) => HTML[c]);
    case 'uri': return uri(tostr(v));
    case 'csv':
    case 'tsv': return row(v, name);
    case 'sh': return sh(v);
    case 'base64': return Buffer.from(tostr(v), 'utf8').toString('base64');
    case 'base64d': return base64d(tostr(v), v);
    case 'base32': return base32(tostr(v));
    case 'base32d': return base32d(tostr(v), v);
  }
  throw new JqError(`${name} is not a valid format`);
}
