import type { Value } from './value.ts';

export interface FuncDef {
  name: string;
  /** Filter params are bare names; value params keep their `$` prefix. */
  params: string[];
  body: Node;
}

export type Pattern =
  | { k: 'var'; name: string; pos: number }
  | { k: 'arr'; items: Pattern[] }
  | { k: 'obj'; entries: { key: Node; bind: string | null; pat: Pattern | null }[] };

type Pair<K extends string> = { k: K; l: Node; r: Node };

export type Node =
  | { k: 'id' }
  | { k: 'lit'; v: Value }
  | { k: 'str'; parts: (string | Node)[]; fmt: string | null }
  | { k: 'fmt'; name: string }
  | { k: 'index'; t: Node; i: Node }
  | { k: 'slice'; t: Node; from: Node | null; to: Node | null }
  | { k: 'iter'; t: Node }
  | Pair<'pipe'> | Pair<'comma'> | Pair<'and'> | Pair<'or'> | Pair<'alt'>
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'assign'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node }
  | { k: 'try'; body: Node; handler: Node | null }
  | { k: 'arr'; e: Node | null }
  | { k: 'obj'; entries: { key: Node; val: Node }[] }
  | { k: 'var'; name: string; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number }
  | { k: 'if'; cond: Node; then: Node; else: Node | null }
  | { k: 'reduce'; src: Node; pat: Pattern; init: Node; update: Node }
  | { k: 'foreach'; src: Node; pat: Pattern; init: Node; update: Node; extract: Node | null }
  | { k: 'bind'; src: Node; pat: Pattern; body: Node }
  | { k: 'label'; name: string; body: Node }
  | { k: 'break'; name: string; pos: number }
  | { k: 'def'; fn: FuncDef; body: Node };

export const ID: Node = { k: 'id' };
export const lit = (v: Value): Node => ({ k: 'lit', v });
