import { Interrupt } from '../../shell/control.ts';
import { runSource } from '../../shell/interpreter.ts';
import { BufferWriter, EMPTY } from '../../shell/io.ts';
import { dispatch } from '../../shell/simple.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { fail, sleep } from '../util.ts';
import { strftime } from './datefmt.ts';
import { isProgram, leadingOpts, parseDuration, programShell, streams } from './exec.ts';
import { hostname } from './info.ts';
import { parseSignal, SIGNAL_NAMES } from './procinfo.ts';

const TRY = (name: string) => `Try '${name} --help' for more information.`;

async function env(ctx: Ctx): Promise<number> {
  const sub = programShell(ctx.shell);
  let args = ctx.args;
  let nul = false;
  let i = 0;
  const value = (a: string, short: string, long: string) => (a === short || a === long ? args[++i] : a.slice(a.startsWith('--') ? long.length + 1 : 2));
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-' || a === '-i' || a === '--ignore-environment') {
      for (const k of sub.exported) sub.vars.delete(k);
      sub.exported.clear();
    } else if (a === '-0' || a === '--null') nul = true;
    else if (/^(-u|--unset(=|$))/.test(a)) sub.unset(value(a, '-u', '--unset') ?? '');
    else if (/^(-C|--chdir(=|$))/.test(a)) {
      const dir = value(a, '-C', '--chdir') ?? '';
      if (!ctx.vfs.isDir(ctx.shell.abs(dir))) return (ctx.stderr.write(`env: cannot change directory to ‘${dir}’: No such file or directory\n`), 125);
      sub.cwd = ctx.shell.abs(dir);
    } else if (/^(-S|--split-string(=|$))/.test(a)) {
      const split = (value(a, '-S', '--split-string') ?? '').split(/\s+/).filter(Boolean);
      args = [...args.slice(0, i + 1), ...split, ...args.slice(i + 1)];
    } else if (a === '--') {
      i++;
      break;
    } else if (a.startsWith('-') && a.length > 1) {
      return (ctx.stderr.write(`env: invalid option -- '${a.slice(1)}'\n${TRY('env')}\n`), 125);
    } else break;
  }
  for (; i < args.length && /^[^=]+=/.test(args[i]); i++) {
    const eq = args[i].indexOf('=');
    sub.export(args[i].slice(0, eq), args[i].slice(eq + 1));
  }
  const argv = args.slice(i);
  if (!argv.length) {
    for (const [k, v] of Object.entries(sub.env())) ctx.stdout.write(`${k}=${v}${nul ? '\0' : '\n'}`);
    return 0;
  }
  if (!sub.vars.has('PATH')) sub.vars.set('PATH', '/usr/bin:/bin');
  if (!isProgram(argv[0], sub)) return (ctx.stderr.write(`env: ‘${argv[0]}’: No such file or directory\n`), 127);
  return dispatch(argv, sub, streams(ctx));
}

function printenv(ctx: Ctx): number {
  const names = ctx.args.filter((a) => a !== '-0' && a !== '--null');
  const end = names.length < ctx.args.length ? '\0' : '\n';
  if (!names.length) {
    for (const [k, v] of Object.entries(ctx.env)) ctx.stdout.write(`${k}=${v}${end}`);
    return 0;
  }
  let status = 0;
  for (const n of names) {
    if (n in ctx.env) ctx.stdout.write(`${ctx.env[n]}${end}`);
    else status = 1;
  }
  return status;
}

const clock = (s: number) => `${Math.floor(s / 60)}m${(s % 60).toFixed(3)}s`;

async function time(ctx: Ctx): Promise<number> {
  const posix = ctx.args[0] === '-p';
  const argv = posix ? ctx.args.slice(1) : ctx.args;
  const start = performance.now();
  const cpu = process.cpuUsage();
  try {
    return argv.length ? await dispatch(argv, ctx.shell, streams(ctx)) : 0;
  } finally {
    const real = (performance.now() - start) / 1000;
    const { user, system } = process.cpuUsage(cpu);
    const [u, s] = [user / 1e6, system / 1e6];
    ctx.stderr.write(posix ? `real ${real.toFixed(2)}\nuser ${u.toFixed(2)}\nsys ${s.toFixed(2)}\n` : `\nreal\t${clock(real)}\nuser\t${clock(u)}\nsys\t${clock(s)}\n`);
  }
}

async function timeout(ctx: Ctx): Promise<number> {
  const { opts, rest } = leadingOpts(ctx.args, {
    flags: 'v',
    values: 'sk',
    long: { 'signal=': 's', 'kill-after=': 'k', 'preserve-status': 'p', foreground: 'f', verbose: 'v' },
  });
  const [dur, ...argv] = rest;
  if (!argv.length) return (ctx.stderr.write(`timeout: missing operand\n${TRY('timeout')}\n`), 125);
  const secs = parseDuration(dur);
  if (secs === null) return (ctx.stderr.write(`timeout: invalid time interval ‘${dur}’\n${TRY('timeout')}\n`), 125);
  const signal = typeof opts.s === 'string' ? parseSignal(opts.s) : 15;
  if (signal === undefined) return (ctx.stderr.write(`timeout: ‘${opts.s}’: invalid signal\n${TRY('timeout')}\n`), 125);
  const sub = programShell(ctx.shell);
  if (!isProgram(argv[0], sub)) return (ctx.stderr.write(`timeout: failed to run command ‘${argv[0]}’: No such file or directory\n`), 127);
  const controller = new AbortController();
  sub.job = controller;
  const forward = () => controller.abort(ctx.signal.reason);
  ctx.signal.addEventListener('abort', forward, { once: true });
  let timedOut = false;
  const timer = secs > 0 && secs < 2 ** 31 / 1000
    ? setTimeout(() => {
        timedOut = true;
        if (opts.v) ctx.stderr.write(`timeout: sending signal ${SIGNAL_NAMES[signal] ?? signal} to command ‘${argv[0]}’\n`);
        controller.abort(signal);
      }, secs * 1000)
    : undefined;
  try {
    const code = await dispatch(argv, sub, streams(ctx));
    return timedOut && !opts.p ? 124 : code;
  } catch (e) {
    if (e instanceof Interrupt && timedOut) return opts.p ? e.code : 124;
    throw e;
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', forward);
  }
}

async function nohup(ctx: Ctx): Promise<number> {
  const argv = ctx.args[0] === '--' ? ctx.args.slice(1) : ctx.args;
  if (!argv.length) return (ctx.stderr.write(`nohup: missing operand\n${TRY('nohup')}\n`), 125);
  const sub = programShell(ctx.shell);
  if (!isProgram(argv[0], sub)) return (ctx.stderr.write(`nohup: failed to run command '${argv[0]}': No such file or directory\n`), 127);
  return dispatch(argv, sub, streams(ctx));
}

async function watch(ctx: Ctx): Promise<number> {
  const { opts, rest } = leadingOpts(ctx.args, {
    flags: 'tbecxd',
    values: 'n',
    long: { 'interval=': 'n', 'no-title': 't', beep: 'b', errexit: 'e', color: 'c', exec: 'x', differences: 'd' },
  });
  const interval = Math.max(0.1, opts.n === undefined ? 2 : Number(opts.n));
  if (Number.isNaN(interval)) return fail(ctx, `failed to parse argument: '${opts.n}'`);
  const cmd = rest.join(' ');
  if (!cmd) return (ctx.stderr.write('Usage:\n watch [options] command\n'), 1);
  while (!ctx.signal.aborted) {
    const buf = new BufferWriter();
    try {
      await runSource(ctx.shell.fork(), cmd, { stdin: EMPTY, stdout: buf, stderr: buf }, { subshell: true });
    } catch (e) {
      if (e instanceof Interrupt) break;
      throw e;
    }
    let screen = '\x1b[H\x1b[2J';
    if (!opts.t) {
      const right = `${hostname(ctx)}: ${strftime('%a %b %e %H:%M:%S %Y', new Date())}`;
      screen += `${`Every ${interval.toFixed(1)}s: ${cmd}`.padEnd(79 - right.length)} ${right}\n\n`;
    }
    ctx.stdout.write(screen + buf.data);
    await sleep(interval * 1000, ctx.signal);
  }
  return 128 + (Number(ctx.signal.reason) || 2);
}

export const runCommands: CommandTable = {
  env: { fn: env, desc: 'run a program in a modified environment' },
  printenv: { fn: printenv, desc: 'print all or part of environment' },
  time: { fn: time, builtin: true, desc: 'Report time consumed by pipeline\'s execution' },
  timeout: { fn: timeout, desc: 'run a command with a time limit' },
  nohup: { fn: nohup, desc: 'run a command immune to hangups, with output to a non-tty' },
  watch: { fn: watch, desc: 'execute a program periodically, showing output fullscreen' },
};
