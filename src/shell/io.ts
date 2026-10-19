export interface Writer {
  write(data: string): void;
  readonly isTTY?: boolean;
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

/** Unbounded in-memory pipe. Writing after the reader closed throws BrokenPipe (SIGPIPE). */
export class Pipe implements Reader, Writer {
  private chunks: string[] = [];
  private closed = false;
  private readerGone = false;
  private wake: (() => void) | null = null;

  write(data: string): void {
    if (this.readerGone) throw new BrokenPipe();
    if (!data) return;
    this.chunks.push(data);
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  closeRead(): void {
    this.readerGone = true;
    this.chunks = [];
  }

  async read(): Promise<string | null> {
    while (!this.chunks.length && !this.closed) await new Promise<void>((r) => (this.wake = r));
    return this.chunks.length ? this.chunks.splice(0).join('') : null;
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
