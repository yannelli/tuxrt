/** A number literal whose canonical decimal text differs from JS's rendering (1.000, 1E+2, ints beyond 2^53). */
export class Big {
  readonly n: number;
  readonly s: string;

  constructor(s: string) {
    this.s = s;
    this.n = Number(s);
  }
}

export type Obj = Map<string, Value>;
export type Value = null | boolean | number | string | Big | Value[] | Obj;
type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

/** A jq runtime error; `value` is what `catch` receives. */
export class JqError extends Error {
  readonly value: Value;

  constructor(value: Value) {
    super(typeof value === 'string' ? value : 'jq error');
    this.value = value;
  }
}

export class CompileError extends Error {
  readonly pos: number;

  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

export const isObj = (v: Value): v is Obj => v instanceof Map;
export const isNum = (v: Value): v is number | Big => typeof v === 'number' || v instanceof Big;
export const num = (v: Value): number => (v instanceof Big ? v.n : (v as number));
export const truthy = (v: Value): boolean => v !== null && v !== false;

export function kind(v: Value): Kind {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
  }
  if (Array.isArray(v)) return 'array';
  return v instanceof Big ? 'number' : 'object';
}

function rank(v: Value): number {
  if (v === null) return 0;
  if (v === false) return 1;
  if (v === true) return 2;
  return { number: 3, string: 4, array: 5, object: 6 }[kind(v) as 'number'];
}

/** Code point order (what jq's byte-wise UTF-8 comparison yields), not UTF-16 unit order. */
function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800) x = x < 0xe000 ? x + 0x2000 : x - 0x800;
    if (y >= 0xd800) y = y < 0xe000 ? y + 0x2000 : y - 0x800;
    return x - y;
  }
  return a.length - b.length;
}

export const sortedKeys = (o: Obj): string[] => [...o.keys()].sort(cmpStr);

function cmpNum(a: number | Big, b: number | Big): number {
  if (a instanceof Big && b instanceof Big && /^-?\d+$/.test(a.s) && /^-?\d+$/.test(b.s)) {
    const x = BigInt(a.s);
    const y = BigInt(b.s);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = num(a);
  const y = num(b);
  // jq compares nan as if it were null: below every number, itself included
  if (Number.isNaN(x)) return -1;
  if (Number.isNaN(y)) return 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** jq's total order: null < false < true < numbers < strings < arrays < objects. */
export function compare(a: Value, b: Value): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) return cmpNum(a as number, b as number);
  if (ra === 4) return cmpStr(a as string, b as string);
  if (ra === 5) {
    const x = a as Value[];
    const y = b as Value[];
    for (let i = 0; i < x.length && i < y.length; i++) {
      const c = compare(x[i], y[i]);
      if (c) return c;
    }
    return x.length - y.length;
  }
  if (ra === 6) {
    const ka = sortedKeys(a as Obj);
    const kb = sortedKeys(b as Obj);
    const c = compare(ka, kb);
    if (c) return c;
    for (const k of ka) {
      const d = compare((a as Obj).get(k)!, (b as Obj).get(k)!);
      if (d) return d;
    }
  }
  return 0;
}

export const equal = (a: Value, b: Value): boolean => a === b || compare(a, b) === 0;

export function trunc(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}
