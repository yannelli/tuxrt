import { describe } from './dump.ts';
import { codepoints } from './paths.ts';
import { compare, equal, isNum, isObj, JqError, num, type Obj, type Value } from './value.ts';

const fail = (a: Value, b: Value, what: string): never => {
  throw new JqError(`${describe(a)} and ${describe(b)} ${what}`);
};

export function splitStr(s: string, sep: string): string[] {
  if (s === '') return [];
  return sep === '' ? codepoints(s) : s.split(sep);
}

function deepMerge(a: Obj, b: Obj): Obj {
  const m = new Map(a);
  for (const [k, bv] of b) {
    const av = m.get(k);
    m.set(k, isObj(av ?? null) && isObj(bv) ? deepMerge(av as Obj, bv) : bv);
  }
  return m;
}

/** jq 1.7 string repetition: n <= 0 gives null, fractional counts round down but never below one copy. */
function repeat(s: string, n: number): Value {
  if (!(n > 0)) return null;
  return s.repeat(Math.max(1, Math.trunc(n - 1) + 1));
}

export function add(a: Value, b: Value): Value {
  if (a === null) return b;
  if (b === null) return a;
  if (isNum(a) && isNum(b)) return num(a) + num(b);
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
  if (isObj(a) && isObj(b)) {
    const m = new Map(a);
    for (const [k, v] of b) m.set(k, v);
    return m;
  }
  return fail(a, b, 'cannot be added');
}

function arith(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '+':
      return add(a, b);
    case '-':
      if (isNum(a) && isNum(b)) return num(a) - num(b);
      if (Array.isArray(a) && Array.isArray(b)) return a.filter((x) => !b.some((y) => equal(x, y)));
      return fail(a, b, 'cannot be subtracted');
    case '*':
      if (isNum(a) && isNum(b)) return num(a) * num(b);
      if (typeof a === 'string' && isNum(b)) return repeat(a, num(b));
      if (isNum(a) && typeof b === 'string') return repeat(b, num(a));
      if (isObj(a) && isObj(b)) return deepMerge(a, b);
      return fail(a, b, 'cannot be multiplied');
    case '/':
      if (isNum(a) && isNum(b)) {
        if (num(b) === 0) fail(a, b, 'cannot be divided because the divisor is zero');
        return num(a) / num(b);
      }
      if (typeof a === 'string' && typeof b === 'string') return splitStr(a, b);
      return fail(a, b, 'cannot be divided');
    case '%': {
      if (!isNum(a) || !isNum(b)) return fail(a, b, 'cannot be divided');
      const x = num(a);
      const y = num(b);
      if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
      if (Math.trunc(y) === 0) fail(a, b, 'cannot be divided because the divisor is zero');
      const r = Math.trunc(x) % Math.trunc(y);
      return r === 0 ? 0 : r;
    }
  }
  throw new JqError(`unknown operator ${op}`);
}

export function binop(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '==': return equal(a, b);
    case '!=': return !equal(a, b);
    case '<': return compare(a, b) < 0;
    case '<=': return compare(a, b) <= 0;
    case '>': return compare(a, b) > 0;
    case '>=': return compare(a, b) >= 0;
  }
  return arith(op, a, b);
}
