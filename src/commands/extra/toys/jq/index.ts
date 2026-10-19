import { MessageChannel, Worker } from 'node:worker_threads';
import type { CommandFn, Ctx } from '../../../types.ts';
import { reply, type Request, type Response, type WorkerMessage } from './rpc.ts';
import type { Job } from './run.ts';

// jq runs on a worker so the synchronous evaluator can be interrupted and can recurse deeply.
const WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
const LIMITS = { stackSizeMb: 256 };
let idle: Worker | null = null;

function acquire(): Worker {
  const w = idle ?? new Worker(WORKER_URL, { resourceLimits: LIMITS });
  idle = null;
  w.ref();
  return w;
}

/** Keeps one warm worker for the next jq call; unref'd so it never holds the process open. */
function release(w: Worker): void {
  if (idle) void w.terminate();
  else {
    idle = w;
    w.unref();
  }
}

async function serve(ctx: Ctx, req: Request): Promise<Response> {
  try {
    if (req.t === 'stdin') return { data: await ctx.stdin.read() };
    return { data: ctx.vfs.readFile(req.path) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const jq: CommandFn = (ctx) =>
  new Promise<number>((resolve, reject) => {
    const worker = acquire();
    const { port1, port2 } = new MessageChannel();
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const home = ctx.shell.get('HOME') ?? '/';
    const job: Job = { args: ctx.args, env: ctx.env, cwd: ctx.shell.cwd, home, stdinTTY: !!ctx.stdin.isTTY, stdoutTTY: !!ctx.stdout.isTTY };
    let settled = false;
    const finish = (done: () => void, reusable: boolean) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', onAbort);
      worker.off('error', onError);
      worker.off('exit', onExit);
      port1.close();
      if (reusable) release(worker);
      else void worker.terminate();
      done();
    };
    const onAbort = () => finish(() => resolve(128 + (Number(ctx.signal.reason) || 2)), false);
    const onError = (e: Error) => finish(() => resolve((ctx.stderr.write(`jq: error: ${e.message}\n`), 5)), false);
    const onExit = () => finish(() => resolve(5), false);
    port1.on('message', (m: WorkerMessage) => {
      if (settled) return;
      try {
        if (m.t === 'req') void serve(ctx, m.req).then((res) => settled || reply(port1, flag, res));
        else if (m.t === 'done') finish(() => resolve(m.code), true);
        else (m.t === 'out' ? ctx.stdout : ctx.stderr).write(m.s);
      } catch (e) {
        finish(() => reject(e), false);
      }
    });
    if (ctx.signal.aborted) return onAbort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage({ job, port: port2, flag }, [port2]);
  });
