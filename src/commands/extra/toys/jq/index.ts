import { platform } from '../../../../platform/index.ts';
import { BrokenPipe } from '../../../../shell/io.ts';
import type { CommandFn } from '../../../types.ts';
import { failure, runJob, type Job, type JobIO } from './run.ts';

const BUFFER_LIMIT = 16 << 20;

/** jq on the calling thread; a loop that never outputs can't be interrupted, so hosts with threads swap in a worker. */
export const jq: CommandFn = async (ctx) => {
  const chunks: string[] = [];
  let eof = false;
  let buffered = 0;
  const io: JobIO = {
    out: (s) => ctx.stdout.write(s),
    err: (s) => ctx.stderr.write(s),
    readFile: (path) => ctx.vfs.readFile(path),
    readStdin: () => chunks.shift() ?? (eof ? null : undefined),
  };
  const aborted = new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r(), { once: true }));
  const fill = () => Promise.race([ctx.stdin.read().then((c) => (c === null ? (eof = true) : ((buffered += c.length), chunks.push(c)))), aborted]);
  const job: Job = { args: ctx.args, env: ctx.env, cwd: ctx.shell.cwd, home: ctx.shell.get('HOME') ?? '/', stdinTTY: !!ctx.stdin.isTTY, stdoutTTY: !!ctx.stdout.isTTY };
  const run = runJob(job, io);
  try {
    for (let outputs = 0; ; ) {
      const step = run.next();
      if (step.done) return step.value;
      if (step.value === 'more') await fill();
      else if (step.value === 'all') while (!eof && buffered < BUFFER_LIMIT && !ctx.signal.aborted) await fill();
      else if (++outputs % 256 === 0) {
        await ctx.stdout.drain?.();
        await platform.yield();
      }
      if (ctx.signal.aborted) return 128 + (Number(ctx.signal.reason) || 2);
    }
  } catch (e) {
    if (e instanceof BrokenPipe) throw e;
    return failure(e, io.err);
  }
};
