import { Interrupt } from '../../shell/control.ts';
import { BrokenPipe, lineReader, Pipe, type IO, type Writer } from '../../shell/io.ts';
import { runShellScript } from '../../shell/script.ts';
import { errMessage } from '../../vfs/errors.ts';
import type { Ctx } from '../types.ts';
import { RecordSource } from './records.ts';

export class AwkError extends Error {
  /** Runtime errors get mawk's "run time error" banner with FILENAME/NR context. */
  runtime: boolean;

  constructor(message: string, runtime = true) {
    super(message);
    this.runtime = runtime;
  }
}

type Stream =
  | { kind: 'file'; path: string }
  | { kind: 'std'; w: Writer }
  | { kind: 'pipeOut'; pipe: Pipe; done: Promise<number> }
  | { kind: 'pipeIn'; pipe: Pipe; src: RecordSource; done: Promise<number> }
  | { kind: 'fileIn'; src: RecordSource };

export function stdinSource(ctx: Ctx): RecordSource {
  const lr = lineReader(ctx.stdin);
  return new RecordSource(() => lr.next());
}

/** Named files and commands opened by print/printf redirection and getline, keyed by name as awk does. */
export class Streams {
  private readonly ctx: Ctx;
  private readonly open = new Map<string, Stream>();

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  write(op: string, name: string, data: string): void {
    let s = this.open.get(name);
    if (!s || s.kind === 'pipeIn' || s.kind === 'fileIn') {
      s = this.openOutput(op, name);
      this.open.set(name, s);
    }
    if (s.kind === 'file') this.ctx.vfs.writeFile(s.path, data, true);
    else if (s.kind === 'std') s.w.write(data);
    else if (s.kind === 'pipeOut') s.pipe.write(data);
  }

  private openOutput(op: string, name: string): Stream {
    const { ctx } = this;
    if (op === '|') {
      const pipe = new Pipe();
      return { kind: 'pipeOut', pipe, done: this.run(name, { stdin: pipe, stdout: ctx.stdout, stderr: ctx.stderr }) };
    }
    const path = ctx.shell.abs(name);
    if (name === '-' || path === '/dev/stdout') return { kind: 'std', w: ctx.stdout };
    if (path === '/dev/stderr') return { kind: 'std', w: ctx.stderr };
    try {
      ctx.vfs.writeFile(path, '', op === '>>');
    } catch (e) {
      throw new AwkError(`cannot open "${name}" for output (${errMessage(e)})`, false);
    }
    return { kind: 'file', path };
  }

  /** Returns null when the file cannot be read (getline then yields -1). */
  fileInput(name: string): RecordSource | null {
    const s = this.open.get(name);
    if (s?.kind === 'fileIn' || s?.kind === 'pipeIn') return s.src;
    let src: RecordSource;
    if (name === '-' || name === '/dev/stdin') src = stdinSource(this.ctx);
    else {
      try {
        src = RecordSource.ofText(this.ctx.vfs.readFile(this.ctx.shell.abs(name)));
      } catch {
        return null;
      }
    }
    this.open.set(name, { kind: 'fileIn', src });
    return src;
  }

  cmdInput(cmd: string): RecordSource {
    const s = this.open.get(cmd);
    if (s?.kind === 'pipeIn' || s?.kind === 'fileIn') return s.src;
    const pipe = new Pipe();
    const done = this.run(cmd, { stdin: this.ctx.stdin, stdout: pipe, stderr: this.ctx.stderr }).finally(() => pipe.close());
    const src = new RecordSource(() => pipe.read());
    this.open.set(cmd, { kind: 'pipeIn', pipe, src, done });
    return src;
  }

  system(cmd: string): Promise<number> {
    return this.run(cmd, this.ctx);
  }

  async close(name: string): Promise<number> {
    const s = this.open.get(name);
    if (!s) return -1;
    this.open.delete(name);
    if (s.kind === 'pipeOut') {
      s.pipe.close();
      return s.done;
    }
    if (s.kind === 'pipeIn') {
      s.pipe.closeRead();
      return s.done;
    }
    return 0;
  }

  async closeAll(): Promise<void> {
    for (const name of [...this.open.keys()]) await this.close(name);
  }

  /** Runs `sh -c cmd`; never rejects, so a background pipe cannot cause an unhandled rejection. */
  private async run(cmd: string, io: IO): Promise<number> {
    try {
      return await runShellScript(cmd, 'sh', [], this.ctx.shell, io);
    } catch (e) {
      if (e instanceof BrokenPipe) return 141;
      if (e instanceof Interrupt) return e.code;
      this.ctx.stderr.write(`${this.ctx.name}: ${errMessage(e)}\n`);
      return 2;
    }
  }
}
