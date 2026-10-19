import { deflateRawSync, gunzipSync } from 'node:zlib';

const FNAME = 8;
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

// zlib.crc32 only exists on newer Node releases.
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
export function gzip(data: Uint8Array, o: GzipOptions = {}): { out: Buffer; packed: number } {
  const level = o.level ?? 6;
  const head = Buffer.alloc(10);
  head.set([0x1f, 0x8b, 8, o.name ? FNAME : 0]);
  head.writeUInt32LE(Math.max(0, Math.floor(o.mtime ?? 0)) >>> 0, 4);
  head[8] = level === 9 ? 2 : level === 1 ? 4 : 0;
  head[9] = 3;
  const name = o.name ? Buffer.from(`${o.name}\0`, 'utf8') : Buffer.alloc(0);
  const body = deflateRawSync(data, { level });
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(crc32(data), 0);
  tail.writeUInt32LE(data.length >>> 0, 4);
  return { out: Buffer.concat([head, name, body, tail]), packed: body.length };
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
export function gunzip(data: Uint8Array): Buffer {
  if (!isGzip(data)) throw new GzipError('not in gzip format');
  try {
    return gunzipSync(data);
  } catch (e) {
    const { code, message } = e as { code?: string; message?: string };
    if (code === 'Z_BUF_ERROR') throw new GzipError('unexpected end of file');
    throw new GzipError(`invalid compressed data--${/check/.test(message ?? '') ? 'crc error' : 'format violated'}`);
  }
}

export class GzipError extends Error {}
