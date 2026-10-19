import { fn } from './define.ts';
import { describe } from './dump.ts';
import { isNum, JqError, num, type Value } from './value.ts';

function n(v: Value): number {
  if (!isNum(v)) throw new JqError(`${describe(v)} number required`);
  return num(v);
}

function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = g[0];
  const t = x + 6.5;
  for (let i = 1; i < 9; i++) a += g[i] / (x - 1 + i);
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(a);
}

const frexp = (x: number): [number, number] => {
  if (x === 0 || !Number.isFinite(x)) return [x, 0];
  const e = Math.floor(Math.log2(Math.abs(x))) + 1;
  return [x / 2 ** e, e];
};

const unary: Record<string, (x: number) => Value> = {
  floor: Math.floor, ceil: Math.ceil, round: (x) => Math.sign(x) * Math.round(Math.abs(x)), sqrt: Math.sqrt, fabs: Math.abs,
  trunc: Math.trunc, rint: (x) => x - Math.floor(x) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x), nearbyint: (x) => unary.rint(x),
  exp: Math.exp, exp2: (x) => 2 ** x, exp10: (x) => 10 ** x, expm1: Math.expm1, log: Math.log, log2: Math.log2,
  log10: Math.log10, log1p: Math.log1p, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh,
  atanh: Math.atanh, cbrt: Math.cbrt, significand: (x) => frexp(x)[0] * 2, logb: (x) => frexp(x)[1] - 1,
  gamma: lgamma, lgamma, tgamma: (x) => Math.exp(lgamma(x)) * (x < 0 && Math.floor(-x) % 2 === 0 ? -1 : 1),
  lgamma_r: (x) => [lgamma(x), 1], frexp: (x) => frexp(x), modf: (x) => [x - Math.trunc(x), Math.trunc(x)],
};
const binary: Record<string, (x: number, y: number) => number> = {
  pow: (x, y) => x ** y, atan2: Math.atan2, fmin: Math.min, fmax: Math.max, fmod: (x, y) => x % y,
  ldexp: (x, y) => x * 2 ** y, scalb: (x, y) => x * 2 ** y, scalbln: (x, y) => x * 2 ** y,
  copysign: (x, y) => Math.abs(x) * (y < 0 || Object.is(y, -0) ? -1 : 1), hypot: Math.hypot, drem: (x, y) => x - y * Math.round(x / y),
  nexttoward: (x) => x, nextafter: (x) => x,
};

for (const [name, f] of Object.entries(unary)) fn(name, 0, (v) => f(n(v)));
for (const [name, f] of Object.entries(binary)) fn(name, 2, (_v, a, b) => f(n(a), n(b)));
fn('fma', 3, (_v, a, b, c) => n(a) * n(b) + n(c));
fn('infinite', 0, () => Infinity);
fn('nan', 0, () => NaN);
fn('isinfinite', 0, (v) => Math.abs(n(v)) === Infinity);
fn('isnan', 0, (v) => Number.isNaN(n(v)));
fn('isnormal', 0, (v) => {
  const x = Math.abs(n(v));
  return Number.isFinite(x) && x >= 2.2250738585072014e-308;
});
