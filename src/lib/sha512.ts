// 64-bit words are kept as [hi, lo] int32 pairs; BigInt is used only to derive the constants once.
function root(n: bigint, k: bigint): bigint {
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / Number(k)));
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 80; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);

/** First 64 fractional bits of p^(1/k), split into an int32 pair. */
function fraction(p: number, k: bigint): [number, number] {
  const v = root(BigInt(p) << (64n * k), k) & 0xffffffffffffffffn;
  return [Number(v >> 32n) | 0, Number(v & 0xffffffffn) | 0];
}

const K = PRIMES.flatMap((p) => fraction(p, 3n));
const IV512 = PRIMES.slice(0, 8).flatMap((p) => fraction(p, 2n));
const IV384 = PRIMES.slice(8, 16).flatMap((p) => fraction(p, 2n));

function rotr(h: number, l: number, n: number): [number, number] {
  if (n >= 32) [h, l, n] = [l, h, n - 32];
  if (n === 0) return [h, l];
  return [(h >>> n) | (l << (32 - n)), (l >>> n) | (h << (32 - n))];
}

function shr(h: number, l: number, n: number): [number, number] {
  return [h >>> n, (l >>> n) | (h << (32 - n))];
}

function xor3(a: [number, number], b: [number, number], c: [number, number]): [number, number] {
  return [a[0] ^ b[0] ^ c[0], a[1] ^ b[1] ^ c[1]];
}

/** Sum of int32 pairs, carrying from the low words. */
function add(...xs: [number, number][]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const [h, l] of xs) {
    lo += l >>> 0;
    hi += h;
  }
  return [(hi + Math.floor(lo / 2 ** 32)) | 0, lo | 0];
}

function sha512core(data: Uint8Array, iv: number[], words: number): string {
  const total = Math.ceil((data.length + 17) / 128) * 128;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  const v = new DataView(buf.buffer);
  const bits = data.length * 8;
  v.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  v.setUint32(total - 4, bits >>> 0);
  const H: [number, number][] = [];
  for (let i = 0; i < 8; i++) H.push([iv[2 * i], iv[2 * i + 1]]);
  const W: [number, number][] = new Array(80);
  for (let off = 0; off < total; off += 128) {
    for (let i = 0; i < 16; i++) W[i] = [v.getInt32(off + i * 8), v.getInt32(off + i * 8 + 4)];
    for (let i = 16; i < 80; i++) {
      const [a, b] = [W[i - 15], W[i - 2]];
      const s0 = xor3(rotr(a[0], a[1], 1), rotr(a[0], a[1], 8), shr(a[0], a[1], 7));
      const s1 = xor3(rotr(b[0], b[1], 19), rotr(b[0], b[1], 61), shr(b[0], b[1], 6));
      W[i] = add(W[i - 16], s0, W[i - 7], s1);
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) {
      const S1 = xor3(rotr(e[0], e[1], 14), rotr(e[0], e[1], 18), rotr(e[0], e[1], 41));
      const ch: [number, number] = [(e[0] & f[0]) ^ (~e[0] & g[0]), (e[1] & f[1]) ^ (~e[1] & g[1])];
      const t1 = add(h, S1, ch, [K[2 * i], K[2 * i + 1]], W[i]);
      const S0 = xor3(rotr(a[0], a[1], 28), rotr(a[0], a[1], 34), rotr(a[0], a[1], 39));
      const maj: [number, number] = [(a[0] & b[0]) ^ (a[0] & c[0]) ^ (b[0] & c[0]), (a[1] & b[1]) ^ (a[1] & c[1]) ^ (b[1] & c[1])];
      [h, g, f, e, d, c, b, a] = [g, f, e, add(d, t1), c, b, a, add(t1, S0, maj)];
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => (H[i] = add(H[i], x)));
  }
  return H.slice(0, words)
    .flat()
    .map((w) => (w >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export const sha512 = (data: Uint8Array) => sha512core(data, IV512, 8);
export const sha384 = (data: Uint8Array) => sha512core(data, IV384, 6);
