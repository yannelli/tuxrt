import type { Proc } from '../../shell/process.ts';
import { findUser } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs, UsageError } from '../util.ts';
import { strftime } from './datefmt.ts';
import { canSignal, comm, elapsed, matchProcs, memory, memPercent, owner, parseSignal, procList, selfPid, startStamp, stat, started } from './procinfo.ts';

interface Col {
  head: string;
  width: number;
  left?: boolean;
  get: (p: Proc) => string;
}

function columns(ctx: Ctx, self: number): Record<string, Col> {
  return {
    pid: { head: 'PID', width: 7, get: (p) => String(p.pid) },
    ppid: { head: 'PPID', width: 7, get: (p) => String(p.ppid) },
    uid: { head: 'UID', width: 5, get: (p) => String(p.uid) },
    user: { head: 'USER', width: 8, left: true, get: (p) => owner(ctx, p) },
    c: { head: 'C', width: 2, get: () => '0' },
    stime: { head: 'STIME', width: 5, left: true, get: startStamp },
    start: { head: 'START', width: 5, get: startStamp },
    tty: { head: 'TT', width: 8, left: true, get: (p) => p.tty },
    time: { head: 'TIME', width: 8, get: () => '00:00:00' },
    bsdtime: { head: 'TIME', width: 6, get: () => '0:00' },
    etime: { head: 'ELAPSED', width: 11, get: elapsed },
    lstart: { head: 'STARTED', width: 24, left: true, get: (p) => strftime('%a %b %e %H:%M:%S %Y', new Date(started(p))) },
    stat: { head: 'STAT', width: 4, left: true, get: (p) => stat(ctx, p, self) },
    '%cpu': { head: '%CPU', width: 4, get: () => '0.0' },
    '%mem': { head: '%MEM', width: 4, get: memPercent },
    vsz: { head: 'VSZ', width: 6, get: (p) => String(memory(p)[0]) },
    rss: { head: 'RSS', width: 5, get: (p) => String(memory(p)[1]) },
    ni: { head: 'NI', width: 3, get: () => '0' },
    comm: { head: 'COMMAND', width: 0, left: true, get: comm },
    args: { head: 'COMMAND', width: 0, left: true, get: (p) => p.cmd },
  };
}

const ALIASES: Record<string, [string, string?]> = {
  cmd: ['args', 'CMD'], command: ['args'], ucmd: ['comm'], ucomm: ['comm'], pcpu: ['%cpu'], pmem: ['%mem'], euser: ['user'],
  ruser: ['user', 'RUSER'], euid: ['uid', 'EUID'], tname: ['tty'], tt: ['tty'], cputime: ['time'], s: ['stat', 'S'],
};

type Spec = [string, string?][];
const FORMATS: Record<string, Spec> = {
  default: [['pid'], ['tty', 'TTY'], ['time'], ['comm', 'CMD']],
  full: [['user', 'UID'], ['pid'], ['ppid'], ['c'], ['stime'], ['tty', 'TTY'], ['time'], ['args', 'CMD']],
  bsdUser: [['user'], ['pid'], ['%cpu'], ['%mem'], ['vsz'], ['rss'], ['tty', 'TTY'], ['stat'], ['start'], ['bsdtime'], ['args']],
  bsd: [['pid'], ['tty', 'TTY'], ['stat'], ['bsdtime'], ['args']],
};

function userSpec(list: string): Spec {
  return list.split(/[\s,]+/).filter(Boolean).map((item) => {
    const [name, head] = item.split(/=(.*)/s);
    const [key, aliasHead] = ALIASES[name.toLowerCase()] ?? [name.toLowerCase()];
    return [key, head ?? aliasHead];
  });
}

function render(ctx: Ctx, spec: Spec, procs: Proc[], header: boolean, self: number): number {
  const cols = columns(ctx, self);
  const unknown = spec.find(([k]) => !cols[k]);
  if (unknown) return (ctx.stderr.write(`error: unknown user-defined format specifier "${unknown[0]}"\n`), 1);
  const cell = (c: string, i: number) => {
    const col = cols[spec[i][0]];
    if (i === spec.length - 1 && col.left) return c;
    return col.left ? c.padEnd(col.width) : c.padStart(col.width);
  };
  const line = (cells: string[]) => `${cells.map(cell).join(' ').trimEnd()}\n`;
  const heads = spec.map(([k, h]) => h ?? cols[k].head);
  if (header && heads.some(Boolean)) ctx.stdout.write(line(heads));
  for (const p of procs) ctx.stdout.write(line(spec.map(([k]) => cols[k].get(p))));
  return procs.length ? 0 : 1;
}

function ps(ctx: Ctx): number {
  const args = [...ctx.args];
  const sel = { all: false, tty: false, mine: false, pids: [] as number[], users: [] as string[], cmds: [] as string[] };
  let fmt: Spec | null = null;
  let full = false;
  let bsdUser = false;
  let bsd = false;
  let header = true;
  const list = (s: string | undefined) => {
    if (s === undefined) throw new UsageError('list of process IDs must follow -p');
    return s.split(/[\s,]+/).filter(Boolean);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = (rest: string) => list(rest || args[++i]);
    if (a === '--no-headers' || a === '--no-heading') header = false;
    else if (a.startsWith('--pid')) sel.pids.push(...value(a.slice(6)).map(Number));
    else if (/^--(format|cols)/.test(a)) fmt = userSpec(value(a.replace(/^--\w+=?/, '')).join(','));
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else if (a.startsWith('-')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'e' || c === 'A') sel.all = true;
        else if (c === 'f' || c === 'F') full = true;
        else if (c === 'w' || c === 'l' || c === 'y' || c === 'H') continue;
        else if ('pouUC'.includes(c)) {
          const v = value(a.slice(j + 1));
          if (c === 'p') sel.pids.push(...v.map(Number));
          else if (c === 'o') fmt = [...(fmt ?? []), ...userSpec(v.join(','))];
          else if (c === 'C') sel.cmds.push(...v);
          else sel.users.push(...v);
          break;
        } else throw new UsageError(`unsupported SysV option -- '${c}'`);
      }
    } else if (/^\d+(,\d+)*$/.test(a)) sel.pids.push(...a.split(',').map(Number));
    else {
      for (const c of a) {
        if (c === 'a') (sel.tty = true, (bsd = true));
        else if (c === 'x') (sel.mine = true, (bsd = true));
        else if (c === 'u') bsdUser = true;
        else if (c === 'h') header = false;
        else if (!'wef'.includes(c)) throw new UsageError(`unsupported option (BSD syntax) -- '${c}'`);
      }
    }
  }
  const self = selfPid(ctx);
  const uid = ctx.shell.user.uid;
  const uids = sel.users.map((u) => findUser(ctx.vfs, u)?.uid ?? -1);
  const filters = sel.pids.length || uids.length || sel.cmds.length;
  const procs = procList(ctx).filter((p) => {
    if (filters) return sel.pids.includes(p.pid) || uids.includes(p.uid) || sel.cmds.includes(comm(p));
    if (sel.all || (sel.tty && sel.mine)) return true;
    if (sel.tty) return p.tty !== '?';
    if (sel.mine) return p.uid === uid;
    return p.tty === 'pts/0' && p.uid === uid;
  });
  const spec = fmt ?? FORMATS[bsdUser ? 'bsdUser' : full ? 'full' : bsd ? 'bsd' : 'default'];
  return render(ctx, spec, procs, header, self);
}

function matcherArgs(ctx: Ctx, args: string[], flags: string) {
  const { opts, operands } = parseArgs(args, {
    flags,
    values: 'uds',
    long: { full: 'f', exact: 'x', newest: 'n', oldest: 'o', count: 'c', 'list-name': 'l', 'list-full': 'a', 'ignore-case': 'i', echo: 'e', 'signal=': 's', 'delimiter=': 'd' },
  });
  if (operands.length > 1) throw new UsageError('only one pattern can be provided');
  if (!operands.length) throw new UsageError('no matching criteria specified');
  let procs = matchProcs(ctx, { pattern: operands[0], full: !!opts.f, exact: !!opts.x, ignoreCase: !!opts.i, user: opts.u as string | undefined });
  if (opts.n) procs = procs.slice(-1);
  if (opts.o) procs = procs.slice(0, 1);
  return { opts, procs };
}

function pgrep(ctx: Ctx): number {
  const { opts, procs } = matcherArgs(ctx, ctx.args, 'lafxnocie');
  if (opts.c) return (ctx.stdout.write(`${procs.length}\n`), procs.length ? 0 : 1);
  const show = (p: Proc) => (opts.a ? `${p.pid} ${p.cmd}` : opts.l ? `${p.pid} ${comm(p)}` : String(p.pid));
  if (procs.length) ctx.stdout.write(`${procs.map(show).join(typeof opts.d === 'string' ? opts.d : '\n')}\n`);
  return procs.length ? 0 : 1;
}

/** Splits a leading `-SIGNAL` off the arguments, as kill/pkill/killall accept. */
function takeSignal(ctx: Ctx): [number, string[]] {
  const [first, ...rest] = ctx.args;
  if (!first || !/^-([A-Z]+[0-9]*|\d+)$/i.test(first) || (ctx.name === 'pkill' && /^-[fxnoie]+$/.test(first))) return [15, ctx.args];
  const sig = parseSignal(first);
  if (sig === undefined) throw new UsageError(`unknown signal name ${first.slice(1)}`);
  return [sig, rest];
}

function pkill(ctx: Ctx): number {
  let [signal, args] = takeSignal(ctx);
  const { opts, procs } = matcherArgs(ctx, args, 'fxnoie');
  if (typeof opts.s === 'string') signal = parseSignal(opts.s) ?? signal;
  let status = procs.length ? 0 : 1;
  for (const p of procs) {
    if (!canSignal(ctx, p)) status = fail(ctx, `killing pid ${p.pid} failed: Operation not permitted`);
    else {
      ctx.shell.kernel.procs.kill(p.pid, signal);
      if (opts.e) ctx.stdout.write(`${comm(p)} killed (pid ${p.pid})\n`);
    }
  }
  return status;
}

function killall(ctx: Ctx): number {
  let [signal, args] = takeSignal(ctx);
  const { opts, operands } = parseArgs(args, { flags: 'qvIe', values: 'su', long: { quiet: 'q', verbose: 'v', 'signal=': 's', 'user=': 'u' } });
  if (typeof opts.s === 'string') signal = parseSignal(opts.s) ?? signal;
  if (!operands.length) return (ctx.stderr.write('Usage: killall [OPTION]... [--] NAME...\n'), 1);
  let status = 0;
  const self = selfPid(ctx);
  for (const name of operands) {
    const procs = procList(ctx).filter((p) => comm(p) === name.slice(0, 15) && p.pid !== self);
    if (!procs.length) {
      if (!opts.q) ctx.stderr.write(`${name}: no process found\n`);
      status = 1;
    }
    for (const p of procs) {
      if (!canSignal(ctx, p)) status = (ctx.stderr.write(`${name}(${p.pid}): Operation not permitted\n`), 1);
      else {
        ctx.shell.kernel.procs.kill(p.pid, signal);
        if (opts.v) ctx.stderr.write(`Killed ${name}(${p.pid}) with signal ${signal}\n`);
      }
    }
  }
  return status;
}

export const procCommands: CommandTable = {
  ps: { fn: command(ps), desc: 'list running processes' },
  pgrep: { fn: command(pgrep), desc: 'find processes by name' },
  pkill: { fn: command(pkill), desc: 'signal processes by name' },
  killall: { fn: command(killall), desc: 'kill processes by name' },
};
