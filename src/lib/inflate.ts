/** Thrown with GNU gzip's wording for the failure. */
export class InflateError extends Error {}

export const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
export const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
export const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
export const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

const corrupt = () => new InflateError('invalid compressed data--format violated');

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + counts[len];
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

const FIXED_LIT = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DIST = huffman(new Array(30).fill(5));

/** A raw DEFLATE stream decoder after zlib's puff.c; returns the output and the offset just past the final block. */
export function inflateRaw(data: Uint8Array, start = 0): { out: Uint8Array; end: number } {
  let pos = start;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let n = 0;
  const need = (extra: number) => {
    if (n + extra <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, n + extra));
    grown.set(out.subarray(0, n));
    out = grown;
  };
  const bits = (count: number): number => {
    while (bitCnt < count) {
      if (pos >= data.length) throw new InflateError('unexpected end of file');
      bitBuf |= data[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << count) - 1);
    bitBuf >>>= count;
    bitCnt -= count;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw corrupt();
  };
  const codes = (lit: Huffman, dist: Huffman) => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        need(1);
        out[n++] = sym;
        continue;
      }
      if (sym === 256) return;
      if (sym > 285) throw corrupt();
      const len = LEN_BASE[sym - 257] + bits(LEN_EXTRA[sym - 257]);
      const d = decode(dist);
      if (d > 29) throw corrupt();
      const back = DIST_BASE[d] + bits(DIST_EXTRA[d]);
      if (back > n) throw corrupt();
      need(len);
      for (let i = 0; i < len; i++, n++) out[n] = out[n - back];
    }
  };
  const dynamic = () => {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw corrupt();
    const cl = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
    const clh = huffman(cl);
    const lengths = new Uint8Array(nlen + ndist);
    for (let i = 0; i < nlen + ndist; ) {
      const sym = decode(clh);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      if (sym === 16 && i === 0) throw corrupt();
      const [value, repeat] = sym === 16 ? [lengths[i - 1], 3 + bits(2)] : sym === 17 ? [0, 3 + bits(3)] : [0, 11 + bits(7)];
      if (i + repeat > nlen + ndist) throw corrupt();
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (!lengths[256]) throw corrupt();
    codes(huffman(lengths.subarray(0, nlen)), huffman(lengths.subarray(nlen)));
  };
  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = bitCnt = 0;
      if (pos + 4 > data.length) throw new InflateError('unexpected end of file');
      const len = data[pos] | (data[pos + 1] << 8);
      if ((len ^ 0xffff) !== (data[pos + 2] | (data[pos + 3] << 8))) throw corrupt();
      pos += 4;
      if (pos + len > data.length) throw new InflateError('unexpected end of file');
      need(len);
      out.set(data.subarray(pos, pos + len), n);
      n += len;
      pos += len;
    } else if (type === 1) codes(FIXED_LIT, FIXED_DIST);
    else if (type === 2) dynamic();
    else throw corrupt();
  }
  return { out: out.slice(0, n), end: pos };
}
