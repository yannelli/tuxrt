import { findJob } from '../../shell/jobs.ts';
import { parseSignal, SIGNALS } from '../../shell/process.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { bfail } from '../util.ts';

function jobs(ctx: Ctx): number {
  const all = [...ctx.shell.kernel.jobs.values()];
  all.forEach((j, i) => {
    if (ctx.args.includes('-p')) return ctx.stdout.write(`${j.pid}\n`);
    const mark = i === all.length - 1 ? '+' : i === all.length - 2 ? '-' : ' ';
    const state = j.done ? (j.code > 128 ? 'Terminated' : j.code ? `Exit ${j.code}` : 'Done') : 'Running';
    const pid = ctx.args.includes('-l') ? ` ${j.pid}` : '';
    ctx.stdout.write(`[${j.id}]${mark}${pid} ${state.padEnd(24)}${j.cmd}${j.done ? '' : ' &'}\n`);
  });
  return 0;
}

async function fg(ctx: Ctx): Promise<number> {
  const job = findJob(ctx.shell, ctx.args[0]);
  if (!job) return bfail(ctx, `${ctx.args[0] ?? 'current'}: no such job`);
  ctx.stdout.write(`${job.cmd}\n`);
  const abort = () => job.controller.abort(2);
  ctx.signal.addEventListener('abort', abort, { once: true });
  try {
    const code = await job.promise;
    ctx.shell.kernel.jobs.delete(job.id);
    return code;
  } finally {
    ctx.signal.removeEventListener('abort', abort);
  }
}

async function wait(ctx: Ctx): Promise<number> {
  const { jobs } = ctx.shell.kernel;
  const targets = ctx.args.length ? ctx.args.map((a) => findJob(ctx.shell, a)) : [...jobs.values()];
  let code = 0;
  for (const job of targets) {
    if (!job) return 127;
    code = await Promise.race([job.promise, new Promise<number>((r) => ctx.signal.addEventListener('abort', () => r(130), { once: true }))]);
    if (job.done) jobs.delete(job.id);
  }
  return code;
}

function kill(ctx: Ctx): number {
  const args = [...ctx.args];
  if (args[0] === '-l' || args[0] === '-L') {
    ctx.stdout.write(`${Object.entries(SIGNALS).map(([n, v]) => `${String(v).padStart(2)}) SIG${n}`).join('\n')}\n`);
    return 0;
  }
  let signal = SIGNALS.TERM;
  if (args[0] === '-s' || args[0] === '-n') {
    args.shift();
    signal = parseSignal(args.shift() ?? '') ?? -1;
  } else if (args[0]?.startsWith('-')) signal = parseSignal(args.shift()!) ?? -1;
  if (signal < 0) return bfail(ctx, 'invalid signal specification');
  if (!args.length) return bfail(ctx, 'usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...', 2);
  let status = 0;
  const { procs } = ctx.shell.kernel;
  for (const target of args) {
    const pid = target.startsWith('%') ? findJob(ctx.shell, target)?.pid : Number(target);
    const proc = pid === undefined ? undefined : procs.procs.get(pid);
    if (!proc) status = bfail(ctx, `(${target}) - No such process`);
    else if (ctx.shell.user.uid !== 0 && proc.uid !== ctx.shell.user.uid) status = bfail(ctx, `(${target}) - Operation not permitted`);
    else procs.kill(proc.pid, signal);
  }
  return status;
}

function history(ctx: Ctx): number {
  const { history: hist } = ctx.shell.kernel;
  if (ctx.args[0] === '-c') {
    hist.length = 0;
    return 0;
  }
  const n = ctx.args[0] ? Number(ctx.args[0]) : hist.length;
  const start = Math.max(0, hist.length - n);
  hist.slice(start).forEach((line, i) => ctx.stdout.write(`${String(start + i + 1).padStart(5)}  ${line}\n`));
  return 0;
}

function help(ctx: Ctx): number {
  const { commands } = ctx.shell.kernel;
  const builtins = [...commands].filter(([, d]) => d.builtin).sort(([a], [b]) => a.localeCompare(b));
  if (ctx.args[0]) {
    const def = commands.get(ctx.args[0]);
    if (!def) return bfail(ctx, `no help topics match \`${ctx.args[0]}'.`);
    ctx.stdout.write(`${ctx.args[0]}: ${def.desc}\n`);
    return 0;
  }
  ctx.stdout.write('GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu) [tuxrt]\nThese shell commands are defined internally.\n\n');
  for (const [name, def] of builtins) ctx.stdout.write(` ${name.padEnd(10)} ${def.desc}\n`);
  ctx.stdout.write("\nRun 'compgen -c' or 'ls /usr/bin' to see all programs.\n");
  return 0;
}

function compgen(ctx: Ctx): number {
  const { shell } = ctx;
  const names = new Set<string>([...shell.aliases.keys(), ...shell.functions.keys()]);
  for (const [name] of shell.kernel.commands) names.add(name);
  const prefix = ctx.args.find((a) => !a.startsWith('-')) ?? '';
  for (const n of [...names].sort()) if (n.startsWith(prefix)) ctx.stdout.write(`${n}\n`);
  return 0;
}

export const jobBuiltins: CommandTable = {
  jobs: { fn: jobs, builtin: true, desc: 'Display status of jobs' },
  fg: { fn: fg, builtin: true, desc: 'Move job to the foreground' },
  bg: { fn: (ctx) => (findJob(ctx.shell, ctx.args[0]) ? 0 : bfail(ctx, 'current: no such job')), builtin: true, desc: 'Move jobs to the background' },
  wait: { fn: wait, builtin: true, desc: 'Wait for job completion and return exit status' },
  kill: { fn: kill, builtin: true, stub: true, desc: 'Send a signal to a job or process' },
  history: { fn: history, builtin: true, desc: 'Display or manipulate the history list' },
  help: { fn: help, builtin: true, desc: 'Display information about builtin commands' },
  compgen: { fn: compgen, builtin: true, desc: 'Display possible completions' },
};
