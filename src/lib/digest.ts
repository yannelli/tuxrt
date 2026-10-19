import { sha384, sha512 } from './sha512.ts';

/** Pads to whole blocks with the 64- or 128-bit big/little-endian bit length, per MD5 and SHA. */
function pad(data: Uint8Array, block: number, littleEndian: boolean): DataView {
  const lenBytes = block === 128 ? 16 : 8;
  const total = Math.ceil((data.length + 1 + lenBytes) / block) * block;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = data.length * 8;
  const hi = Math.floor(bits / 2 ** 32);
  if (littleEndian) view.setUint32(total - 8, bits >>> 0, true), view.setUint32(total - 4, hi, true);
  else view.setUint32(total - 8, hi), view.setUint32(total - 4, bits >>> 0);
  return view;
}

const hex = (words: ArrayLike<number>, littleEndian = false) =>
  Array.from(words, (w) => {
    const h = (w >>> 0).toString(16).padStart(8, '0');
    return littleEndian ? h.replace(/(..)(..)(..)(..)/, '$4$3$2$1') : h;
  }).join('');

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);

function md5(data: Uint8Array): string {
  const v = pad(data, 64, true);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < v.byteLength; off += 64) {
    let [a, b, c, d] = h;
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      const f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = r === 0 ? i : r === 1 ? (5 * i + 1) & 15 : r === 2 ? (3 * i + 5) & 15 : (7 * i) & 15;
      const s = MD5_S[(r << 2) | (i & 3)];
      const x = (a + f + MD5_K[i] + v.getUint32(off + g * 4, true)) | 0;
      [a, d, c] = [d, c, b];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
  }
  return hex(h, true);
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha1(data: Uint8Array): string {
  const v = pad(data, 64, false);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let off = 0; off < v.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30), a, t];
    }
    [a, b, c, d, e].forEach((x, i) => (h[i] = (h[i] + x) | 0));
  }
  return hex(h);
}

const PRIMES = Array.from({ length: 409 }, (_, i) => i).filter((n) => n > 1 && Array.from({ length: n - 2 }, (_, k) => k + 2).every((k) => n % k));
const frac = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) | 0;
const K256 = PRIMES.slice(0, 64).map((p) => frac(Math.cbrt(p)));

function sha256(data: Uint8Array, init: number[], words: number): string {
  const v = pad(data, 64, false);
  const h = [...init];
  const w = new Int32Array(64);
  for (let off = 0; off < v.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((x, i) => (h[i] = (h[i] + x) | 0));
  }
  return hex(h.slice(0, words));
}

export const DIGESTS: Record<string, (data: Uint8Array) => string> = {
  md5,
  sha1,
  sha224: (d) => sha256(d, [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4], 7),
  sha256: (d) => sha256(d, PRIMES.slice(0, 8).map((p) => frac(Math.sqrt(p))), 8),
  sha384,
  sha512,
};
