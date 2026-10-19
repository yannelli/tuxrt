import { lineReader } from '../../../shell/io.ts';
import { errMessage } from '../../../vfs/errors.ts';
import type { Ctx } from '../../types.ts';
import { abs } from '../../util.ts';
import { textLines, type LineSource } from '../stream.ts';

/** Concatenated inputs with one line of lookahead, so `$` works across files. */
export class SedInput {
  name = '-';
  failed = false;
  private readonly ctx: Ctx;
  private readonly files: string[];
  private idx = 0;
  private cur: LineSource | null = null;
  private curName = '-';
  private peeked: [string | null, string] | undefined;

  constructor(ctx: Ctx, files: string[]) {
    this.ctx = ctx;
    this.files = files;
  }

  private async pull(): Promise<[string | null, string]> {
    for (;;) {
      if (!this.cur) {
        if (this.idx >= this.files.length) return [null, this.curName];
        const f = this.files[this.idx++];
        try {
          this.cur = f === '-' ? lineReader(this.ctx.stdin) : textLines(this.ctx.vfs.readFile(abs(this.ctx, f)));
          this.curName = f;
        } catch (e) {
          const msg = errMessage(e);
          this.ctx.stderr.write(`sed: ${msg === 'Is a directory' ? `read error on ${f}: ${msg}` : `can't read ${f}: ${msg}`}\n`);
          this.failed = true;
          continue;
        }
      }
      const line = await this.cur.next();
      if (line !== null) return [line, this.curName];
      this.cur = null;
    }
  }

  async next(): Promise<string | null> {
    const [line, name] = this.peeked ?? (await this.pull());
    this.peeked = undefined;
    this.name = name;
    return line;
  }

  async isLast(): Promise<boolean> {
    this.peeked ??= await this.pull();
    return this.peeked[0] === null;
  }
}
