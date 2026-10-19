import { describe } from './dump.ts';
import { compare, equal, isNum, isObj, JqError, kind, num, type Obj, type Value } from './value.ts';

const MAX_INDEX = 536870911;

function slicable(v: Value): v is Value[] | string {
  return Array.isArray(v) || typeof v === 'string';
}

export function codepoints(s: string): string[] {
  return /[\ud800-\udfff]/.test(s) ? [...s] : s.split('');
}

/** Resolves a {start, end} slice key against a length, the way jq clamps and rounds. */
function sliceBounds(k: Obj, len: number): [number, number] {
  const s = k.get('start') ?? null;
  const e = k.get('end') ?? null;
  if ((s !== null && !isNum(s)) || (e !== null && !isNum(e))) throw new JqError('Start and end indices of an array slice must be numbers');
  let start = s === null ? 0 : num(s);
  let end = e === null ? len : num(e);
  if (start < 0) start += len;
  if (end < 0) end += len;
  start = Math.min(Math.max(start, 0), len);
  end = Math.min(end, len);
  if (end < start) end = start;
  return [Math.floor(start), Math.ceil(end)];
}

export function slice(t: Value[] | string, k: Obj): Value {
  if (Array.isArray(t)) return t.slice(...sliceBounds(k, t.length));
  const cps = codepoints(t);
  return cps.slice(...sliceBounds(k, cps.length)).join('');
}

export function subarrayIndices(t: Value[], k: Value[]): number[] {
  const out: number[] = [];
  if (!k.length) return out;
  for (let i = 0; i + k.length <= t.length; i++) if (k.every((x, j) => equal(t[i + j], x))) out.push(i);
  return out;
}

/** `.[k]` on a value. */
export function indexValue(t: Value, k: Value): Value {
  if (typeof k === 'string') {
    if (isObj(t)) return t.get(k) ?? null;
    if (t === null) return null;
    throw new JqError(`Cannot index ${kind(t)} with "${k}"`);
  }
  if (isNum(k) && Array.isArray(t)) {
    let i = Math.floor(num(k));
    if (i < 0) i += t.length;
    return i >= 0 && i < t.length ? t[i] : null;
  }
  if (isObj(k) && slicable(t)) return slice(t, k);
  if (Array.isArray(k) && Array.isArray(t)) return subarrayIndices(t, k);
  if (t === null && (isNum(k) || isObj(k) || k === null)) return null;
  throw new JqError(`Cannot index ${kind(t)} with ${kind(k)}`);
}

export function getpath(t: Value, path: Value[]): Value {
  let cur = t;
  for (const k of path) {
    if (cur === null) return null;
    cur = indexValue(cur, k);
  }
  return cur;
}

export function setpath(t: Value, path: Value[], x: Value, i = 0): Value {
  if (i === path.length) return x;
  const k = path[i];
  if (typeof k === 'string') {
    if (t !== null && !isObj(t)) throw new JqError(`Cannot index ${kind(t)} with "${k}"`);
    const m = new Map(t ?? []);
    m.set(k, setpath(m.get(k) ?? null, path, x, i + 1));
    return m;
  }
  if (isNum(k)) {
    if (t !== null && !Array.isArray(t)) throw new JqError(`Cannot index ${kind(t)} with number`);
    const a = t ? t.slice() : [];
    let idx = Math.floor(num(k));
    if (idx < 0 && (idx += a.length) < 0) throw new JqError('Out of bounds negative array index');
    if (idx > MAX_INDEX) throw new JqError('Array index too large');
    const cur = idx < a.length ? a[idx] : null;
    while (a.length < idx) a.push(null);
    a[idx] = setpath(cur, path, x, i + 1);
    return a;
  }
  if (isObj(k)) {
    if (t !== null && !Array.isArray(t)) throw new JqError(`Cannot update field at object index of ${kind(t)}`);
    const a = t ?? [];
    const [s, e] = sliceBounds(k, a.length);
    const repl = setpath(a.slice(s, e), path, x, i + 1);
    if (!Array.isArray(repl)) throw new JqError('A slice of an array can only be assigned another array');
    return [...a.slice(0, s), ...repl, ...a.slice(e)];
  }
  throw new JqError(`Cannot update field at ${kind(k)} index of ${kind(t)}`);
}

function delpath(t: Value, path: Value[]): Value {
  if (!path.length) return null;
  if (t === null) return null;
  const k = path[0];
  if (path.length > 1) {
    const child = indexValue(t, k);
    return child === null ? t : setpath(t, [k], delpath(child, path.slice(1)));
  }
  if (typeof k === 'string' && isObj(t)) {
    if (!t.has(k)) return t;
    const m = new Map(t);
    m.delete(k);
    return m;
  }
  if (isNum(k) && Array.isArray(t)) {
    let idx = Math.floor(num(k));
    if (idx < 0 && (idx += t.length) < 0) throw new JqError('Out of bounds negative array index');
    return idx < t.length ? [...t.slice(0, idx), ...t.slice(idx + 1)] : t;
  }
  if (isObj(k) && Array.isArray(t)) {
    const [s, e] = sliceBounds(k, t.length);
    return [...t.slice(0, s), ...t.slice(e)];
  }
  const what = typeof k === 'string' ? `field "${k}"` : `${kind(k)} index`;
  throw new JqError(`Cannot delete ${what} of ${kind(t)}`);
}

export function delpaths(t: Value, paths: Value[]): Value {
  const sorted = paths.slice().sort(compare);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    if (!Array.isArray(p)) throw new JqError(`Path must be specified as an array, not ${describe(p)}`);
    t = delpath(t, p);
  }
  return t;
}

export function asPath(p: Value): Value[] {
  if (!Array.isArray(p)) throw new JqError('Path must be specified as an array');
  return p;
}
