import { isUtf8 } from 'node:buffer';

// VFS files hold text as characters and binary data as latin1 (one char per byte). Binary is told
// apart by control bytes (NUL, C1...) next to high bytes, which real formats always have and text never does.
const CONTROL = /[\x00-\x08\x0e-\x1a\x1c-\x1f\x7f-\x9f]/;

export function isBinary(s: string): boolean {
  return !/[^\x00-\xff]/.test(s) && /[\x80-\xff]/.test(s) && CONTROL.test(s);
}

export function toBytes(s: string): Buffer {
  return Buffer.from(s, isBinary(s) ? 'latin1' : 'utf8');
}

export function fromBytes(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (isUtf8(buf)) {
    const text = buf.toString('utf8');
    if (!isBinary(text)) return text;
  }
  return buf.toString('latin1');
}

export function byteLength(s: string): number {
  return isBinary(s) ? s.length : Buffer.byteLength(s);
}
