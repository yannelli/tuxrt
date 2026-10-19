import { parentPort, type MessagePort } from 'node:worker_threads';
import { SyncCaller, type Response, type WorkerMessage } from './jq-rpc.ts';
import { failure, runJob, type Job, type JobIO } from '../../commands/extra/toys/jq/run.ts';

interface Start {
  job: Job;
  port: MessagePort;
  flag: Int32Array;
}

const FLUSH_BYTES = 16384;
const FLUSH_MS = 25;
/** After this much output the worker blocks until the downstream pipe has room. */
const DRAIN_BYTES = 262144;

parentPort!.on('message', ({ job, port, flag }: Start) => {
  const rpc = new SyncCaller(port, flag);
  const send = (m: WorkerMessage) => port.postMessage(m);
  let buf = '';
  let last = Date.now();
  let unacked = 0;
  const flush = () => {
    if (buf) send({ t: 'out', s: buf });
    unacked += buf.length;
    buf = '';
    last = Date.now();
    if (unacked > DRAIN_BYTES) {
      unacked = 0;
      rpc.call({ t: 'drain' });
    }
  };
  const data = (res: Response): string | null => {
    if ('error' in res) throw new Error(res.error);
    return res.data;
  };
  const io: JobIO = {
    out: (s) => {
      buf += s;
      if (buf.length > FLUSH_BYTES || Date.now() - last > FLUSH_MS) flush();
    },
    err: (s) => {
      flush();
      send({ t: 'err', s });
    },
    readFile: (path) => data(rpc.call({ t: 'file', path })) ?? '',
    readStdin: () => {
      flush();
      return data(rpc.call({ t: 'stdin' }));
    },
  };
  let code: number;
  try {
    // Reads block on this thread, so the pauses that let a single-threaded host refill stdin are skipped.
    const run = runJob(job, io);
    let step = run.next();
    while (!step.done) step = run.next();
    code = step.value;
  } catch (e) {
    code = failure(e, io.err);
  }
  flush();
  send({ t: 'done', code });
});
