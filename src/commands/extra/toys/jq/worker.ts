import { parentPort, type MessagePort } from 'node:worker_threads';
import { CliError, HINT } from './cli.ts';
import { SyncCaller, type Response, type WorkerMessage } from './rpc.ts';
import { Exit, runJob, type Job, type JobIO } from './run.ts';

interface Start {
  job: Job;
  port: MessagePort;
  flag: Int32Array;
}

const FLUSH_BYTES = 16384;
const FLUSH_MS = 25;

parentPort!.on('message', ({ job, port, flag }: Start) => {
  const rpc = new SyncCaller(port, flag);
  const send = (m: WorkerMessage) => port.postMessage(m);
  let buf = '';
  let last = Date.now();
  const flush = () => {
    if (buf) send({ t: 'out', s: buf });
    buf = '';
    last = Date.now();
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
    code = runJob(job, io);
  } catch (e) {
    if (e instanceof Exit) code = e.code;
    else if (e instanceof CliError) code = (io.err(`jq: ${e.message}\n${HINT}`), 2);
    else code = (io.err(`jq: error: ${e instanceof Error ? e.message : String(e)}\n`), 5);
  }
  flush();
  send({ t: 'done', code });
});
