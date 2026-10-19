import type { Node } from './ast.ts';
import { tojson } from './dump.ts';
import { ev, out, values } from './eval.ts';
import { binop } from './ops.ts';
import { delpaths, getpath, setpath } from './paths.ts';
import type { Env, Out, Path } from './registry.ts';
import { JqError, trunc, truthy, type Value } from './value.ts';

export function* pathsOf(n: Node, env: Env, v: Value): Generator<Path> {
  for (const [x, p] of ev(n, env, v, [])) {
    if (p === null) throw new JqError(`Invalid path expression with result ${trunc(tojson(x), 30)}`);
    yield p;
  }
}

/** jq's _modify: paths come from the original input; an update yielding nothing deletes the path. */
function modify(v: Value, lhs: Node, env: Env, f: (old: Value) => Value | undefined): Value {
  let acc = v;
  for (const p of pathsOf(lhs, env, v)) {
    const x = f(getpath(acc, p));
    acc = x === undefined ? delpaths(acc, [p]) : setpath(acc, p, x);
  }
  return acc;
}

function first(rhs: Node, env: Env, v: Value): Value | undefined {
  for (const x of values(rhs, env, v)) return x;
  return undefined;
}

export function* assign(op: string, lhs: Node, rhs: Node, env: Env, v: Value, p: Path | null): Generator<Out> {
  if (op === '|=') {
    yield out(modify(v, lhs, env, (old) => first(rhs, env, old)), v, p);
    return;
  }
  for (const r of values(rhs, env, v)) {
    let f: (old: Value) => Value;
    if (op === '=') f = () => r;
    else if (op === '//=') f = (old) => (truthy(old) ? old : r);
    else f = (old) => binop(op.slice(0, -1), old, r);
    yield out(modify(v, lhs, env, f), v, p);
  }
}
