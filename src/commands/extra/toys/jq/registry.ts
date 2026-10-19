import type { Node } from './ast.ts';
import type { Obj, Value } from './value.ts';

export type Path = Value[];
/** A filter output: the value plus, when tracking paths for path(f) and assignment, where it lives. */
export type Out = [Value, Path | null];

export interface Runtime {
  /** Next input value for `input`/`inputs`, or undefined when exhausted. */
  input(): Value | undefined;
  filename(): Value;
  stderr(s: string): void;
  env: Obj;
}

interface VarLink {
  name: string;
  value: Value;
  next: VarLink | null;
}

export interface FnLink {
  key: string;
  params: string[];
  body: Node;
  env: Env;
  next: FnLink | null;
}

export interface Env {
  vars: VarLink | null;
  funcs: FnLink | null;
  rt: Runtime;
}

export type Native = (args: Node[], env: Env, v: Value, p: Path | null) => Iterable<Out>;

/** Builtins implemented in TypeScript, keyed "name/arity". */
export const natives = new Map<string, Native>();

export class Break {
  readonly label: Value;

  constructor(label: Value) {
    this.label = label;
  }
}

export class Halt {
  readonly code: number;

  constructor(code: number) {
    this.code = code;
  }
}
