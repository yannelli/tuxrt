import { ID, type Node } from './ast.ts';
import { ev, values } from './eval.ts';
import type { Env, FnLink, Out, Path } from './registry.ts';
import { defineFn } from './scope.ts';
import { truthy, type Value } from './value.ts';

type Pipe = Extract<Node, { k: 'pipe' }>;

interface State {
  n: Node;
  env: Env;
  v: Value;
  p: Path | null;
}

function lookup(env: Env, key: string): FnLink | null {
  for (let f = env.funcs; f; f = f.next) if (f.key === key) return f;
  return null;
}

/** Steps through defs, single-valued ifs and user calls in place: true = keep looping, false = evaluate normally. */
function step(s: State): boolean | Iterable<Out> {
  const n = s.n;
  if (n.k === 'def') {
    s.env = defineFn(n.fn, s.env);
    s.n = n.body;
    return true;
  }
  if (n.k === 'if') {
    const cs = [...values(n.cond, s.env, s.v)];
    const branch = (c: Value): Node => (truthy(c) ? n.then : (n.else ?? ID));
    if (cs.length !== 1) return cs.flatMap((c) => [...ev(branch(c), s.env, s.v, s.p)]);
    s.n = branch(cs[0]);
    return true;
  }
  if (n.k !== 'call') return false;
  const f = lookup(s.env, `${n.name}/${n.args.length}`);
  if (!f || f.params.some((x) => x.startsWith('$'))) return false;
  let funcs = f.env.funcs;
  f.params.forEach((name, i) => {
    funcs = { key: `${name}/0`, params: [], body: n.args[i], env: s.env, next: funcs };
  });
  s.env = n.args.length ? { ...f.env, funcs } : f.env;
  s.n = f.body;
  return true;
}

/** `l | r` with tail-call elimination: while `l` yields one value, recursion through `r` loops instead of nesting. */
export function pipe(n: Pipe, env: Env, v: Value, p: Path | null): Iterable<Out> {
  const s: State = { n, env, v, p };
  for (;;) {
    while (s.n.k !== 'pipe') {
      const r = step(s);
      if (r === false) return ev(s.n, s.env, s.v, s.p);
      if (r !== true) return r;
    }
    const { l, r } = s.n;
    const it = ev(l, s.env, s.v, s.p)[Symbol.iterator]();
    const first = it.next();
    if (first.done) return [];
    let second: IteratorResult<Out>;
    try {
      second = it.next();
    } catch (e) {
      return thenThrow(ev(r, s.env, first.value[0], first.value[1]), e);
    }
    if (!second.done) return spread(r, s.env, [first.value, second.value], it);
    [s.v, s.p] = first.value;
    s.n = r;
  }
}

function* thenThrow(out: Iterable<Out>, e: unknown): Generator<Out> {
  yield* out;
  throw e;
}

function* spread(r: Node, env: Env, head: Out[], rest: Iterator<Out>): Generator<Out> {
  for (const [x, xp] of head) yield* ev(r, env, x, xp);
  for (let o = rest.next(); !o.done; o = rest.next()) yield* ev(r, env, o.value[0], o.value[1]);
}
