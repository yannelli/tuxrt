import { patternVars, type Node } from './ast.ts';
import { assign } from './assign.ts';
import { describe, tojson } from './dump.ts';
import { format } from './formats.ts';
import { binop } from './ops.ts';
import { pipe } from './tail.ts';
import { indexValue } from './paths.ts';
import { Break, type Env, type Out, type Path } from './registry.ts';
import { bind, call, defineFn, getVar, setVar } from './scope.ts';
import { isNum, isObj, JqError, num, trunc, truthy, type Value } from './value.ts';

type N<K extends Node['k']> = Extract<Node, { k: K }>;

/** Wraps a computed value; in path mode only values identical to the input keep a valid path. */
export function out(x: Value, v: Value, p: Path | null): Out {
  if (p === null || x === v) return [x, p];
  throw new JqError(`Invalid path expression with result ${trunc(tojson(x), 30)}`);
}

export function* values(n: Node, env: Env, v: Value): Generator<Value> {
  for (const o of ev(n, env, v, null)) yield o[0];
}

const pathKey = (k: Value): Value => (isNum(k) ? num(k) : k);

/** Evaluates a filter to its output stream. Each node kind gets its own small generator to keep frames shallow. */
export function ev(n: Node, env: Env, v: Value, p: Path | null): Iterable<Out> {
  switch (n.k) {
    case 'id': return [[v, p]];
    case 'lit': return [out(n.v, v, p)];
    case 'var': return [out(getVar(env, n.name), v, p)];
    case 'fmt': return [out(format(n.name, v), v, p)];
    case 'str': return str(n, env, v, p);
    case 'index': return index(n, env, v, p);
    case 'slice': return slice(n, env, v, p);
    case 'iter': return iter(n, env, v, p);
    case 'pipe': return pipe(n, env, v, p);
    case 'comma': return comma(n, env, v, p);
    case 'neg': return neg(n, env, v, p);
    case 'bin': return bin(n, env, v, p);
    case 'and': case 'or': return andOr(n, env, v, p);
    case 'alt': return alt(n, env, v, p);
    case 'try': return attempt(n, env, v, p);
    case 'arr': return [out(n.e ? [...values(n.e, env, v)] : [], v, p)];
    case 'obj': return obj(n, env, v, p);
    case 'call': return call(n.name, n.args, env, v, p);
    case 'if': return cond(n, env, v, p);
    case 'reduce': return reduce(n, env, v, p);
    case 'foreach': return foreach(n, env, v, p);
    case 'bind': return binding(n, env, v, p);
    case 'label': return label(n, env, v, p);
    case 'break': throw new Break(getVar(env, `*${n.name}`));
    case 'def': return ev(n.body, defineFn(n.fn, env), v, p);
    case 'assign': return assign(n.op, n.l, n.r, env, v, p);
  }
}

function* str(n: N<'str'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const s of interp(n.parts, n.fmt, env, v, n.parts.length - 1, '')) yield out(s, v, p);
}

/** String interpolation; the last part varies slowest, as in jq's chained `+`. */
function* interp(parts: (string | Node)[], fmt: string | null, env: Env, v: Value, i: number, suffix: string): Generator<string> {
  if (i < 0) {
    yield suffix;
    return;
  }
  const part = parts[i];
  if (typeof part === 'string') {
    yield* interp(parts, fmt, env, v, i - 1, part + suffix);
    return;
  }
  for (const x of values(part, env, v)) {
    const s = fmt ? (format(fmt, x) as string) : typeof x === 'string' ? x : tojson(x);
    yield* interp(parts, fmt, env, v, i - 1, s + suffix);
  }
}

function* index(n: N<'index'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const k of n.i.k === 'lit' ? [n.i.v] : values(n.i, env, v))
    for (const [t, tp] of ev(n.t, env, v, p)) yield [indexValue(t, k), tp && [...tp, pathKey(k)]];
}

function* slice(n: N<'slice'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const to of n.to ? values(n.to, env, v) : [null])
    for (const from of n.from ? values(n.from, env, v) : [null]) {
      const key: Value = new Map([['start', from], ['end', to]]);
      for (const [t, tp] of ev(n.t, env, v, p)) yield [indexValue(t, key), tp && [...tp, key]];
    }
}

function* iter(n: N<'iter'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const [t, tp] of ev(n.t, env, v, p)) {
    if (Array.isArray(t)) for (let i = 0; i < t.length; i++) yield [t[i], tp && [...tp, i]];
    else if (isObj(t)) for (const [k, x] of t) yield [x, tp && [...tp, k]];
    else throw new JqError(`Cannot iterate over ${t === null ? 'null' : describe(t)}`);
  }
}

function* comma(n: N<'comma'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  yield* ev(n.l, env, v, p);
  yield* ev(n.r, env, v, p);
}

function* neg(n: N<'neg'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const x of values(n.e, env, v)) {
    if (!isNum(x)) throw new JqError(`${describe(x)} cannot be negated`);
    yield out(-num(x), v, p);
  }
}

function* bin(n: N<'bin'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const r of values(n.r, env, v)) for (const l of values(n.l, env, v)) yield out(binop(n.op, l, r), v, p);
}

function* andOr(n: N<'and' | 'or'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const l of values(n.l, env, v)) {
    if (truthy(l) === (n.k === 'or')) yield out(n.k === 'or', v, p);
    else for (const r of values(n.r, env, v)) yield out(truthy(r), v, p);
  }
}

function* alt(n: N<'alt'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  let found = false;
  try {
    for (const o of ev(n.l, env, v, p)) {
      if (!truthy(o[0])) continue;
      found = true;
      yield o;
    }
  } catch (e) {
    if (!(e instanceof JqError)) throw e;
  }
  if (!found) yield* ev(n.r, env, v, p);
}

function* attempt(n: N<'try'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  try {
    yield* ev(n.body, env, v, p);
  } catch (e) {
    if (!(e instanceof JqError)) throw e;
    if (n.handler) for (const x of values(n.handler, env, e.value)) yield out(x, v, p);
  }
}

function* obj(n: N<'obj'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (const o of entries(n.entries, env, v, 0, [])) yield out(o, v, p);
}

function* entries(list: N<'obj'>['entries'], env: Env, v: Value, i: number, acc: [string, Value][]): Generator<Value> {
  if (i === list.length) {
    yield new Map(acc);
    return;
  }
  const { key, val } = list[i];
  for (const k of values(key, env, v)) {
    if (typeof k !== 'string') throw new JqError('Object keys must be strings');
    for (const x of values(val, env, v)) yield* entries(list, env, v, i + 1, [...acc, [k, x]]);
  }
}

/** A single-valued condition hands back the branch's stream itself, so recursion through `if` adds no frame. */
function cond(n: N<'if'>, env: Env, v: Value, p: Path | null): Iterable<Out> {
  const cs = [...values(n.cond, env, v)];
  const branch = (c: Value): Iterable<Out> => (truthy(c) ? ev(n.then, env, v, p) : n.else ? ev(n.else, env, v, p) : [[v, p]]);
  return cs.length === 1 ? branch(cs[0]) : cs.flatMap((c) => [...branch(c)]);
}

function* reduce(n: N<'reduce'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (let acc of ev(n.init, env, v, p)) {
    for (const x of values(n.src, env, v))
      for (const e of bind(n.pat, x, env, v)) {
        let last: Out = [null, null];
        for (const o of ev(n.update, e, acc[0], acc[1])) last = o;
        acc = last;
      }
    yield acc;
  }
}

function* foreach(n: N<'foreach'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  for (let acc of ev(n.init, env, v, p))
    for (const x of values(n.src, env, v))
      for (const e of bind(n.pat, x, env, v))
        for (const o of ev(n.update, e, acc[0], acc[1])) {
          acc = o;
          if (n.extract) yield* ev(n.extract, e, o[0], o[1]);
          else yield o;
        }
}

function* binding(n: N<'bind'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  if (n.alts.length) return yield* altBinding(n, env, v, p);
  for (const x of values(n.src, env, v)) for (const e of bind(n.pat, x, env, v)) yield* ev(n.body, e, v, p);
}

/** `?//`: every variable of every alternative is bound (null by default); an error moves on to the next pattern. */
function* altBinding(n: N<'bind'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  const pats = [n.pat, ...n.alts];
  const base = pats.flatMap(patternVars).reduce((e, name) => setVar(e, name, null), env);
  for (const x of values(n.src, env, v)) {
    for (let i = 0; i < pats.length; i++) {
      try {
        for (const e of bind(pats[i], x, base, v)) yield* ev(n.body, e, v, p);
        break;
      } catch (err) {
        if (!(err instanceof JqError) || i === pats.length - 1) throw err;
      }
    }
  }
}

function* label(n: N<'label'>, env: Env, v: Value, p: Path | null): Generator<Out> {
  const token: Value = new Map();
  try {
    yield* ev(n.body, setVar(env, `*${n.name}`, token), v, p);
  } catch (e) {
    if (!(e instanceof Break) || e.label !== token) throw e;
  }
}
