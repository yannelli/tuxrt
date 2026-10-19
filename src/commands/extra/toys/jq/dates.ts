import { strftime } from '../../../sys/datefmt.ts';
import { fn } from './define.ts';
import { isNum, JqError, num, type Value } from './value.ts';

const DAY = 86_400_000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** jq's "broken down time": [year, month0, mday, hours, minutes, seconds, wday, yday]. */
function brokenDown(ms: number): Value[] {
  const d = new Date(ms);
  const yday = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY);
  const secs = d.getUTCSeconds() + (ms / 1000 - Math.floor(ms / 1000));
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), secs, d.getUTCDay(), yday];
}

function toMs(v: Value, name: string): number {
  if (isNum(v)) return num(v) * 1000;
  if (!Array.isArray(v) || v.length < 6 || !v.slice(0, 6).every(isNum)) throw new JqError(`${name} requires parsed datetime inputs`);
  const [y, mo, d, h, mi, s] = v.slice(0, 6).map((x) => num(x));
  return Date.UTC(y, mo, d, h, mi, Math.floor(s));
}

const FIELDS: Record<string, string> = {
  Y: '([+-]?\\d{1,4})', m: '(\\d{1,2})', d: '(\\d{1,2})', e: '\\s*(\\d{1,2})', H: '(\\d{1,2})', M: '(\\d{1,2})',
  S: '(\\d{1,2})', y: '(\\d{2})', j: '(\\d{1,3})', b: '([A-Za-z]{3,})', B: '([A-Za-z]{3,})', h: '([A-Za-z]{3,})',
  a: '([A-Za-z]{3,})', A: '([A-Za-z]{3,})', z: '([+-]\\d{2}:?\\d{2}|Z)', Z: '([A-Za-z]+)', s: '(-?\\d+)', p: '([AaPp][Mm])',
};
const ALIASES: Record<string, string> = { T: '%H:%M:%S', D: '%m/%d/%y', F: '%Y-%m-%d', R: '%H:%M', c: '%a %b %e %H:%M:%S %Y' };

function strptime(s: string, fmt: string): Value[] {
  const spec = fmt.replace(/%([TDFRc])/g, (_, c: string) => ALIASES[c]);
  const order: string[] = [];
  const src = spec.replace(/%(.)|([.*+?^${}()|[\]\\])|(\s+)/g, (_all, c: string, esc: string, ws: string) => {
    if (ws) return '\\s*';
    if (esc) return `\\${esc}`;
    if (c === '%') return '%';
    if (c === 'n' || c === 't') return '\\s*';
    if (!FIELDS[c]) throw new JqError(`strptime/1: unsupported format %${c}`);
    order.push(c);
    return FIELDS[c];
  });
  const m = new RegExp(`^\\s*${src}$`).exec(s);
  if (!m) throw new JqError(`date "${s}" does not match format "${fmt}"`);
  const t = { Y: 1900, m: 1, d: 1, H: 0, M: 0, S: 0, off: 0, pm: -1, epoch: NaN };
  order.forEach((c, i) => {
    const x = m[i + 1];
    if (c === 'Y') t.Y = Number(x);
    else if (c === 'y') t.Y = Number(x) + (Number(x) < 69 ? 2000 : 1900);
    else if (c === 'm') t.m = Number(x);
    else if (c === 'd' || c === 'e') t.d = Number(x);
    else if (c === 'H') t.H = Number(x);
    else if (c === 'M') t.M = Number(x);
    else if (c === 'S') t.S = Number(x);
    else if (c === 's') t.epoch = Number(x);
    else if (c === 'p') t.pm = /p/i.test(x) ? 1 : 0;
    else if ('bBh'.includes(c)) t.m = MONTHS.indexOf(x.slice(0, 3).toLowerCase()) + 1;
    else if (c === 'z' && x !== 'Z') t.off = (x[0] === '-' ? -1 : 1) * (Number(x.slice(1, 3)) * 60 + Number(x.slice(-2)));
    else if ('aA'.includes(c) && !DAYS.includes(x.slice(0, 3).toLowerCase())) throw new JqError(`date "${s}" does not match format "${fmt}"`);
  });
  if (t.pm >= 0) t.H = (t.H % 12) + 12 * t.pm;
  const ms = Number.isNaN(t.epoch) ? Date.UTC(t.Y, t.m - 1, t.d, t.H, t.M, t.S) - t.off * 60_000 : t.epoch * 1000;
  return brokenDown(ms);
}

fn('mktime', 0, (v) => {
  if (!Array.isArray(v)) throw new JqError('mktime requires array of 6 numbers');
  return Math.floor(toMs(v, 'mktime') / 1000);
});
fn('gmtime', 0, (v) => {
  if (!isNum(v)) throw new JqError('gmtime() requires a number');
  return brokenDown(num(v) * 1000);
});
fn('localtime', 0, (v) => {
  if (!isNum(v)) throw new JqError('localtime() requires a number');
  return brokenDown(num(v) * 1000);
});
for (const name of ['strftime', 'strflocaltime']) {
  fn(name, 1, (v, f) => {
    if (typeof f !== 'string') throw new JqError(`${name}/1 requires a string format`);
    return strftime(f, new Date(toMs(v, `${name}/1`)));
  });
}
fn('strptime', 1, (v, f) => {
  if (typeof v !== 'string' || typeof f !== 'string') throw new JqError('strptime/1 requires string inputs and arguments');
  return strptime(v, f);
});
