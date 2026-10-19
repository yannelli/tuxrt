import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs, sleep } from '../util.ts';
import { MONTHS, parseDate, strftime } from './datefmt.ts';
import { parseDuration } from './exec.ts';

const ISO_FORMATS: Record<string, string> = {
  date: '%Y-%m-%d', hours: '%Y-%m-%dT%H%:z', minutes: '%Y-%m-%dT%H:%M%:z', seconds: '%Y-%m-%dT%H:%M:%S%:z', ns: '%Y-%m-%dT%H:%M:%S,%N%:z',
};
const RFC3339: Record<string, string> = { date: '%Y-%m-%d', seconds: '%Y-%m-%d %H:%M:%S%:z', ns: '%Y-%m-%d %H:%M:%S.%N%:z' };
export const DEFAULT_DATE = '%a %b %e %H:%M:%S %Z %Y';

function date(ctx: Ctx): number {
  const args = ctx.args.map((a) => (/^-I/.test(a) ? `--iso-8601${a.length > 2 ? `=${a.slice(2)}` : ''}` : a));
  const { opts, operands } = parseArgs(args, {
    flags: 'uR',
    values: 'drs',
    long: { utc: 'u', universal: 'u', 'date=': 'd', 'reference=': 'r', 'set=': 's', 'iso-8601': 'I', 'rfc-email': 'R', 'rfc-3339=': '3' },
  });
  if (opts.s !== undefined) return fail(ctx, 'cannot set date: Operation not permitted');
  let time = Date.now();
  if (typeof opts.d === 'string') {
    const t = parseDate(opts.d, time);
    if (t === null) return fail(ctx, `invalid date ‘${opts.d}’`);
    time = t;
  } else if (typeof opts.r === 'string') time = ctx.vfs.stat(ctx.shell.abs(opts.r)).mtime;
  const [first, ...extra] = operands;
  if (extra.length) return fail(ctx, `extra operand ‘${extra[0]}’\nTry 'date --help' for more information.`);
  if (first !== undefined && !first.startsWith('+')) return fail(ctx, `invalid date ‘${first}’`);
  let fmt = first?.slice(1) ?? DEFAULT_DATE;
  if (opts.I) fmt = ISO_FORMATS[opts.I === true ? 'date' : opts.I.replace(/^h$/, 'hours')] ?? '';
  else if (opts.R) fmt = '%a, %d %b %Y %H:%M:%S %z';
  else if (typeof opts['3'] === 'string') fmt = RFC3339[opts['3']] ?? '';
  if (!fmt && first === undefined) return fail(ctx, `invalid argument for format\nTry 'date --help' for more information.`);
  ctx.stdout.write(`${strftime(fmt, new Date(time))}\n`);
  return 0;
}

/** One month as 8 rows of 20 columns, ncal's `cal` layout. */
function monthRows(year: number, month: number, title: string, today?: number): string[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const left = Math.floor((20 - title.length) / 2);
  const rows = [`${' '.repeat(left)}${title}`.padEnd(20), 'Su Mo Tu We Th Fr Sa'];
  const cells = [...Array(first).fill('  '), ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2))];
  for (let w = 0; w < 6; w++) {
    const week = cells.slice(w * 7, w * 7 + 7);
    const line = week.join(' ').padEnd(20);
    rows.push(today === undefined ? line : line.replace(new RegExp(`(?<=^| )${String(today).padStart(2)}(?= |$)`), (d) => `\x1b[7m${d}\x1b[27m`));
  }
  return rows;
}

function cal(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'y' });
  const now = new Date();
  const nums = operands.map(Number);
  const bad = operands.find((_, i) => !Number.isInteger(nums[i]) || nums[i] < 1 || nums[i] > 9999);
  if (bad !== undefined) return fail(ctx, `not a valid year ${bad}`);
  if (operands.length === 2 && nums[0] > 12) return fail(ctx, `${operands[0]} is neither a month number (1..12) nor a name`);
  const year = operands.length ? nums.at(-1)! : now.getUTCFullYear();
  const highlight = (y: number, m: number) =>
    ctx.stdout.isTTY && y === now.getUTCFullYear() && m === now.getUTCMonth() ? now.getUTCDate() : undefined;
  if (operands.length === 1 || opts.y) {
    ctx.stdout.write(`${String(year).padStart(32)}\n`);
    for (let q = 0; q < 12; q += 3) {
      const months = [q, q + 1, q + 2].map((m) => monthRows(year, m, MONTHS[m], highlight(year, m)));
      for (let r = 0; r < 8; r++) ctx.stdout.write(`${months.map((rows) => `${rows[r]}  `).join('')}\n`);
    }
    return 0;
  }
  const month = operands.length === 2 ? nums[0] - 1 : now.getUTCMonth();
  for (const row of monthRows(year, month, `${MONTHS[month]} ${year}`, highlight(year, month))) ctx.stdout.write(`${row}  \n`);
  return 0;
}

async function sleepCmd(ctx: Ctx): Promise<number> {
  if (!ctx.args.length) return fail(ctx, "missing operand\nTry 'sleep --help' for more information.");
  let total = 0;
  for (const a of ctx.args) {
    const s = parseDuration(a);
    if (s === null) return fail(ctx, `invalid time interval ‘${a}’\nTry 'sleep --help' for more information.`);
    total += s;
  }
  for (let left = total * 1000; left > 0 && !ctx.signal.aborted; left -= 2 ** 31 - 1) {
    await sleep(Math.min(left, 2 ** 31 - 1), ctx.signal);
  }
  return ctx.signal.aborted ? 128 + (Number(ctx.signal.reason) || 2) : 0;
}

function timedatectl(ctx: Ctx): number {
  const sub = ctx.args[0] ?? 'status';
  if (sub === 'show') {
    ctx.stdout.write(`Timezone=Etc/UTC\nLocalRTC=no\nCanNTP=yes\nNTP=yes\nNTPSynchronized=yes\nTimeUSec=${strftime('%a %Y-%m-%d %H:%M:%S %Z', new Date())}\n`);
    return 0;
  }
  if (sub !== 'status') {
    if (ctx.shell.user.uid !== 0) return fail(ctx, 'Failed to set time zone: Access denied');
    return 0;
  }
  const now = new Date();
  ctx.stdout.write([
    `               Local time: ${strftime('%a %Y-%m-%d %H:%M:%S %Z', now)}`,
    `           Universal time: ${strftime('%a %Y-%m-%d %H:%M:%S %Z', now)}`,
    `                 RTC time: ${strftime('%a %Y-%m-%d %H:%M:%S', now)}`,
    '                Time zone: Etc/UTC (UTC, +0000)',
    'System clock synchronized: yes',
    '              NTP service: active',
    '          RTC in local TZ: no',
    '',
  ].join('\n'));
  return 0;
}

export const timeCommands: CommandTable = {
  date: { fn: command(date), desc: 'print or set the system date and time' },
  cal: { fn: command(cal), desc: 'display a calendar' },
  sleep: { fn: sleepCmd, desc: 'delay for a specified amount of time' },
  timedatectl: { fn: timedatectl, desc: 'Control the system time and date' },
};
