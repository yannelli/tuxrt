import { pathsOf } from './assign.ts';
import { fn, native } from './define.ts';
import { tojson } from './dump.ts';
import { ev, out, values } from './eval.ts';
import { asPath, delpaths, getpath, setpath } from './paths.ts';
import { Halt, type Native, type Out, type Path } from './registry.ts';
import { isNum, isObj, JqError, num, truthy, type Value } from './value.ts';

function* children([x, xp]: Out): Generator<Out> {
  if (Array.isArray(x)) for (let i = 0; i < x.length; i++) yield [x[i], xp && [...xp, i]];
  else if (isObj(x)) for (const [k, c] of x) yield [c, xp && [...xp, k]];
}

/** Depth-first `., (f | recurse(f))` with an explicit stack, so deep or endless recursion can't overflow. */
function* dfs(start: Out, step: (o: Out) => Iterator<Out>): Generator<Out> {
  const stack: Iterator<Out>[] = [[start][Symbol.iterator]()];
  while (stack.length) {
    const r = stack[stack.length - 1].next();
    if (r.done) stack.pop();
    else {
      yield r.value;
      stack.push(step(r.value));
    }
  }
}

const recurse1: Native = (args, env, v, p) => dfs([v, p], ([x, xp]) => ev(args[0], env, x, xp)[Symbol.iterator]());

native('empty', 0, function* () {});
native('error', 0, (_a, _e, v) => {
  throw new JqError(v);
});
native('error', 1, function* (args, env, v) {
  for (const m of values(args[0], env, v)) throw new JqError(m);
});
native('not', 0, function* (_a, _e, v, p) {
  yield out(!truthy(v), v, p);
});
native('select', 1, function* (args, env, v, p) {
  for (const c of values(args[0], env, v)) if (truthy(c)) yield [v, p];
});
native('path', 1, function* (args, env, v, p) {
  for (const q of pathsOf(args[0], env, v)) yield out(q, v, p);
});
native('getpath', 1, function* (args, env, v, p) {
  for (const q of values(args[0], env, v)) {
    const path = asPath(q);
    yield [getpath(v, path), p && [...p, ...path]];
  }
});
fn('setpath', 2, (v, p, x) => setpath(v, asPath(p), x));
fn('delpaths', 1, (v, ps) => {
  if (!Array.isArray(ps)) throw new JqError('Paths must be specified as an array');
  return delpaths(v, ps);
});
native('recurse', 0, (_a, _e, v, p) => dfs([v, p], children));
native('recurse', 1, recurse1);
native('repeat', 1, recurse1);

native('while', 2, function* (args, env, v, p) {
  const stack: Iterator<Out>[] = [[[v, p] as Out][Symbol.iterator]()];
  while (stack.length) {
    const r = stack[stack.length - 1].next();
    if (r.done) {
      stack.pop();
      continue;
    }
    const [x, xp] = r.value;
    for (const c of values(args[0], env, x)) {
      if (!truthy(c)) continue;
      yield r.value;
      stack.push(ev(args[1], env, x, xp)[Symbol.iterator]());
    }
  }
});
native('until', 2, function* (args, env, v, p) {
  const stack: Iterator<Out>[] = [[[v, p] as Out][Symbol.iterator]()];
  while (stack.length) {
    const r = stack[stack.length - 1].next();
    if (r.done) {
      stack.pop();
      continue;
    }
    const [x, xp] = r.value;
    for (const c of values(args[0], env, x)) {
      if (truthy(c)) yield r.value;
      else stack.push(ev(args[1], env, x, xp)[Symbol.iterator]());
    }
  }
});
native('limit', 2, function* (args, env, v, p) {
  for (const n of values(args[0], env, v)) {
    const max = isNum(n) ? num(n) : Infinity;
    if (max === 0) continue;
    let i = 0;
    for (const o of ev(args[1], env, v, p)) {
      yield o;
      if (max > 0 && ++i >= max) break;
    }
  }
});
native('first', 1, function* (args, env, v, p) {
  for (const o of ev(args[0], env, v, p)) {
    yield o;
    return;
  }
});
native('last', 1, function* (args, env, v, p) {
  let last: Out | null = null;
  for (const o of ev(args[0], env, v, p)) last = o;
  yield last ?? out(null, v, p);
});
native('isempty', 1, function* (args, env, v, p) {
  for (const _ of values(args[0], env, v)) {
    yield out(false, v, p);
    return;
  }
  yield out(true, v, p);
});

function* range(from: Value, upto: Value, by: Value, v: Value, p: Path | null): Generator<Out> {
  if (!isNum(from) || !isNum(upto) || !isNum(by)) throw new JqError('Range bounds must be numeric');
  const [a, b, step] = [num(from), num(upto), num(by)];
  if (step > 0) for (let x = a; x < b; x += step) yield out(x, v, p);
  else if (step < 0) for (let x = a; x > b; x += step) yield out(x, v, p);
}
native('range', 1, function* (args, env, v, p) {
  for (const n of values(args[0], env, v)) yield* range(0, n, 1, v, p);
});
native('range', 2, function* (args, env, v, p) {
  for (const a of values(args[0], env, v)) for (const b of values(args[1], env, v)) yield* range(a, b, 1, v, p);
});
native('range', 3, function* (args, env, v, p) {
  for (const a of values(args[0], env, v))
    for (const b of values(args[1], env, v)) for (const s of values(args[2], env, v)) yield* range(a, b, s, v, p);
});

native('input', 0, function* (_a, env, v, p) {
  const x = env.rt.input();
  if (x === undefined) throw new JqError('No more inputs');
  yield out(x, v, p);
});
native('inputs', 0, function* (_a, env, v, p) {
  for (let x = env.rt.input(); x !== undefined; x = env.rt.input()) yield out(x, v, p);
});
native('input_line_number', 0, function* (_a, env, v, p) {
  yield out(env.rt.line(), v, p);
});
native('modulemeta', 0, function* (_a, env, v, p) {
  if (typeof v !== 'string') throw new JqError('modulemeta input module not a string');
  yield out(env.rt.modulemeta(v), v, p);
});
native('input_filename', 0, function* (_a, env, v, p) {
  yield out(env.rt.filename(), v, p);
});
native('debug', 0, function* (_a, env, v, p) {
  env.rt.stderr(`["DEBUG:",${tojson(v)}]\n`);
  yield [v, p];
});
native('stderr', 0, function* (_a, env, v, p) {
  env.rt.stderr(tojson(v));
  yield [v, p];
});
native('halt', 0, () => {
  throw new Halt(0);
});
native('halt_error', 1, function* (args, env, v) {
  for (const code of values(args[0], env, v)) {
    if (!isNum(code)) throw new JqError('halt_error/1: number required');
    env.rt.stderr(typeof v === 'string' ? v : `${tojson(v)}\n`);
    throw new Halt(num(code));
  }
});
native('env', 0, function* (_a, env, v, p) {
  yield out(env.rt.env, v, p);
});
native('now', 0, function* (_a, _e, v, p) {
  yield out(Date.now() / 1000, v, p);
});
