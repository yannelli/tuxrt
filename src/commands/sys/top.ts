import type { Proc } from '../../shell/process.ts';
import { memoryUsage } from '../../vfs/machine.ts';
import { findUser } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs, sleep } from '../util.ts';
import { comm, memory, memPercent, owner, procList, selfPid } from './procinfo.ts';
import { uptimeLine } from './session.ts';

function snapshot(ctx: Ctx, procs: Proc[], self: number): string {
  const m = memoryUsage();
  const mib = (kb: number) => (kb / 1024).toFixed(1).padStart(8);
  const n = (v: number) => String(v).padStart(3);
  const lines = [
    `top - ${uptimeLine()}`,
    `Tasks: ${n(procs.length)} total, ${n(1)} running, ${n(procs.length - 1)} sleeping, ${n(0)} stopped, ${n(0)} zombie`,
    '%Cpu(s):  0.3 us,  0.2 sy,  0.0 ni, 99.5 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st ',
    `MiB Mem : ${mib(m.total)} total, ${mib(m.free)} free, ${mib(m.used)} used, ${mib(m.buffCache)} buff/cache     `,
    `MiB Swap: ${mib(0)} total, ${mib(0)} free, ${mib(0)} used. ${mib(m.available)} avail Mem `,
    '',
    '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
  ];
  const ordered = [...procs.filter((p) => p.pid === self), ...procs.filter((p) => p.pid !== self)];
  for (const p of ordered) {
    const [vsz, rss] = memory(p);
    const cells = [
      String(p.pid).padStart(7), owner(ctx, p).padEnd(8), '20'.padStart(3), '0'.padStart(3), String(vsz).padStart(7),
      String(rss).padStart(6), String(Math.round(rss * 0.6)).padStart(6), p.pid === self ? 'R' : 'S',
      (p.pid === self ? '6.2' : '0.0').padStart(5), memPercent(p).padStart(5), '0:00.00'.padStart(9), comm(p),
    ];
    lines.push(cells.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

async function top(ctx: Ctx): Promise<number> {
  const { opts } = parseArgs(ctx.args, { flags: 'bciHSE', values: 'ndupwo', long: { batch: 'b' } });
  const iterations = opts.n !== undefined ? Number(opts.n) : ctx.stdout.isTTY && !opts.b ? Infinity : 1;
  const delay = opts.d !== undefined ? Number(opts.d) : 3;
  if (!(iterations > 0) || !(delay >= 0)) return fail(ctx, `bad iterations/delay argument '${opts.n ?? opts.d}'`);
  const uid = typeof opts.u === 'string' ? findUser(ctx.vfs, opts.u)?.uid : undefined;
  if (typeof opts.u === 'string' && uid === undefined) return fail(ctx, `Invalid user`);
  const pids = typeof opts.p === 'string' ? opts.p.split(',').map(Number) : null;
  const self = selfPid(ctx);
  for (let i = 0; i < iterations && !ctx.signal.aborted; i++) {
    const procs = procList(ctx).filter((p) => !p.cmd.startsWith('[') && (uid === undefined || p.uid === uid) && (!pids || pids.includes(p.pid)));
    ctx.stdout.write(`${opts.b ? (i ? '\n' : '') : '\x1b[H\x1b[2J'}${snapshot(ctx, procs, self)}`);
    if (i + 1 < iterations) await sleep(delay * 1000, ctx.signal);
  }
  return 0;
}

function pstree(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'pacnlUA', long: { 'show-pids': 'p', arguments: 'a' } });
  const procs = procList(ctx).filter((p) => !p.cmd.startsWith('['));
  const root = operands.length ? Number(operands[0]) : 1;
  if (!procs.some((p) => p.pid === root)) return 1;
  const label = (p: Proc) => `${opts.a ? p.cmd.replace(/^-/, '') : comm(p)}${opts.p ? `(${p.pid})` : ''}`;
  const children = (pid: number) =>
    procs.filter((p) => p.ppid === pid && p.pid !== pid).sort((a, b) => label(a).localeCompare(label(b)) || a.pid - b.pid);
  const tree = (p: Proc): string[] => {
    const name = label(p);
    const kids = children(p.pid);
    if (!kids.length) return [name];
    const pad = ' '.repeat(name.length);
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return tree(k).map((line, j) => {
        if (j > 0) return `${pad}${last ? '   ' : ' │ '}${line}`;
        if (i === 0) return `${name}${kids.length === 1 ? '───' : '─┬─'}${line}`;
        return `${pad}${last ? ' └─' : ' ├─'}${line}`;
      });
    });
  };
  ctx.stdout.write(`${tree(procs.find((p) => p.pid === root)!).join('\n')}\n`);
  return 0;
}

export const topCommands: CommandTable = {
  top: { fn: command(top), desc: 'display Linux processes' },
  pstree: { fn: command(pstree), desc: 'display a tree of processes' },
};
