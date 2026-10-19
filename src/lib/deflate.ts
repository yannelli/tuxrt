import { DIST_BASE, DIST_EXTRA, LEN_BASE, LEN_EXTRA } from './inflate.ts';

const WINDOW = 32768;
const MAX_MATCH = 258;
const CHAIN: Record<number, number> = { 1: 4, 2: 8, 3: 16, 4: 32, 5: 64, 6: 128, 7: 256, 8: 1024, 9: 4096 };

class BitWriter {
  buf = new Uint8Array(1024);
  n = 0;
  private acc = 0;
  private cnt = 0;

  private byte(b: number): void {
    if (this.n === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.n++] = b;
  }

  bits(value: number, count: number): void {
    this.acc |= value << this.cnt;
    this.cnt += count;
    while (this.cnt >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.cnt -= 8;
    }
  }

  /** Huffman codes go out most-significant bit first. */
  code(value: number, count: number): void {
    let rev = 0;
    for (let i = 0; i < count; i++) rev |= ((value >> i) & 1) << (count - 1 - i);
    this.bits(rev, count);
  }

  align(): void {
    if (this.cnt) this.bits(0, 8 - this.cnt);
  }

  bytes(data: Uint8Array): void {
    for (const b of data) this.byte(b);
  }
}

function literal(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

const indexOf = (table: number[], v: number) => {
  let i = table.length - 1;
  while (table[i] > v) i--;
  return i;
};

/** Literal (-1 distance) or [length, distance] pairs from greedy LZ77 over hash chains. */
function tokenize(data: Uint8Array, chain: number): Int32Array {
  const tokens = new Int32Array(data.length * 2);
  let t = 0;
  const head = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(WINDOW);
  const hash = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & 0x7fff;
  const insert = (i: number) => {
    if (i + 2 >= data.length) return;
    const h = hash(i);
    prev[i & (WINDOW - 1)] = head[h];
    head[h] = i;
  };
  for (let i = 0; i < data.length; ) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < data.length) {
      const limit = Math.min(MAX_MATCH, data.length - i);
      for (let c = head[hash(i)], tries = chain; c >= 0 && i - c <= WINDOW && tries-- > 0; c = prev[c & (WINDOW - 1)]) {
        if (data[c + bestLen] !== data[i + bestLen]) continue;
        let len = 0;
        while (len < limit && data[c + len] === data[i + len]) len++;
        if (len > bestLen) [bestLen, bestDist] = [len, i - c];
        if (len === limit) break;
      }
    }
    if (bestLen >= 3) {
      tokens[t++] = bestLen;
      tokens[t++] = bestDist;
      for (const end = i + bestLen; i < end; i++) insert(i);
    } else {
      tokens[t++] = data[i];
      tokens[t++] = -1;
      insert(i++);
    }
  }
  return tokens.subarray(0, t);
}

function stored(w: BitWriter, data: Uint8Array): void {
  for (let i = 0; i === 0 || i < data.length; i += 65535) {
    const chunk = data.subarray(i, i + 65535);
    w.bits(i + 65535 >= data.length ? 1 : 0, 1);
    w.bits(0, 2);
    w.align();
    w.bits(chunk.length, 16);
    w.bits(chunk.length ^ 0xffff, 16);
    w.bytes(chunk);
  }
}

/** Raw DEFLATE with fixed Huffman codes, or stored blocks when that is smaller (or level 0). */
export function deflateRaw(data: Uint8Array, level = 6): Uint8Array {
  const w = new BitWriter();
  if (level <= 0) return stored(w, data), w.buf.slice(0, w.n);
  const tokens = tokenize(data, CHAIN[Math.min(level, 9)]);
  w.bits(1, 1);
  w.bits(1, 2);
  for (let i = 0; i < tokens.length; i += 2) {
    const [a, dist] = [tokens[i], tokens[i + 1]];
    if (dist < 0) {
      literal(w, a);
      continue;
    }
    const li = indexOf(LEN_BASE, a);
    literal(w, 257 + li);
    w.bits(a - LEN_BASE[li], LEN_EXTRA[li]);
    const di = indexOf(DIST_BASE, dist);
    w.code(di, 5);
    w.bits(dist - DIST_BASE[di], DIST_EXTRA[di]);
  }
  literal(w, 256);
  w.align();
  if (w.n <= data.length + 5 * Math.ceil(Math.max(data.length, 1) / 65535)) return w.buf.slice(0, w.n);
  const raw = new BitWriter();
  stored(raw, data);
  return raw.buf.slice(0, raw.n);
}
