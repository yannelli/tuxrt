import { receiveMessageOnPort, type MessagePort } from 'node:worker_threads';

export type Request = { t: 'stdin' } | { t: 'file'; path: string };
export type Response = { data: string | null } | { error: string };

/** Worker-to-host traffic: output, completion, and blocking requests. */
export type WorkerMessage = { t: 'out' | 'err'; s: string } | { t: 'done'; code: number } | { t: 'req'; req: Request };

/** Blocking call from the worker: sleep on a shared flag, then dequeue the host's reply synchronously. */
export class SyncCaller {
  private readonly port: MessagePort;
  private readonly flag: Int32Array;

  constructor(port: MessagePort, flag: Int32Array) {
    this.port = port;
    this.flag = flag;
  }

  call(req: Request): Response {
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage({ t: 'req', req } satisfies WorkerMessage);
    Atomics.wait(this.flag, 0, 0);
    return receiveMessageOnPort(this.port)!.message as Response;
  }
}

/** Host side: deliver the reply, then wake the worker. */
export function reply(port: MessagePort, flag: Int32Array, res: Response): void {
  port.postMessage(res);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}
