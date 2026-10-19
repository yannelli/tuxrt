import { float, integer, pad, type Piece } from '../cformat.ts';
import { StrNum, toNum, UNINIT, type Val } from './value.ts';

const SPEC = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(?:hh|h|ll|l|L|q|j|z|t)?([diouxXeEfFgGcs%])/y;
const MAX_INT = 2 ** 63;

export function numToStr(n: number, fmt: string): string {
  if (Number.isInteger(n) && Math.abs(n) < MAX_INT) return Math.abs(n) < 1e16 ? String(n) : BigInt(n).toString();
  return sprintf(fmt, [n], fmt);
}

export function toStr(v: Val, convfmt: string): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? numToStr(v, convfmt) : v.s;
}

export function sprintf(fmt: string, args: Val[], convfmt: string): string {
  let out = '';
  let ai = 0;
  const next = (): Val => (ai < args.length ? args[ai++] : UNINIT);
  let i = 0;
  while (i < fmt.length) {
    const pct = fmt.indexOf('%', i);
    if (pct === -1) {
      out += fmt.slice(i);
      break;
    }
    out += fmt.slice(i, pct);
    SPEC.lastIndex = pct;
    const m = SPEC.exec(fmt);
    if (!m) {
      out += '%';
      i = pct + 1;
      continue;
    }
    i = SPEC.lastIndex;
    const [, flags, w, p, conv] = m;
    if (conv === '%') {
      out += '%';
      continue;
    }
    let width = w === '*' ? Math.trunc(toNum(next())) : Number(w ?? 0);
    let left = flags.includes('-');
    if (width < 0) {
      left = true;
      width = -width;
    }
    const rawPrec = p === '*' ? Math.trunc(toNum(next())) : p === undefined ? undefined : Number(p || 0);
    const prec = rawPrec !== undefined && rawPrec < 0 ? undefined : rawPrec;
    const piece = convert(conv, flags, prec, next(), convfmt);
    out += pad(piece, width, left, flags.includes('0'));
  }
  return out;
}

function convert(conv: string, flags: string, prec: number | undefined, v: Val, convfmt: string): Piece {
  switch (conv) {
    case 's': {
      const s = toStr(v, convfmt);
      return { pre: '', body: prec === undefined ? s : s.slice(0, prec), zeroOk: false };
    }
    case 'c': {
      const n = toNum(v);
      const numeric = typeof v === 'number' || (v instanceof StrNum && v !== UNINIT);
      const body = numeric ? (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(Math.trunc(n)) : '') : toStr(v, convfmt).slice(0, 1);
      return { pre: '', body, zeroOk: false };
    }
    case 'd':
    case 'i':
    case 'o':
    case 'x':
    case 'X':
    case 'u':
      return integer(conv, flags, prec, toNum(v));
    default:
      return float(conv, flags, prec, toNum(v));
  }
}

