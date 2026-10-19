export type Ref = { k: 'var'; name: string } | { k: 'local'; i: number; name: string };

export type LValue = Ref | { k: 'field'; e: Expr } | { k: 'index'; arr: Ref; subs: Expr[] };

export type GetlineExpr = { k: 'getline'; from: 'main' | 'file' | 'cmd'; target?: LValue; src?: Expr };

export type Expr =
  | LValue
  | GetlineExpr
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'regex'; src: string }
  | { k: 'assign'; op: string; target: LValue; e: Expr }
  | { k: 'cond'; c: Expr; t: Expr; f: Expr }
  | { k: 'and' | 'or'; l: Expr; r: Expr }
  | { k: 'in'; subs: Expr[]; arr: Ref }
  | { k: 'match'; neg: boolean; l: Expr; r: Expr }
  | { k: 'binary'; op: string; l: Expr; r: Expr }
  | { k: 'unary'; op: string; e: Expr }
  | { k: 'incdec'; op: string; pre: boolean; target: LValue }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'builtin'; name: string; args: Expr[] };

export interface Redir {
  op: string;
  e: Expr;
}

export type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'print' | 'printf'; args: Expr[]; redir?: Redir }
  | { k: 'if'; c: Expr; t: Stmt; f?: Stmt }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'for'; init?: Expr; c?: Expr; step?: Expr; body: Stmt }
  | { k: 'forin'; v: Ref; arr: Ref; body: Stmt }
  | { k: 'block'; body: Stmt[] }
  | { k: 'jump'; op: string }
  | { k: 'exit' | 'return'; e?: Expr }
  | { k: 'delete'; arr: Ref; subs?: Expr[] };

export interface Rule {
  pattern?: Expr;
  end?: Expr;
  body?: Stmt[];
  inRange: boolean;
}

export interface Func {
  params: string[];
  body: Stmt[];
}

export interface Program {
  begin: Stmt[][];
  end: Stmt[][];
  rules: Rule[];
  funcs: Map<string, Func>;
}

export function isLValue(e: Expr): e is LValue {
  return e.k === 'var' || e.k === 'local' || e.k === 'field' || e.k === 'index';
}

export function isRef(e: Expr): e is Ref {
  return e.k === 'var' || e.k === 'local';
}
