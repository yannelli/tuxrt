// VFS files hold text as characters and binary data as latin1 (one char per byte). Binary is told
// apart by control bytes (NUL, C1...) next to high bytes, which real formats always have and text never does.
const CONTROL = /[\x00-\x08\x0e-\x1a\x1c-\x1f\x7f-\x9f]/;

interface Codecs {
  TextEncoder?: new () => { encode(s: string): Uint8Array };
  TextDecoder?: new (label: string, o: { fatal: boolean; ignoreBOM: boolean }) => { decode(b: Uint8Array): string };
}
const host = globalThis as Codecs;
const encoder = host.TextEncoder ? new host.TextEncoder() : null;
// ignoreBOM keeps a leading U+FEFF in the text, as Node's Buffer#toString does.
const lossy = host.TextDecoder ? new host.TextDecoder('utf-8', { fatal: false, ignoreBOM: true }) : null;
const strict = host.TextDecoder ? new host.TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) : null;

export function isBinary(s: string): boolean {
  return !/[^\x00-\xff]/.test(s) && /[\x80-\xff]/.test(s) && CONTROL.test(s);
}

export function toBytes(s: string): Uint8Array {
  return isBinary(s) ? latin1Bytes(s) : utf8Encode(s);
}

export function fromBytes(bytes: Uint8Array): string {
  const text = utf8Decode(bytes, true);
  return text !== null && !isBinary(text) ? text : latin1(bytes);
}

export function byteLength(s: string): number {
  if (isBinary(s)) return s.length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) n += 4, i++;
    else n += 3;
  }
  return n;
}

function chars(units: ArrayLike<number>, len = units.length): string {
  let s = '';
  for (let i = 0; i < len; i += 8192) s += String.fromCharCode(...Array.prototype.slice.call(units, i, Math.min(i + 8192, len)));
  return s;
}

export function latin1(bytes: Uint8Array): string {
  return chars(bytes);
}

export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function utf8Encode(s: string): Uint8Array {
  if (encoder) return encoder.encode(s);
  const out = new Uint8Array(s.length * 3);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    else if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    if (c < 0x80) out[n++] = c;
    else if (c < 0x800) out.set([0xc0 | (c >> 6), 0x80 | (c & 63)], (n += 2) - 2);
    else if (c < 0x10000) out.set([0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)], (n += 3) - 3);
    else out.set([0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)], (n += 4) - 4);
  }
  return out.slice(0, n);
}

/** UTF-8 to text; invalid sequences become U+FFFD, or the whole call returns null when `fatal`. */
export function utf8Decode(b: Uint8Array, fatal: true): string | null;
export function utf8Decode(b: Uint8Array, fatal?: false): string;
export function utf8Decode(b: Uint8Array, fatal = false): string | null {
  if (strict && lossy) {
    try {
      return (fatal ? strict : lossy).decode(b);
    } catch {
      return null;
    }
  }
  const units = new Uint16Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    const need = c < 0x80 ? 0 : c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1;
    let cp = need === 0 ? c : c & (0x3f >> need);
    let ok = need >= 0 && i + need < b.length;
    for (let k = 1; ok && k <= need; k++) {
      ok = (b[i + k] & 0xc0) === 0x80;
      cp = (cp << 6) | (b[i + k] & 63);
    }
    if (ok && need >= 2 && (cp < [0, 0x80, 0x800, 0x10000][need] || (cp >= 0xd800 && cp < 0xe000) || cp > 0x10ffff)) ok = false;
    if (!ok) {
      if (fatal) return null;
      units[n++] = 0xfffd;
      i++;
      continue;
    }
    if (cp >= 0x10000) {
      units[n++] = 0xd800 + ((cp - 0x10000) >> 10);
      units[n++] = 0xdc00 + ((cp - 0x10000) & 0x3ff);
    } else units[n++] = cp;
    i += need + 1;
  }
  return chars(units, n);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

/** Lenient like Node's decoder: skips characters outside the alphabet (url-safe accepted) and stops at padding. */
export function base64Decode(s: string): Uint8Array {
  const clean = s.split('=')[0].replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** Pairs of hex digits up to the first non-hex pair, like Node's Buffer.from(s, 'hex'). */
export function hexBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length && /^[\da-f]{2}$/i.test(s.slice(i, i + 2)); i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return Uint8Array.from(out);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}
