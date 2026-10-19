import type { Writer } from '../../../../shell/io.ts';

export class TarStatus {
  failed = false;
  private stderr: Writer;
  private seen = new Set<string>();

  constructor(stderr: Writer) {
    this.stderr = stderr;
  }

  error(msg: string): void {
    this.stderr.write(`tar: ${msg}\n`);
    this.failed = true;
  }

  once(msg: string): void {
    if (this.seen.has(msg)) return;
    this.seen.add(msg);
    this.stderr.write(`tar: ${msg}\n`);
  }

  fatal(msg: string): number {
    this.stderr.write(`tar: ${msg}\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }

  finish(): number {
    if (!this.failed) return 0;
    this.stderr.write('tar: Exiting with failure status due to previous errors\n');
    return 2;
  }
}
