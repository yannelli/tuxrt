import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fromBytes } from '../../../../vfs/bytes.ts';
import { crc32 } from '../gzfmt.ts';

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  size: number;
  packed: Uint8Array;
  /** Milliseconds since the epoch. */
  mtime: number;
  madeBy: number;
  attr: number;
  flags: number;
}

export class ZipError extends Error {}

export const S_IFMT = 0o170000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const MADE_BY_UNIX = (3 << 8) | 30;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const EXT_TIME = 0x5455;

/** Unix st_mode stored in the high half of the external attributes, or null for non-Unix archives. */
export function unixMode(e: ZipEntry): number | null {
  return e.madeBy >> 8 === 3 && e.attr >>> 16 ? e.attr >>> 16 : null;
}

/** Deflates unless that does not shrink the data, like Info-ZIP; `name` ends with "/" for directories. */
export function makeEntry(name: string, data: Uint8Array, perm: number, kind: 'file' | 'dir' | 'symlink', mtime: number): ZipEntry {
  const deflated = data.length ? deflateRawSync(data) : null;
  const useDeflate = deflated !== null && deflated.length < data.length;
  const type = kind === 'dir' ? S_IFDIR : kind === 'symlink' ? S_IFLNK : S_IFREG;
  return {
    name, method: useDeflate ? 8 : 0, crc: crc32(data), size: data.length, packed: useDeflate ? deflated : data, mtime,
    madeBy: MADE_BY_UNIX, attr: ((type | (perm & 0o7777)) * 0x10000 + (kind === 'dir' ? 0x10 : 0)) >>> 0,
    flags: /[^\x00-\x7f]/.test(name) ? 0x800 : 0,
  };
}

export function unpack(e: ZipEntry): Uint8Array {
  if (e.method === 0) return e.packed;
  if (e.method === 8) return inflateRawSync(e.packed);
  throw new ZipError(`unsupported compression method ${e.method}`);
}

function dosTime(ms: number): [number, number] {
  const d = new Date(Math.max(ms, Date.UTC(1980, 0, 1)));
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return [time, date];
}

function fromDos(time: number, date: number): number {
  return Date.UTC((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

/** Info-ZIP "UT" extra field so mtimes survive at one-second precision. */
function timeExtra(ms: number): Buffer {
  const b = Buffer.alloc(9);
  b.writeUInt16LE(EXT_TIME, 0);
  b.writeUInt16LE(5, 2);
  b[4] = 1;
  b.writeUInt32LE(Math.max(0, Math.floor(ms / 1000)) >>> 0, 5);
  return b;
}

function extraTime(extra: Uint8Array): number | null {
  const b = Buffer.from(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let p = 0; p + 4 <= b.length; p += 4 + b.readUInt16LE(p + 2)) {
    if (b.readUInt16LE(p) === EXT_TIME && b.readUInt16LE(p + 2) >= 5 && b[p + 4] & 1) return b.readUInt32LE(p + 5) * 1000;
  }
  return null;
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const extra = timeExtra(e.mtime);
    const [time, date] = dosTime(e.mtime);
    const needed = e.method === 8 ? 20 : 10;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    for (const [at, v] of [[4, needed], [6, e.flags], [8, e.method], [10, time], [12, date], [26, name.length], [28, extra.length]]) local.writeUInt16LE(v, at);
    for (const [at, v] of [[14, e.crc], [18, e.packed.length], [22, e.size]]) local.writeUInt32LE(v, at);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    for (const [at, v] of [[4, e.madeBy], [6, needed], [8, e.flags], [10, e.method], [12, time], [14, date], [28, name.length], [30, extra.length]]) central.writeUInt16LE(v, at);
    for (const [at, v] of [[16, e.crc], [20, e.packed.length], [24, e.size], [38, e.attr], [42, offset]]) central.writeUInt32LE(v, at);
    locals.push(local, name, extra, e.packed);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + e.packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function findEnd(b: Buffer): number {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === SIG_END) return i;
  throw new ZipError('End-of-central-directory signature not found.');
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(b);
  const out: ZipEntry[] = [];
  let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError('bad zipfile offset (central directory)');
    const [nameLen, extraLen, commentLen] = [b.readUInt16LE(p + 28), b.readUInt16LE(p + 30), b.readUInt16LE(p + 32)];
    const local = b.readUInt32LE(p + 42);
    if (local + 30 > b.length || b.readUInt32LE(local) !== SIG_LOCAL) throw new ZipError('bad zipfile offset (local header sig)');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const csize = b.readUInt32LE(p + 20);
    if (start + csize > b.length) throw new ZipError('bad zipfile offset (lseek)');
    out.push({
      name: fromBytes(b.subarray(p + 46, p + 46 + nameLen)),
      method: b.readUInt16LE(p + 10),
      crc: b.readUInt32LE(p + 16),
      size: b.readUInt32LE(p + 24),
      packed: b.subarray(start, start + csize),
      mtime: extraTime(b.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)) ?? fromDos(b.readUInt16LE(p + 12), b.readUInt16LE(p + 14)),
      madeBy: b.readUInt16LE(p + 4),
      attr: b.readUInt32LE(p + 38),
      flags: b.readUInt16LE(p + 8),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
