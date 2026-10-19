/** A string from input (field, getline, ARGV...) that looks numeric: compares as a number. */
export class StrNum {
  readonly s: string;
  readonly n: number;

  constructor(s: string, n: number) {
    this.s = s;
    this.n = n;
  }
}

export class AwkArray {
  readonly m = new Map<string, Val>();
  /** Passed for an unset argument; the caller adopts it only if the callee used it as an array. */
  untyped = false;
}

export type Val = number | string | StrNum;

/** Uninitialized value: "" in string context, 0 in numeric context, and compares as a strnum. */
export const UNINIT = new StrNum('', 0);

const NUM = String.raw`[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)`;
const LOOKS_NUMERIC = new RegExp(String.raw`^[ \t\n\r\f\v]*${NUM}[ \t\n\r\f\v]*$`);
const LEADING_NUMBER = new RegExp(String.raw`^[ \t\n\r\f\v]*(${NUM})`);

export function strnum(s: string): Val {
  return LOOKS_NUMERIC.test(s) ? new StrNum(s, Number(s)) : s;
}

export function strToNum(s: string): number {
  const m = LEADING_NUMBER.exec(s);
  return m ? Number(m[1]) : 0;
}

export function toNum(v: Val): number {
  return typeof v === 'number' ? v : typeof v === 'string' ? strToNum(v) : v.n;
}

export function toBool(v: Val): boolean {
  return typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v !== '' : v.n !== 0;
}

export function isNumeric(v: Val): boolean {
  return typeof v === 'number' || v instanceof StrNum;
}
