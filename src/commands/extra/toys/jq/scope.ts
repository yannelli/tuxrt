import type { FuncDef, Node, Pattern } from './ast.ts';
import { ev, values } from './eval.ts';
import { indexValue } from './paths.ts';
import { natives, type Env, type FnLink, type Out, type Path } from './registry.ts';
import { JqError, kind, type Value } from './value.ts';

type ObjEntries = Extract<Pattern, { k: 'obj' }>['entries'];

export function setVar(env: Env, name: string, value: Value): Env {
  return { ...env, vars: { name, value, next: env.vars } };
}

export function getVar(env: Env, name: string): Value {
  for (let l = env.vars; l; l = l.next) if (l.name === name) return l.value;
  throw new JqError(`$${name} is not defined`);
}

export function defineFn(fn: FuncDef, env: Env): Env {
  const link: FnLink = { key: `${fn.name}/${fn.params.length}`, params: fn.params, body: fn.body, env, next: env.funcs };
  link.env = { ...env, funcs: link };
  return link.env;
}

/** Returns the callee's stream directly rather than wrapping it, keeping deep recursion's generator chain short. */
export function call(name: string, args: Node[], env: Env, v: Value, p: Path | null): Iterable<Out> {
  const key = `${name}/${args.length}`;
  for (let f = env.funcs; f; f = f.next) if (f.key === key) return callFn(f, args, env, v, p);
  const nat = natives.get(key);
  if (!nat) throw new JqError(`${key} is not defined`);
  return nat(args, env, v, p);
}

function callFn(f: FnLink, args: Node[], caller: Env, v: Value, p: Path | null): Iterable<Out> {
  if (!args.length) return ev(f.body, f.env, v, p);
  let funcs = f.env.funcs;
  const vals: [string, Node][] = [];
  f.params.forEach((name, i) => {
    const bare = name.replace(/^\$/, '');
    funcs = { key: `${bare}/0`, params: [], body: args[i], env: caller, next: funcs };
    if (bare !== name) vals.push([bare, args[i]]);
  });
  const env = { ...f.env, funcs };
  return vals.length ? bindArgs(vals, 0, env, caller, f.body, v, p) : ev(f.body, env, v, p);
}

function* bindArgs(vals: [string, Node][], i: number, env: Env, caller: Env, body: Node, v: Value, p: Path | null): Generator<Out> {
  if (i === vals.length) {
    yield* ev(body, env, v, p);
    return;
  }
  for (const x of values(vals[i][1], caller, v)) yield* bindArgs(vals, i + 1, setVar(env, vals[i][0], x), caller, body, v, p);
}

export function* bind(pat: Pattern, x: Value, env: Env, v: Value): Generator<Env> {
  if (pat.k === 'var') yield setVar(env, pat.name, x);
  else if (pat.k === 'arr') yield* bindItems(pat.items, 0, x, env, v);
  else yield* bindEntries(pat.entries, 0, x, env, v);
}

function* bindItems(items: Pattern[], i: number, x: Value, env: Env, v: Value): Generator<Env> {
  if (i === items.length) {
    yield env;
    return;
  }
  for (const e of bind(items[i], indexValue(x, i), env, v)) yield* bindItems(items, i + 1, x, e, v);
}

function* bindEntries(entries: ObjEntries, i: number, x: Value, env: Env, v: Value): Generator<Env> {
  if (i === entries.length) {
    yield env;
    return;
  }
  const { key, bind: name, pat } = entries[i];
  for (const k of values(key, env, v)) {
    if (typeof k !== 'string') throw new JqError(`Cannot index ${kind(x)} with ${kind(k)}`);
    const val = indexValue(x, k);
    const e = name ? setVar(env, name, val) : env;
    if (!pat) yield* bindEntries(entries, i + 1, x, e, v);
    else for (const e2 of bind(pat, val, e, v)) yield* bindEntries(entries, i + 1, x, e2, v);
  }
}
