import { BcError, isqrt, rescale, type Num } from './bcnum.ts';

// Fixed-point arithmetic on bigints scaled by 10^w, with w well above the user's scale.
const unit = (w: number) => 10n ** BigInt(w);
const fmul = (x: bigint, y: bigint, w: number) => (x * y) / unit(w);
const fdiv = (x: bigint, y: bigint, w: number) => (x * unit(w)) / y;
const fsqrt = (x: bigint, w: number) => isqrt(x * unit(w));

function exp(x: bigint, w: number): bigint {
  if (x < 0n) return fdiv(unit(w), exp(-x, w), w);
  let halvings = 0;
  for (; x > unit(w); halvings++) x /= 2n;
  let sum = unit(w);
  let term = unit(w);
  for (let n = 1n; term !== 0n; n++) {
    term = fmul(term, x, w) / n;
    sum += term;
  }
  for (; halvings > 0; halvings--) sum = fmul(sum, sum, w);
  return sum;
}

/** ln x = 2 atanh((x-1)/(x+1)), after square roots bring x close to 1. */
function ln(x: bigint, w: number): bigint {
  if (x <= 0n) throw new BcError('logarithm of a non-positive number');
  let roots = 0;
  for (; x > 2n * unit(w) || x < unit(w) / 2n; roots++) x = fsqrt(x, w);
  const u = fdiv(x - unit(w), x + unit(w), w);
  const u2 = fmul(u, u, w);
  let sum = 0n;
  for (let n = 1n, term = u; term !== 0n; n += 2n, term = fmul(term, u2, w)) sum += term / n;
  return (2n * sum) << BigInt(roots);
}

/** atan x = 2 atan(x / (1 + sqrt(1 + x^2))), halved until the series converges fast. */
function atan(x: bigint, w: number): bigint {
  if (x < 0n) return -atan(-x, w);
  let halvings = 0;
  for (; x > unit(w) / 5n; halvings++) x = fdiv(x, unit(w) + fsqrt(unit(w) + fmul(x, x, w), w), w);
  const x2 = fmul(x, x, w);
  let sum = 0n;
  for (let n = 1n, term = x, sign = 1n; term !== 0n; n += 2n, term = fmul(term, x2, w), sign = -sign) sum += (sign * term) / n;
  return sum << BigInt(halvings);
}

function sin(x: bigint, w: number): bigint {
  const pi = 4n * atan(unit(w), w);
  x %= 2n * pi;
  if (x > pi) x -= 2n * pi;
  if (x < -pi) x += 2n * pi;
  const x2 = fmul(x, x, w);
  let sum = 0n;
  for (let n = 1n, term = x; term !== 0n; n += 2n) {
    sum += term;
    term = -fmul(term, x2, w) / ((n + 1n) * (n + 2n));
  }
  return sum;
}

/** The -l math library: s, c, a, l, e. Results are truncated to `scale` digits like bc's. */
export function mathLib(name: string, x: Num, scale: number): Num {
  const magnitude = Math.abs(Number(rescale(x, 0).v));
  const w = scale + 20 + (name === 'e' ? Math.ceil(magnitude * 0.435) : String(Math.floor(magnitude)).length);
  const X = rescale(x, w).v;
  const fns: Record<string, (v: bigint) => bigint> = {
    s: (v) => sin(v, w),
    c: (v) => sin(v + 2n * atan(unit(w), w), w),
    a: (v) => atan(v, w),
    l: (v) => ln(v, w),
    e: (v) => exp(v, w),
  };
  return rescale({ v: fns[name](X), s: w }, scale);
}

export const MATH_FUNCTIONS = new Set(['s', 'c', 'a', 'l', 'e']);
