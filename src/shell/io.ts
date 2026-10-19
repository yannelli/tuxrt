export interface Writer {
  write(data: string): void;
  readonly isTTY?: boolean;
  /** Resolves once buffered output has been consumed; fast producers await it so pipes stay bounded. */
  drain?(): Promise<void>;
}

export interface Reader {
  /** Resolves to the next chunk, or null at end of input. */
  read(): Promise<string | null>;
  readonly isTTY?: boolean;
}

export interface IO {
  stdin: Reader;
  stdout: Writer;
  stderr: Writer;
}

export class BrokenPipe extends Error {}

export class BufferWriter implements Writer {
  data = '';

  write(data: string): void {
    this.data += data;
  }
}

export class StringReader implements Reader {
  private data: string | null;

  constructor(data: string) {
    this.data = data === '' ? null : data;
  }

  async read(): Promise<string | null> {
    const d = this.data;
    this.data = null;
    return d;
  }
}

export const EMPTY: Reader = { read: async () => null };
export const DISCARD: Writer = { write: () => {} };

/** Pipe capacity, like Linux's 64 KiB: writers that await drain() pause beyond this. */
const PIPE_HIGH_WATER = 65536;

/** In-memory pipe. Writing after the reader closed throws BrokenPipe (SIGPIPE). */
export class Pipe implements Reader, Writer {
  private chunks: string[] = [];
  private size = 0;
  private closed = false;
  private readerGone = false;
  private wake: (() => void) | null = null;
  private drainers: (() => void)[] = [];

  write(data: string): void {
    if (this.readerGone) throw new BrokenPipe();
    if (!data) return;
    this.chunks.push(data);
    this.size += data.length;
    this.notify();
  }

  drain(): Promise<void> {
    if (this.size < PIPE_HIGH_WATER || this.readerGone) return Promise.resolve();
    return new Promise((r) => this.drainers.push(r));
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  closeRead(): void {
    this.readerGone = true;
    this.chunks = [];
    this.size = 0;
    this.release();
  }

  /** Returns at most about one pipe-capacity of data per call, so a flood never becomes one giant string. */
  async read(): Promise<string | null> {
    while (!this.chunks.length && !this.closed) await new Promise<void>((r) => (this.wake = r));
    if (!this.chunks.length) return null;
    let n = 0;
    let taken = 0;
    while (n < this.chunks.length && (n === 0 || taken + this.chunks[n].length <= PIPE_HIGH_WATER)) taken += this.chunks[n++].length;
    const out = this.chunks.splice(0, n).join('');
    this.size -= out.length;
    if (this.size < PIPE_HIGH_WATER) this.release();
    return out;
  }

  private release(): void {
    const waiting = this.drainers;
    this.drainers = [];
    for (const r of waiting) r();
  }

  private notify(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
}

export async function readAll(reader: Reader): Promise<string> {
  let out = lineReaders.get(reader)?.drain() ?? '';
  for (let chunk = await reader.read(); chunk !== null; chunk = await reader.read()) out += chunk;
  return out;
}

const lineReaders = new WeakMap<Reader, LineReader>();

/** Shared per-Reader line buffer, so successive `read` calls and later consumers never lose data. */
export function lineReader(reader: Reader): LineReader {
  let lr = lineReaders.get(reader);
  if (!lr) lineReaders.set(reader, (lr = new LineReader(reader)));
  return lr;
}

class LineReader {
  private buf = '';
  private eof = false;
  private readonly src: Reader;

  constructor(src: Reader) {
    this.src = src;
  }

  drain(): string {
    const rest = this.buf;
    this.buf = '';
    return rest;
  }

  /** Returns the next line including its trailing newline, or null at EOF. */
  async next(): Promise<string | null> {
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl !== -1) {
        const line = this.buf.slice(0, nl + 1);
        this.buf = this.buf.slice(nl + 1);
        return line;
      }
      if (this.eof) {
        const rest = this.buf;
        this.buf = '';
        return rest === '' ? null : rest;
      }
      const chunk = await this.src.read();
      if (chunk === null) this.eof = true;
      else this.buf += chunk;
    }
  }
}
