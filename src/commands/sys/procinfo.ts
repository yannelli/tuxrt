import { parseSignal, SIGNALS, type Proc } from '../../shell/process.ts';
import { machine } from '../../vfs/machine.ts';
import { userName } from '../../vfs/users.ts';
import type { Ctx } from '../types.ts';
import { strftime } from './datefmt.ts';
import { bootTime } from './session.ts';

export const SIGNAL_NAMES: Record<number, string> = Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [v, k]));

export { parseSignal };

/** The kernel's comm: executable basename, at most 15 characters. */
export function comm(p: Proc): string {
  if (p.pid === 1) return 'systemd';
  const first = p.cmd.replace(/^\[|\]$/g, '').split(/[\s:]/)[0];
  return first.slice(first.lastIndexOf('/') + 1).replace(/^-/, '').slice(0, 15);
}

/** The process running this very command (dispatch registers it just before calling us). */
export function selfPid(ctx: Ctx): number {
  const cmd = [ctx.name, ...ctx.args].join(' ');
  return Math.max(-1, ...[...ctx.shell.kernel.procs.procs.values()].filter((p) => p.cmd === cmd).map((p) => p.pid));
}

export function procList(ctx: Ctx): Proc[] {
  return [...ctx.shell.kernel.procs.procs.values()].sort((a, b) => a.pid - b.pid);
}

export function canSignal(ctx: Ctx, p: Proc): boolean {
  return ctx.shell.user.uid === 0 || p.uid === ctx.shell.user.uid;
}

const MEM: Record<string, [number, number]> = {
  systemd: [167744, 13180], kthreadd: [0, 0], 'systemd-journal': [47784, 15488], 'systemd-udevd': [25424, 6528],
  'systemd-network': [91032, 8320], 'systemd-resolve': [21744, 12800], cron: [7196, 2688], rsyslogd: [222508, 5120],
  sshd: [12020, 7808], bash: [8784, 5248],
};

/** Fake but stable VSZ and RSS in KiB. */
export function memory(p: Proc): [number, number] {
  return MEM[comm(p)] ?? [7000 + ((p.pid * 37) % 9000), 2000 + ((p.pid * 13) % 3000)];
}

export function memPercent(p: Proc): string {
  return ((memory(p)[1] / machine.memKb) * 100).toFixed(1);
}

export function owner(ctx: Ctx, p: Proc, width = 8): string {
  const name = userName(ctx.vfs, p.uid);
  return name.length > width ? `${name.slice(0, width - 1)}+` : name;
}

export function started(p: Proc): number {
  return p.tty === '?' ? bootTime() : p.start;
}

export function startStamp(p: Proc): string {
  const t = new Date(started(p));
  return strftime(t.toDateString() === new Date().toDateString() ? '%H:%M' : '%b%d', t);
}

export function stat(ctx: Ctx, p: Proc, self: number): string {
  if (p.pid === self) return 'R+';
  if (p.tty === '?') return p.cmd.startsWith('[') ? 'S' : 'Ss';
  if (p.cmd.startsWith('-')) return 'Ss';
  return [...ctx.shell.kernel.jobs.values()].some((j) => j.controller === p.job) ? 'S' : 'S+';
}

export function elapsed(p: Proc): string {
  const s = Math.floor((Date.now() - started(p)) / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const days = Math.floor(s / 86400);
  const hms = `${s >= 3600 ? `${two(Math.floor((s % 86400) / 3600))}:` : ''}${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return days ? `${days}-${hms}` : hms;
}

export interface Matcher {
  pattern: string;
  full?: boolean;
  exact?: boolean;
  ignoreCase?: boolean;
  user?: string;
}

/** pgrep/pkill selection: ERE against comm (or the full command line), never ourselves. */
export function matchProcs(ctx: Ctx, m: Matcher): Proc[] {
  const re = new RegExp(m.exact ? `^(?:${m.pattern})$` : m.pattern, m.ignoreCase ? 'i' : '');
  const self = selfPid(ctx);
  return procList(ctx).filter(
    (p) => p.pid !== self && re.test(m.full ? p.cmd : comm(p)) && (m.user === undefined || userName(ctx.vfs, p.uid) === m.user || String(p.uid) === m.user),
  );
}
