export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DAY = 86_400_000;
const ALIASES: Record<string, string> = {
  F: '%Y-%m-%d', T: '%H:%M:%S', D: '%m/%d/%y', R: '%H:%M', r: '%I:%M:%S %p', c: '%a %b %e %H:%M:%S %Y', x: '%m/%d/%y', X: '%H:%M:%S',
};

function isoWeek(d: Date): { week: number; year: number } {
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY);
  const year = thursday.getUTCFullYear();
  return { week: Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1, year };
}

/** Value, default pad char ('' = none, for text) and default width of a conversion. */
function field(c: string, d: Date): [string | number, string, number] | null {
  const hour = d.getUTCHours();
  const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY);
  const wday = d.getUTCDay();
  switch (c) {
    case 'Y': return [d.getUTCFullYear(), '0', 1];
    case 'C': return [Math.floor(d.getUTCFullYear() / 100), '0', 2];
    case 'y': return [d.getUTCFullYear() % 100, '0', 2];
    case 'm': return [d.getUTCMonth() + 1, '0', 2];
    case 'd': return [d.getUTCDate(), '0', 2];
    case 'e': return [d.getUTCDate(), ' ', 2];
    case 'H': return [hour, '0', 2];
    case 'k': return [hour, ' ', 2];
    case 'I': return [hour % 12 || 12, '0', 2];
    case 'l': return [hour % 12 || 12, ' ', 2];
    case 'M': return [d.getUTCMinutes(), '0', 2];
    case 'S': return [d.getUTCSeconds(), '0', 2];
    case 'N': return [d.getUTCMilliseconds() * 1_000_000, '0', 9];
    case 's': return [Math.floor(d.getTime() / 1000), '0', 1];
    case 'j': return [doy + 1, '0', 3];
    case 'u': return [wday || 7, '0', 1];
    case 'w': return [wday, '0', 1];
    case 'U': return [Math.floor((doy + 7 - wday) / 7), '0', 2];
    case 'W': return [Math.floor((doy + 7 - ((wday + 6) % 7)) / 7), '0', 2];
    case 'V': return [isoWeek(d).week, '0', 2];
    case 'G': return [isoWeek(d).year, '0', 1];
    case 'g': return [isoWeek(d).year % 100, '0', 2];
    case 'a': return [DAYS[wday].slice(0, 3), '', 0];
    case 'A': return [DAYS[wday], '', 0];
    case 'b': case 'h': return [MONTHS[d.getUTCMonth()].slice(0, 3), '', 0];
    case 'B': return [MONTHS[d.getUTCMonth()], '', 0];
    case 'p': return [hour < 12 ? 'AM' : 'PM', '', 0];
    case 'P': return [hour < 12 ? 'am' : 'pm', '', 0];
    case 'Z': return ['UTC', '', 0];
    case 'z': return ['+0000', '', 0];
    case ':z': return ['+00:00', '', 0];
    case '::z': return ['+00:00:00', '', 0];
    case 'n': return ['\n', '', 0];
    case 't': return ['\t', '', 0];
    case '%': return ['%', '', 0];
    default: return c in ALIASES ? [strftime(ALIASES[c], d), '', 0] : null;
  }
}

/** GNU date(1) formatting in UTC, including the `-`, `_`, `0` and `^` flags and field widths. */
export function strftime(fmt: string, d: Date): string {
  return fmt.replace(/%([-_0^#]?)(\d*)(:{0,2}z|[a-zA-Z%])/g, (all, flag: string, width: string, c: string) => {
    const f = field(c, d);
    if (!f) return all;
    const [value, defPad, defWidth] = f;
    let s = String(value);
    if (c === 'N') return s.padStart(9, '0').slice(0, Number(width) || 9);
    if (flag === '^' || flag === '#') s = s.toUpperCase();
    if (flag === '-') return s;
    const w = width ? Number(width) : defWidth;
    const pad = flag === '_' ? ' ' : flag === '0' ? '0' : defPad || (typeof value === 'number' ? '0' : ' ');
    return s.padStart(w, pad);
  });
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ]+(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(z|utc|[+-]\d{2}:?\d{2})?(?![\d:])/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/;
const RELATIVE = /^(?:([+-]?\s*\d+)\s*|(next|last|this)\s+)?(sec|second|min|minute|hour|day|week|fortnight|month|year)s?\b(\s+ago\b)?/;
const UNIT_MS: Record<string, number> = { sec: 1e3, second: 1e3, min: 6e4, minute: 6e4, hour: 36e5, day: DAY, week: 7 * DAY, fortnight: 14 * DAY };

function shift(t: number, unit: string, n: number): number {
  if (unit in UNIT_MS) return t + n * UNIT_MS[unit];
  const d = new Date(t);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.getTime();
}

function isoTime(m: RegExpExecArray): number {
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0', tz = 'z'] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + Math.round(Number(frac) * 1000);
  const off = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  return off ? t - (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +off[3]) * 60_000 : t;
}

/** Parses the subset of date(1) -d strings people use: ISO, @epoch, clock times and relative items. */
export function parseDate(input: string, now: number): number | null {
  const s = input.trim().toLowerCase();
  if (/^@-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s.slice(1)) * 1000);
  let t = now;
  let rest = s;
  let m = ISO.exec(rest);
  if (m) t = isoTime(m);
  else if ((m = CLOCK.exec(rest))) t = Math.floor(now / DAY) * DAY + (+m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0)) * 1000;
  if (m) rest = rest.slice(m[0].length);
  for (rest = rest.trim(); rest; rest = rest.trim()) {
    if ((m = /^(now|today)\b/.exec(rest))) t += 0;
    else if ((m = /^yesterday\b/.exec(rest))) t -= DAY;
    else if ((m = /^tomorrow\b/.exec(rest))) t += DAY;
    else if ((m = RELATIVE.exec(rest))) {
      const n = m[2] ? { next: 1, last: -1, this: 0 }[m[2]]! : Number((m[1] ?? '1').replace(/\s/g, ''));
      t = shift(t, m[3], m[4] ? -n : n);
    } else {
      if (rest !== s) return null;
      const parsed = Date.parse(/\b(utc|gmt)\b|[+-]\d{2}:?\d{2}$|z$/i.test(input) ? input : `${input} UTC`);
      return Number.isNaN(parsed) ? null : parsed;
    }
    rest = rest.slice(m[0].length);
  }
  return t;
}
