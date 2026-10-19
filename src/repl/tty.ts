import type { Reader, Writer } from '../shell/io.ts';

/** Terminal stdin for foreground commands: lines typed while a command runs, null on Ctrl-D. */
export class TTYReader implements Reader {
  readonly isTTY = true;
  private queue: (string | null)[] = [];
  private wake: (() => void) | null = null;

  push(chunk: string | null): void {
    this.queue.push(chunk);
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  reset(): void {
    this.queue = [];
  }

  async read(): Promise<string | null> {
    while (!this.queue.length) await new Promise<void>((r) => (this.wake = r));
    return this.queue.shift() ?? null;
  }
}

export function terminalWriter(stream: NodeJS.WriteStream): Writer {
  return { write: (s) => void stream.write(s), isTTY: stream.isTTY };
}

/** Lazily streams a host stream as a Reader; nothing is consumed unless a command reads stdin. */
export function streamReader(stream: NodeJS.ReadStream): Reader {
  let iter: AsyncIterator<Buffer | string> | null = null;
  return {
    async read() {
      iter ??= stream[Symbol.asyncIterator]();
      const { value, done } = await iter.next();
      return done ? null : String(value);
    },
  };
}
