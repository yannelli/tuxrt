import type { Node } from './ast.ts';
import { fn, native } from './define.ts';
import { describe } from './dump.ts';
import { out, values } from './eval.ts';
import { add } from './ops.ts';
import { codepoints, subarrayIndices } from './paths.ts';
import type { Env } from './registry.ts';
import { compare, equal, isNum, isObj, JqError, kind, num, sortedKeys, type Value } from './value.ts';

function items(v: Value): Value[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) return [...v.values()];
  throw new JqError(`Cannot iterate over ${v === null ? 'null' : describe(v)}`);
}

function sortable(v: Value): Value[] {
  if (!Array.isArray(v)) throw new JqError(`${describe(v)} cannot be sorted, as it is not an array`);
  return v;
}

/** Pairs each element with `[f]`, the sort key jq's *_by builtins use; Array#sort is stable like jq's. */
function keyed(v: Value, f: Node, env: Env): [Value, Value][] {
  return items(v).map((x) => [x, [...values(f, env, x)]]);
}

function byKey(pairs: [Value, Value][]): [Value, Value][] {
  return pairs.sort((a, b) => compare(a[1], b[1]));
}

function groups(pairs: [Value, Value][]): Value[][] {
  const out: Value[][] = [];
  let prev: Value | undefined;
  for (const [x, k] of byKey(pairs)) {
    if (prev !== undefined && equal(prev, k)) out[out.length - 1].push(x);
    else out.push([x]);
    prev = k;
  }
  return out;
}

/** min keeps the first smallest key, max the last largest one, as jq does. */
function extreme(pairs: [Value, Value][], max: boolean): Value {
  let best: [Value, Value] | null = null;
  for (const pair of pairs) {
    const c = best ? compare(pair[1], best[1]) : 0;
    if (!best || (max ? c >= 0 : c < 0)) best = pair;
  }
  return best ? best[0] : null;
}

function contains(a: Value, b: Value): boolean {
  if (kind(a) !== kind(b)) return false;
  if (isObj(a) && isObj(b)) return [...b].every(([k, bv]) => a.has(k) && contains(a.get(k)!, bv));
  if (Array.isArray(a) && Array.isArray(b)) return b.every((bv) => a.some((av) => contains(av, bv)));
  if (typeof a === 'string') return a.includes(b as string);
  return equal(a, b);
}

function flatten(v: Value[], depth: number): Value[] {
  return v.flatMap((x) => (Array.isArray(x) && depth !== 0 ? flatten(x, depth - 1) : [x]));
}

fn('length', 0, (v) => {
  if (v === null) return 0;
  if (isNum(v)) return Math.abs(num(v));
  if (typeof v === 'string') return codepoints(v).length;
  if (Array.isArray(v)) return v.length;
  if (isObj(v)) return v.size;
  throw new JqError(`${describe(v)} has no length`);
});
fn('utf8bytelength', 0, (v) => {
  if (typeof v !== 'string') throw new JqError(`${describe(v)} only strings have UTF-8 byte length`);
  return new TextEncoder().encode(v).length;
});
fn('keys', 0, (v) => {
  if (isObj(v)) return sortedKeys(v);
  if (Array.isArray(v)) return v.map((_, i) => i);
  throw new JqError(`${describe(v)} has no keys`);
});
fn('keys_unsorted', 0, (v) => {
  if (isObj(v)) return [...v.keys()];
  if (Array.isArray(v)) return v.map((_, i) => i);
  throw new JqError(`${describe(v)} has no keys`);
});
fn('has', 1, (v, k) => {
  if (isObj(v) && typeof k === 'string') return v.has(k);
  if (Array.isArray(v) && isNum(k)) return num(k) >= 0 && num(k) < v.length;
  throw new JqError(`Cannot check whether ${kind(v)} has a ${kind(k)} key`);
});
fn('contains', 1, (a, b) => {
  if (kind(a) !== kind(b)) throw new JqError(`${describe(a)} and ${describe(b)} cannot have their containment checked`);
  return contains(a, b);
});
fn('type', 0, kind);
fn('add', 0, (v) => {
  const xs = items(v);
  // Merging in one pass avoids the quadratic copying of a left fold over large containers.
  if (xs.length > 1 && xs.every(isObj)) return new Map(xs.flatMap((x) => [...(x as Map<string, Value>)]));
  if (xs.length > 1 && xs.every(Array.isArray)) return (xs as Value[][]).flat(1);
  return xs.reduce<Value>((acc, x) => add(acc, x), null);
});
native('map', 1, function* (args, env, v, p) {
  yield out(items(v).flatMap((x) => [...values(args[0], env, x)]), v, p);
});
fn('sort', 0, (v) => sortable(v).slice().sort(compare));
fn('unique', 0, (v) => sortable(v).slice().sort(compare).filter((x, i, a) => i === 0 || !equal(a[i - 1], x)));
fn('min', 0, (v) => extreme(sortable(v).map((x) => [x, x]), false));
fn('max', 0, (v) => extreme(sortable(v).map((x) => [x, x]), true));
fn('reverse', 0, (v) => {
  if (typeof v === 'string') return codepoints(v).reverse().join('');
  if (v === null) return [];
  if (!Array.isArray(v)) throw new JqError(`Cannot index ${kind(v)} with number`);
  return v.slice().reverse();
});
fn('flatten', 0, (v) => flatten(items(v), -1));
fn('flatten', 1, (v, d) => {
  if (!isNum(d) || num(d) < 0) throw new JqError('flatten depth must not be negative');
  return flatten(items(v), num(d));
});
fn('indices', 1, (v, i) => {
  if (v === null) return null;
  if (typeof v === 'string' && typeof i === 'string') {
    const hay = codepoints(v);
    const needle = codepoints(i);
    return needle.length ? hay.flatMap((_, k) => (needle.every((c, j) => hay[k + j] === c) ? [k] : [])) : null;
  }
  if (Array.isArray(v)) return subarrayIndices(v, Array.isArray(i) ? i : [i]);
  throw new JqError(`Cannot index ${kind(v)} with ${kind(i)}`);
});

const byNative = (name: string, f: (pairs: [Value, Value][]) => Value) =>
  native(name, 1, function* (args, env, v, p) {
    sortable(v);
    yield out(f(keyed(v, args[0], env)), v, p);
  });
byNative('sort_by', (pairs) => byKey(pairs).map(([x]) => x));
byNative('group_by', groups);
byNative('unique_by', (pairs) => groups(pairs).map((g) => g[0]));
byNative('min_by', (pairs) => extreme(pairs, false));
byNative('max_by', (pairs) => extreme(pairs, true));
