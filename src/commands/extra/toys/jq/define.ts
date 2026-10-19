import type { Node } from './ast.ts';
import { out, values } from './eval.ts';
import { natives, type Env, type Native } from './registry.ts';
import type { Value } from './value.ts';

export function native(name: string, arity: number, fn: Native): void {
  natives.set(`${name}/${arity}`, fn);
}

function* cartesian(args: Node[], env: Env, v: Value, i: number, acc: Value[]): Generator<Value[]> {
  if (i < 0) {
    yield acc;
    return;
  }
  for (const x of values(args[i], env, v)) {
    const next = acc.slice();
    next[i] = x;
    yield* cartesian(args, env, v, i - 1, next);
  }
}

/** A builtin over plain values; like jq's C builtins, the last argument varies slowest. */
export function fn(name: string, arity: number, f: (v: Value, ...args: Value[]) => Value): void {
  native(name, arity, function* (args, env, v, p) {
    if (!arity) {
      yield out(f(v), v, p);
      return;
    }
    for (const a of cartesian(args, env, v, arity - 1, new Array<Value>(arity))) yield out(f(v, ...a), v, p);
  });
}
