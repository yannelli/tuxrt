import { describe, type Node } from './ast.ts';
import { ExitSignal, Interrupt } from './control.ts';
import { EMPTY, type IO } from './io.ts';
import { exec } from './interpreter.ts';
import type { Job, Shell } from './shell.ts';
import { AbortController } from '../platform/abort.ts';

/** Starts `node` as a background job (`cmd &`). Returns immediately with status 0. */
export function startJob(node: Node, shell: Shell, io: IO): number {
  const { jobs, procs } = shell.kernel;
  const controller = new AbortController();
  const sub = shell.fork();
  sub.job = controller;
  const cmd = describe(node);
  const proc = procs.spawn(cmd, shell.user.uid, shell.pid, controller);
  if (node.type === 'cmd') sub.jobProc = proc.pid;
  const id = Math.max(0, ...jobs.keys()) + 1;
  const job: Job = { id, pid: proc.pid, cmd, done: false, code: 0, controller, promise: Promise.resolve(0) };
  job.promise = exec(node, sub, { ...io, stdin: EMPTY })
    .catch((e) => {
      if (e instanceof Interrupt || e instanceof ExitSignal) return e.code;
      io.stderr.write(`${shell.argv0}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    })
    .then((code) => {
      job.done = true;
      job.code = code;
      procs.exit(proc.pid);
      return code;
    });
  jobs.set(id, job);
  shell.lastBg = proc.pid;
  if (shell.interactive) io.stderr.write(`[${id}] ${proc.pid}\n`);
  return 0;
}

/** Resolves %N, %+, %% or a PID to a job. */
export function findJob(shell: Shell, spec: string | undefined): Job | undefined {
  const jobs = [...shell.kernel.jobs.values()];
  if (spec === undefined || spec === '%%' || spec === '%+' || spec === '%') return jobs.at(-1);
  if (spec.startsWith('%')) return shell.kernel.jobs.get(Number(spec.slice(1)));
  return jobs.find((j) => j.pid === Number(spec));
}

/** Prints and forgets finished jobs, like bash does before each prompt. */
export function reapJobs(shell: Shell, out: { write(s: string): void }): void {
  for (const job of shell.kernel.jobs.values()) {
    if (!job.done) continue;
    const state = job.code === 0 ? 'Done' : job.code > 128 ? 'Terminated' : `Exit ${job.code}`;
    out.write(`[${job.id}]+  ${state.padEnd(24)}${job.cmd}\n`);
    shell.kernel.jobs.delete(job.id);
  }
}
