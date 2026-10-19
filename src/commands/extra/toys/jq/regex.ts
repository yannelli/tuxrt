import type { Node } from './ast.ts';
import { fn, native } from './define.ts';
import { describe } from './dump.ts';
import { out, values } from './eval.ts';
import { add } from './ops.ts';
import { codepoints } from './paths.ts';
import type { Env } from './registry.ts';
import { JqError, type Obj, type Value } from './value.ts';

interface Match {
  offset: number;
  length: number;
  string: string;
  captures: { offset: number; length: number; string: string | null; name: string | null }[];
}

const cache = new Map<string, RegExp>();

/** Oniguruma extended mode: drop unescaped whitespace and #-comments outside character classes. */
function extended(re: string): string {
  return re.replace(/\\.|\[(?:\\.|[^\]])*\]|#[^\n]*|\s+/gs, (m) => (m[0] === '\\' || m[0] === '[' ? m : ''));
}

function compile(re: Value, flags: Value): { rx: RegExp; global: boolean; skipEmpty: boolean } {
  if (typeof re !== 'string') throw new JqError(`${describe(re)} cannot be matched, as it is not a string`);
  if (flags !== null && typeof flags !== 'string') throw new JqError(`${describe(flags)} is not a string`);
  const f = flags ?? '';
  if (/[^gixnslp]/.test(f)) throw new JqError(`${f} is not a valid modifier string`);
  const src = (f.includes('x') ? extended(re) : re).replace(/\\A/g, '^').replace(/\\[zZ]/g, '$');
  const js = `gd${f.includes('i') ? 'i' : ''}${f.includes('p') ? 's' : ''}`;
  const key = `${js}/${src}`;
  let rx = cache.get(key);
  if (!rx) {
    try {
      rx = new RegExp(src, `${js}u`);
    } catch {
      try {
        rx = new RegExp(src, js);
      } catch (e) {
        throw new JqError(`${re} (at offset 0) is not a valid regex: ${(e as Error).message}`);
      }
    }
    cache.set(key, rx);
  }
  return { rx, global: f.includes('g'), skipEmpty: f.includes('n') };
}

/** UTF-16 offset to code point offset. */
function cpIndex(s: string, i: number): number {
  return codepoints(s.slice(0, i)).length;
}

function matches(s: string, re: Value, flags: Value, forceGlobal = false): Match[] {
  const { rx, global, skipEmpty } = compile(re, flags);
  const names = new Map<number, string>();
  const groups = /\((?!\?)|\(\?<([A-Za-z_]\w*)>/g;
  let n = 0;
  for (const g of rx.source.replace(/\\./g, '').replace(/\[(?:\\.|[^\]])*\]/g, '').matchAll(groups)) {
    n++;
    if (g[1]) names.set(n, g[1]);
  }
  const out: Match[] = [];
  rx.lastIndex = 0;
  for (let m = rx.exec(s); m; m = rx.exec(s)) {
    const [start, end] = m.indices![0]!;
    if (m[0] === '') rx.lastIndex = start + (rx.unicode && (s.codePointAt(start) ?? 0) > 0xffff ? 2 : 1);
    if (m[0] === '' && skipEmpty) {
      if (start >= s.length) break;
      continue;
    }
    out.push({
      offset: cpIndex(s, start),
      length: codepoints(s.slice(start, end)).length,
      string: m[0],
      captures: m.slice(1).map((c, i) => {
        const span = m.indices![i + 1];
        const name = names.get(i + 1) ?? null;
        if (c === undefined || !span) return { offset: -1, length: 0, string: null, name };
        return { offset: cpIndex(s, span[0]), length: codepoints(c).length, string: c, name };
      }),
    });
    if (!(global || forceGlobal) || start >= s.length) break;
  }
  return out;
}

const toValue = (m: Match): Value =>
  new Map<string, Value>([
    ['offset', m.offset],
    ['length', m.length],
    ['string', m.string],
    ['captures', m.captures.map((c) => new Map<string, Value>(Object.entries(c)))],
  ]);

const captureObject = (m: Match): Obj => new Map(m.captures.filter((c) => c.name !== null).map((c) => [c.name!, c.string]));

function input(v: Value): string {
  if (typeof v !== 'string') throw new JqError(`${describe(v)} cannot be matched, as it is not a string`);
  return v;
}

/** test/match/capture accept either (re; flags) or a single [re, flags] array. */
function* reArgs(args: Node[], env: Env, v: Value): Generator<[Value, Value]> {
  if (args.length === 2) {
    for (const f of values(args[1], env, v)) for (const re of values(args[0], env, v)) yield [re, f];
    return;
  }
  for (const a of values(args[0], env, v)) {
    if (typeof a === 'string') yield [a, null];
    else if (Array.isArray(a) && a.length) yield [a[0], a[1] ?? null];
    else throw new JqError(`${describe(a)} cannot be matched, as it is not a string`);
  }
}

for (const arity of [1, 2]) {
  native('test', arity, function* (args, env, v, p) {
    for (const [re, f] of reArgs(args, env, v)) yield out(matches(input(v), re, f).length > 0, v, p);
  });
  native('match', arity, function* (args, env, v, p) {
    for (const [re, f] of reArgs(args, env, v)) for (const m of matches(input(v), re, f)) yield out(toValue(m), v, p);
  });
  native('capture', arity, function* (args, env, v, p) {
    for (const [re, f] of reArgs(args, env, v)) for (const m of matches(input(v), re, f)) yield out(captureObject(m), v, p);
  });
}

fn('split', 2, (v, re, flags) => {
  const s = codepoints(input(v));
  const parts: Value[] = [];
  let prev = 0;
  for (const m of matches(input(v), re, flags, true)) {
    parts.push(s.slice(prev, m.offset).join(''));
    prev = m.offset + m.length;
  }
  parts.push(s.slice(prev).join(''));
  return parts;
});

function* substitute(s: string[], ms: Match[], i: number, from: number, acc: Value, repl: Node, env: Env): Generator<Value> {
  if (i === ms.length) {
    yield add(acc, s.slice(from).join(''));
    return;
  }
  const m = ms[i];
  const gap = add(acc, s.slice(from, m.offset).join(''));
  for (const r of values(repl, env, captureObject(m))) yield* substitute(s, ms, i + 1, m.offset + m.length, add(gap, r), repl, env);
}

native('sub', 3, function* (args, env, v, p) {
  for (const f of values(args[2], env, v))
    for (const re of values(args[0], env, v)) {
      const ms = matches(input(v), re, f);
      for (const r of substitute(codepoints(v as string), ms, 0, 0, '', args[1], env)) yield out(r, v, p);
    }
});
