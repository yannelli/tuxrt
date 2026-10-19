/** Arbitrary-precision decimals for bc: value = v / 10^s, truncated like bc does. */
export interface Num {
  v: bigint;
  s: number;
}

export class BcError extends Error {}

const pow10 = (n: number) => 10n ** BigInt(n);
export const num = (v: bigint | number, s = 0): Num => ({ v: BigInt(v), s });
export const ZERO = num(0);
export const ONE = num(1);

export function rescale(a: Num, s: number): Num {
  return s >= a.s ? { v: a.v * pow10(s - a.s), s } : { v: a.v / pow10(a.s - s), s };
}

export function parseNum(text: string, ibase: number): Num {
  const [int, frac = ''] = text.split('.');
  if (ibase === 10) return { v: BigInt(`${int || '0'}${frac}`), s: frac.length };
  const digit = (c: string) => BigInt(Math.min(parseInt(c, 16), ibase - 1));
  let v = 0n;
  for (const c of int) v = v * BigInt(ibase) + digit(c);
  let f = num(0);
  [...frac].reverse().forEach((c) => (f = div(add(f, num(digit(c))), num(ibase), frac.length)));
  return add(num(v), f);
}

export function add(a: Num, b: Num): Num {
  const s = Math.max(a.s, b.s);
  return { v: rescale(a, s).v + rescale(b, s).v, s };
}

export const neg = (a: Num): Num => ({ v: -a.v, s: a.s });
export const sub = (a: Num, b: Num): Num => add(a, neg(b));
export const cmp = (a: Num, b: Num): number => Math.sign(Number(sub(a, b).v));
export const truthy = (a: Num): boolean => a.v !== 0n;

export function mul(a: Num, b: Num, scale: number): Num {
  return rescale({ v: a.v * b.v, s: a.s + b.s }, Math.min(a.s + b.s, Math.max(scale, a.s, b.s)));
}

export function div(a: Num, b: Num, scale: number): Num {
  if (b.v === 0n) throw new BcError('Divide by zero');
  return { v: (a.v * pow10(scale + b.s)) / (b.v * pow10(a.s)), s: scale };
}

export function mod(a: Num, b: Num, scale: number): Num {
  const q = div(a, b, scale);
  return rescale(sub(a, { v: q.v * b.v, s: q.s + b.s }), Math.max(scale + b.s, a.s));
}

export function power(a: Num, e: Num, scale: number): Num {
  let n = rescale(e, 0).v;
  if (n === 0n) return ONE;
  const negative = n < 0n;
  if (negative) n = -n;
  if (n > 100_000n) throw new BcError('exponent too large in raise');
  const exact = { v: a.v ** n, s: a.s * Number(n) };
  return negative ? div(ONE, exact, scale) : rescale(exact, Math.min(exact.s, Math.max(scale, a.s)));
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function sqrt(a: Num, scale: number): Num {
  if (a.v < 0n) throw new BcError('Square root of a negative number');
  const s = Math.max(scale, a.s);
  return { v: isqrt(a.v * pow10(2 * s - a.s)), s };
}

export function format(a: Num, obase: number): string {
  if (a.v === 0n) return '0';
  const sign = a.v < 0n ? '-' : '';
  const abs = a.v < 0n ? -a.v : a.v;
  let int = abs / pow10(a.s);
  let frac = { v: abs % pow10(a.s), s: a.s };
  const base = BigInt(obase);
  const digit = (d: bigint) => (obase <= 16 ? d.toString(16).toUpperCase() : ` ${String(d).padStart(String(obase - 1).length, '0')}`);
  let out = '';
  do {
    out = digit(int % base) + out;
    int /= base;
  } while (int > 0n);
  if (out === '0') out = '';
  if (a.s) {
    out += '.';
    const digits = obase === 10 ? a.s : Math.ceil((a.s * Math.log(10)) / Math.log(obase));
    for (let i = 0; i < digits; i++) {
      const next = { v: frac.v * base, s: frac.s };
      out += digit(next.v / pow10(frac.s));
      frac = { v: next.v % pow10(frac.s), s: frac.s };
    }
  }
  return sign + out;
}

/** bc's 70-column output lines, continued with a backslash. */
export function wrap(s: string): string {
  const parts = s.match(/.{1,69}/g) ?? [''];
  return parts.join('\\\n');
}
