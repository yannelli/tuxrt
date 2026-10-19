import { FsError, errMessage } from '../../vfs/errors.ts';
import type { Stat } from '../../vfs/types.ts';
import type { VFS } from '../../vfs/vfs.ts';
import type { Ctx } from '../types.ts';

/** Character devices created by mountDev, with their Linux major/minor numbers. */
export const DEVICES: Record<string, [number, number]> = {
  '/dev/null': [1, 3], '/dev/zero': [1, 5], '/dev/random': [1, 8], '/dev/urandom': [1, 9], '/dev/tty': [5, 0],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIX_MONTHS = 31_556_952_000 / 2;
const UNITS = 'KMGTPE';

/** Quotes a name for diagnostics the way coreutils does in the C.UTF-8 locale. */
export function q(name: string): string {
  return name.includes("'") ? `"${name}"` : `'${name}'`;
}

export function msgOf(e: unknown): string {
  return e instanceof FsError ? e.message : errMessage(e);
}

export function err(ctx: Ctx, msg: string, status = 1): number {
  ctx.stderr.write(`${ctx.name}: ${msg}\n`);
  return status;
}

/** "rm: missing operand" plus the usual hint, exiting 1 like most coreutils. */
export function usage(ctx: Ctx, msg: string): number {
  return err(ctx, `${msg}\nTry '${ctx.name} --help' for more information.`);
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

export function tryStat(vfs: VFS, path: string, follow = true): Stat | null {
  try {
    return vfs.stat(path, follow);
  } catch {
    return null;
  }
}

/** Disk usage in KiB as ext4 would allocate it: 4K blocks, fast symlinks take none. */
export function blocksKb(st: Stat): number {
  if (st.kind === 'dir') return 4;
  if (st.kind === 'symlink') return 0;
  return Math.ceil(st.size / 4096) * 4;
}

/** GNU -h formatting: powers of 1024, rounded up, one decimal below 10 ("4.0K", "12K"). */
export function human(bytes: number): string {
  let n = bytes;
  let i = -1;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  if (i < 0) return String(Math.ceil(bytes));
  if (n < 10) {
    const tenths = Math.ceil(n * 10) / 10;
    if (tenths < 10) return `${tenths.toFixed(1)}${UNITS[i]}`;
    n = tenths;
  }
  const whole = Math.ceil(n);
  if (whole >= 1024 && i < UNITS.length - 1) return `1.0${UNITS[i + 1]}`;
  return `${whole}${UNITS[i]}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ls -l timestamp: "Oct 19 10:03", or "Oct 19  2025" outside the last six months. */
export function lsDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const head = `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)}`;
  const recent = ms > now - SIX_MONTHS && ms <= now;
  return recent ? `${head} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : `${head}  ${d.getUTCFullYear()}`;
}

/** stat-style timestamp: "2026-10-19 10:03:12.123000000 +0000" (the machine runs in UTC). */
export function fullTime(ms: number): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return `${date} ${time}.${String(d.getUTCMilliseconds()).padStart(3, '0')}000000 +0000`;
}

/** Parses touch -d style dates: "@epoch", ISO dates (as UTC), "N units ago", or anything Date.parse accepts. */
export function parseDate(spec: string, now = Date.now()): number | null {
  const s = spec.trim().toLowerCase();
  if (/^@-?\d+(\.\d+)?$/.test(s)) return Number(s.slice(1)) * 1000;
  if (s === 'now' || s === 'today') return now;
  if (s === 'yesterday') return now - 86_400_000;
  if (s === 'tomorrow') return now + 86_400_000;
  const rel = /^(\d+)\s*(sec|second|min|minute|hour|day|week|month|year)s?\s+ago$/.exec(s);
  if (rel) {
    const unit: Record<string, number> = { sec: 1, second: 1, min: 60, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2_629_746, year: 31_556_952 };
    return now - Number(rel[1]) * unit[rel[2]] * 1000;
  }
  const iso = /^\d{4}-\d{2}-\d{2}([ t]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s);
  const t = Date.parse(iso ? `${spec.trim().replace(' ', 'T')}${s.length === 10 ? 'T00:00' : ''}Z` : spec);
  return Number.isNaN(t) ? null : t;
}
