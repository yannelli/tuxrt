import { memoryUsage, uptimeSeconds } from '../../vfs/machine.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { strftime } from './datefmt.ts';
import { loginUser } from './login.ts';

const FROM = '10.0.2.2';

export function bootTime(): number {
  return Date.now() - uptimeSeconds() * 1000;
}

function loginTime(ctx: Ctx): number {
  const logins = [...ctx.shell.kernel.procs.procs.values()].filter((p) => p.cmd === '-bash').map((p) => p.start);
  return Math.min(Date.now(), ...logins);
}

/** procps' "10:03:21 up  1:02,  1 user,  load average: ..." shared by uptime, w and top. */
export function uptimeLine(): string {
  const mins = Math.floor(uptimeSeconds() / 60);
  const days = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const up = `${days ? `${days} day${days > 1 ? 's' : ''}, ` : ''}${h ? `${String(h).padStart(2)}:${String(m).padStart(2, '0')}` : `${m} min`}`;
  return `${strftime('%H:%M:%S', new Date())} up ${up},  1 user,  load average: 0.08, 0.03, 0.01`;
}

function pretty(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const parts: [number, string][] = [[Math.floor(mins / 10080), 'week'], [Math.floor((mins % 10080) / 1440), 'day'], [Math.floor((mins % 1440) / 60), 'hour'], [mins % 60, 'minute']];
  const shown = parts.filter(([n], i) => n || (i === 3 && mins < 60));
  return `up ${shown.map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`).join(', ')}`;
}

function uptime(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, { flags: 'ps', long: { pretty: 'p', since: 's' } });
  if (opts.p) ctx.stdout.write(`${pretty(uptimeSeconds())}\n`);
  else if (opts.s) ctx.stdout.write(`${strftime('%Y-%m-%d %H:%M:%S', new Date(bootTime()))}\n`);
  else ctx.stdout.write(` ${uptimeLine()}\n`);
  return 0;
}

/** procps' scale_size(): the shortest of "3.8Gi" / "708Mi" that fits in four characters. */
function human(kb: number): string {
  const bytes = kb * 1024;
  if (bytes < 1024) return `${bytes}B`;
  for (const [i, u] of [...'KMGTP'].entries()) {
    const v = bytes / 1024 ** (i + 1);
    for (const s of [`${v.toFixed(1)}${u}`, `${Math.floor(v)}${u}`]) if (s.length <= 4) return `${s}i`;
  }
  return `${bytes}B`;
}

function free(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, {
    flags: 'bkmghtwl',
    long: { bytes: 'b', kibi: 'k', mebi: 'm', gibi: 'g', human: 'h', total: 't', wide: 'w' },
  });
  const unit = (kb: number) =>
    opts.h ? human(kb) : opts.b ? String(kb * 1024) : opts.m ? String(Math.floor(kb / 1024)) : opts.g ? String(Math.floor(kb / 1048576)) : String(kb);
  const row = (label: string, cells: number[]) => `${label.padEnd(8)}${cells.map((c) => ` ${unit(c).padStart(11)}`).join('')}\n`;
  const m = memoryUsage();
  ctx.stdout.write(`${' '.repeat(8)}${['total', 'used', 'free', 'shared', 'buff/cache', 'available'].map((h) => h.padStart(12)).join('')}\n`);
  ctx.stdout.write(row('Mem:', [m.total, m.used, m.free, m.shared, m.buffCache, m.available]));
  ctx.stdout.write(row('Swap:', [0, 0, 0]));
  if (opts.t) ctx.stdout.write(row('Total:', [m.total, m.used, m.free]));
  return 0;
}

function w(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, { flags: 'hsfiuo', long: { 'no-header': 'h', short: 's' } });
  const line = (cells: string[]) => `${cells[0].padEnd(8)} ${cells[1].padEnd(8)} ${cells[2].padEnd(16)} ${cells[3].padEnd(7)} ${cells.slice(4, 7).map((c) => c.padStart(6)).join(' ')}  ${cells[7]}\n`;
  if (!opts.h) {
    ctx.stdout.write(` ${uptimeLine()}\n`);
    ctx.stdout.write(line(['USER', 'TTY', 'FROM', 'LOGIN@', 'IDLE', 'JCPU', 'PCPU', 'WHAT']));
  }
  ctx.stdout.write(line([loginUser(ctx.shell).name, 'pts/0', FROM, strftime('%H:%M', new Date(loginTime(ctx))), '0.00s', '0.02s', '0.00s', ['w', ...ctx.args].join(' ')]));
  return 0;
}

function who(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'bqHmras', long: { boot: 'b', count: 'q', heading: 'H', runlevel: 'r', all: 'a' } });
  const user = loginUser(ctx.shell).name;
  if (opts.q) return (ctx.stdout.write(`${user}\n# users=1\n`), 0);
  const stamp = (t: number) => strftime('%Y-%m-%d %H:%M', new Date(t));
  if (opts.H) ctx.stdout.write(`${'NAME'.padEnd(8)} ${'LINE'.padEnd(12)} ${'TIME'.padEnd(16)} COMMENT\n`);
  if (opts.b || opts.a) ctx.stdout.write(`${''.padEnd(8)} ${'system boot'.padEnd(12)} ${stamp(bootTime())}\n`);
  if (opts.r || opts.a) ctx.stdout.write(`${''.padEnd(8)} ${'run-level 5'.padEnd(12)} ${stamp(bootTime())}\n`);
  if (opts.b || opts.r) return 0;
  if (operands.length === 1 || operands.length > 2) return (ctx.stderr.write(`who: extra operand ‘${operands.at(-1)}’\n`), 1);
  ctx.stdout.write(`${user.padEnd(8)} ${'pts/0'.padEnd(12)} ${stamp(loginTime(ctx))} (${FROM})\n`);
  return 0;
}

function last(ctx: Ctx): number {
  const when = (t: number) => strftime('%a %b %e %H:%M', new Date(t));
  ctx.stdout.write(`${loginUser(ctx.shell).name.padEnd(8)} ${'pts/0'.padEnd(12)} ${FROM.padEnd(16)} ${when(loginTime(ctx))}   still logged in\n`);
  ctx.stdout.write(`${'reboot'.padEnd(8)} ${'system boot'.padEnd(12)} ${'6.8.0-45-generic'.padEnd(16)} ${when(bootTime())}   still running\n`);
  ctx.stdout.write(`\nwtmp begins ${strftime('%a %b %e %H:%M:%S %Y', new Date(bootTime()))}\n`);
  return 0;
}

export const sessionCommands: CommandTable = {
  uptime: { fn: command(uptime), desc: 'Show system uptime and load' },
  free: { fn: command(free), desc: 'Report memory and swap usage' },
  w: { fn: command(w), desc: 'List logged-in users and their activity' },
  who: { fn: command(who), desc: 'show who is logged on' },
  users: { fn: (ctx) => (ctx.stdout.write(`${loginUser(ctx.shell).name}\n`), 0), desc: 'list logged-in user names' },
  last: { fn: last, desc: 'list recent logins' },
};
