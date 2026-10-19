export type TarKind = 'file' | 'dir' | 'symlink' | 'link';

export interface TarEntry {
  name: string;
  kind: TarKind;
  mode: number;
  uid: number;
  gid: number;
  uname: string;
  gname: string;
  /** Seconds since the epoch. */
  mtime: number;
  linkname: string;
  data: Uint8Array;
}

export class TarError extends Error {}

const BLOCK = 512;
const RECORD = 10240;
const TYPEFLAG: Record<TarKind, string> = { file: '0', dir: '5', symlink: '2', link: '1' };
const KIND: Record<string, TarKind> = { '0': 'file', '\0': 'file', '7': 'file', '5': 'dir', '2': 'symlink', '1': 'link' };

function putString(h: Buffer, off: number, len: number, value: string | Uint8Array): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  h.set(bytes.subarray(0, len), off);
}

function putOctal(h: Buffer, off: number, len: number, n: number): void {
  h.write(`${n.toString(8).padStart(len - 1, '0')}\0`, off, 'latin1');
}

/** POSIX ustar stores names over 100 bytes as prefix + "/" + name, splitting at a slash. */
function splitName(name: Buffer): [Buffer, Buffer] {
  if (name.length <= 100) return [Buffer.alloc(0), name];
  for (let i = Math.max(1, name.length - 101); i <= Math.min(155, name.length - 2); i++) {
    if (name[i] === 0x2f) return [name.subarray(0, i), name.subarray(i + 1)];
  }
  throw new TarError('file name is too long (cannot be split); not dumped');
}

export function encodeHeader(e: TarEntry): Buffer {
  const [prefix, name] = splitName(Buffer.from(e.name, 'utf8'));
  if (Buffer.byteLength(e.linkname) > 100) throw new TarError('link name is too long; not dumped');
  const h = Buffer.alloc(BLOCK);
  putString(h, 0, 100, name);
  putOctal(h, 100, 8, e.mode & 0o7777);
  putOctal(h, 108, 8, e.uid);
  putOctal(h, 116, 8, e.gid);
  putOctal(h, 124, 12, e.kind === 'file' ? e.data.length : 0);
  putOctal(h, 136, 12, Math.max(0, Math.floor(e.mtime)));
  h.fill(0x20, 148, 156);
  h.write(TYPEFLAG[e.kind], 156, 'latin1');
  putString(h, 157, 100, e.linkname);
  h.write('ustar\x0000', 257, 'latin1');
  putString(h, 265, 32, e.uname);
  putString(h, 297, 32, e.gname);
  putOctal(h, 329, 8, 0);
  putOctal(h, 337, 8, 0);
  putString(h, 345, 155, prefix);
  h.write(`${checksum(h).toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

/** Concatenates entries, adds the two zero end blocks and pads to a 10240-byte record like GNU tar. */
export function buildTar(blocks: Uint8Array[]): Buffer {
  const body = Buffer.concat([...blocks, Buffer.alloc(BLOCK * 2)]);
  return Buffer.concat([body, Buffer.alloc((RECORD - (body.length % RECORD)) % RECORD)]);
}

export function encodeEntry(e: TarEntry): Buffer {
  const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
  return e.kind === 'file' ? Buffer.concat([encodeHeader(e), e.data, Buffer.alloc(pad)]) : encodeHeader(e);
}

function checksum(h: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum;
}

function getString(h: Uint8Array, off: number, len: number): string {
  const field = h.subarray(off, off + len);
  const end = field.indexOf(0);
  return Buffer.from(end === -1 ? field : field.subarray(0, end)).toString('utf8');
}

function getNumber(h: Uint8Array, off: number, len: number): number {
  if (h[off] & 0x80) {
    let n = h[off] & 0x7f;
    for (let i = 1; i < len; i++) n = n * 256 + h[off + i];
    return n;
  }
  return parseInt(getString(h, off, len).trim() || '0', 8) || 0;
}

function isZero(h: Uint8Array): boolean {
  return h.every((b) => b === 0);
}

function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rec of Buffer.from(data).toString('utf8').split('\n')) {
    const m = /^\d+ ([^=]+)=(.*)$/s.exec(rec);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export interface ParsedTar {
  entries: TarEntry[];
  /** Set when parsing stopped early: the GNU tar diagnostic to print. */
  fatal: string | null;
}

/** Parses ustar, GNU (././@LongLink) and pax headers. Calls `warn` for recoverable damage. */
export function parseTar(buf: Uint8Array, warn: (msg: string) => void): ParsedTar {
  const entries: TarEntry[] = [];
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  let skipping = false;
  let off = 0;
  const done = (fatal: string | null) => ({ entries, fatal });
  for (; off + BLOCK <= buf.length; ) {
    const h = buf.subarray(off, off + BLOCK);
    if (isZero(h)) return done(null);
    if (getNumber(h, 148, 8) !== checksum(h)) {
      if (!off) return done('This does not look like a tar archive');
      if (!skipping) warn('Skipping to next header');
      skipping = true;
      off += BLOCK;
      continue;
    }
    skipping = false;
    const size = getNumber(h, 124, 12);
    const data = buf.subarray(off + BLOCK, off + BLOCK + size);
    if (data.length < size) return done('Unexpected EOF in archive');
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    const type = String.fromCharCode(h[156]);
    if (type === 'L' || type === 'K') {
      const value = getString(data, 0, data.length);
      if (type === 'L') longName = value;
      else longLink = value;
      continue;
    }
    if (type === 'x') {
      pax = paxRecords(data);
      continue;
    }
    const kind = KIND[type];
    if (type === 'g' || !kind) continue;
    const prefix = getString(h, 257, 6) === 'ustar' ? getString(h, 345, 155) : '';
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${getString(h, 0, 100)}` : getString(h, 0, 100));
    entries.push({
      name,
      kind,
      mode: getNumber(h, 100, 8) & 0o7777,
      uid: getNumber(h, 108, 8),
      gid: getNumber(h, 116, 8),
      uname: getString(h, 265, 32),
      gname: getString(h, 297, 32),
      mtime: pax.mtime ? Math.floor(Number(pax.mtime)) : getNumber(h, 136, 12),
      linkname: pax.linkpath ?? longLink ?? getString(h, 157, 100),
      data: kind === 'file' ? data : new Uint8Array(0),
    });
    longName = longLink = null;
    pax = {};
  }
  if (off === buf.length) return done(null);
  return done(off ? 'Unexpected EOF in archive' : 'This does not look like a tar archive');
}
