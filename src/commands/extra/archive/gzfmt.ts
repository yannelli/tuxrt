import { deflateRaw } from '../../../lib/deflate.ts';
import { InflateError, inflateRaw } from '../../../lib/inflate.ts';
import { platform } from '../../../platform/index.ts';
import { concatBytes, utf8Encode } from '../../../vfs/bytes.ts';

const FNAME = 8;
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(data: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export interface GzipOptions {
  name?: string;
  /** Seconds since the epoch; 0 means unknown. */
  mtime?: number;
  level?: number;
}

/** Builds a gzip member by hand so the original name and mtime land in the header like GNU gzip. */
export function gzip(data: Uint8Array, o: GzipOptions = {}): { out: Uint8Array; packed: number } {
  const level = o.level ?? 6;
  const head = new Uint8Array(10);
  head.set([0x1f, 0x8b, 8, o.name ? FNAME : 0]);
  new DataView(head.buffer).setUint32(4, Math.max(0, Math.floor(o.mtime ?? 0)) >>> 0, true);
  head[8] = level === 9 ? 2 : level === 1 ? 4 : 0;
  head[9] = 3;
  const name = o.name ? utf8Encode(`${o.name}\0`) : new Uint8Array(0);
  const body = platform.deflateRaw ? platform.deflateRaw(data, level) : deflateRaw(data, level);
  const tail = new Uint8Array(8);
  new DataView(tail.buffer).setUint32(0, crc32(data), true);
  new DataView(tail.buffer).setUint32(4, data.length >>> 0, true);
  return { out: concatBytes([head, name, body, tail]), packed: body.length };
}

/** Header plus trailer size of the first member, for gzip -v ratios. */
export function gzipOverhead(data: Uint8Array): number {
  const flags = data[3] ?? 0;
  let off = 10;
  if (flags & 4) off += 2 + (data[off] | (data[off + 1] << 8));
  for (const bit of [FNAME, 16]) {
    if (!(flags & bit)) continue;
    while (off < data.length && data[off] !== 0) off++;
    off++;
  }
  if (flags & 2) off += 2;
  return off + 8;
}

/** Decompresses every concatenated member; throws a GNU gzip style reason on corrupt input. */
export function gunzip(data: Uint8Array): Uint8Array {
  if (!isGzip(data)) throw new GzipError('not in gzip format');
  const parts: Uint8Array[] = [];
  for (let at = 0; at < data.length; ) {
    if (parts.length && !isGzip(data.subarray(at))) break;
    if (data[at + 2] !== 8) throw new GzipError('invalid compressed data--format violated');
    const start = at + gzipOverhead(data.subarray(at)) - 8;
    if (start > data.length) throw new GzipError('unexpected end of file');
    let member: { out: Uint8Array; end: number };
    try {
      member = inflateRaw(data, start);
    } catch (e) {
      throw e instanceof InflateError ? new GzipError(e.message) : e;
    }
    if (member.end + 8 > data.length) throw new GzipError('unexpected end of file');
    const tail = new DataView(data.buffer, data.byteOffset + member.end, 8);
    if (tail.getUint32(0, true) !== crc32(member.out) || tail.getUint32(4, true) !== member.out.length >>> 0) throw new GzipError('invalid compressed data--crc error');
    parts.push(member.out);
    at = member.end + 8;
  }
  return concatBytes(parts);
}

export class GzipError extends Error {}
