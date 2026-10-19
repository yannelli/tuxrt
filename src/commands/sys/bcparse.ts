export interface Tok {
  k: 'num' | 'name' | 'str' | 'op' | 'nl' | 'eof';
  v: string;
  line: number;
}

export type Expr =
  | { t: 'num'; text: string }
  | { t: 'var'; name: string }
  | { t: 'assign'; name: string; op: string; value: Expr }
  | { t: 'step'; name: string; delta: number; prefix: boolean }
  | { t: 'neg' | 'not'; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'call'; name: string; args: Expr[] };

export type Stmt =
  | { t: 'expr'; e: Expr }
  | { t: 'str'; s: string }
  | { t: 'print'; items: (Expr | string)[] }
  | { t: 'block'; body: Stmt[] }
  | { t: 'if'; cond: Expr; then: Stmt; otherwise?: Stmt }
  | { t: 'while'; cond: Expr; body: Stmt }
  | { t: 'for'; init?: Expr; cond?: Expr; step?: Expr; body: Stmt }
  | { t: 'break' | 'continue' | 'quit' | 'halt' };

export class BcSyntaxError extends Error {
  line: number;
  constructor(line: number) {
    super('syntax error');
    this.line = line;
  }
}

const OPS = ['++', '--', '+=', '-=', '*=', '/=', '%=', '^=', '==', '!=', '<=', '>=', '&&', '||', ...'+-*/%^=<>!(){}[],;'];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^=']);
const RELATIONAL = new Set(['==', '!=', '<', '<=', '>', '>=']);
const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'break', 'continue', 'quit', 'halt', 'print', 'define', 'return', 'auto']);

/** Tokenizes bc source. `open` reports an unterminated string, comment or bracket, so the caller waits for more lines. */
export function lex(src: string, line = 1): { toks: Tok[]; open: boolean } {
  const toks: Tok[] = [];
  let depth = 0;
  let i = 0;
  const lines = (s: string) => s.split('\n').length - 1;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (rest.startsWith('\\\n')) (i += 2, line++);
    else if (c === '\n') (toks.push({ k: 'nl', v: c, line: line++ }), i++);
    else if (/\s/.test(c)) i++;
    else if (c === '#') i = src.includes('\n', i) ? src.indexOf('\n', i) : src.length;
    else if (rest.startsWith('/*') || c === '"') {
      const end = src.indexOf(c === '"' ? '"' : '*/', i + 1 + Number(c !== '"'));
      if (end === -1) return { toks, open: true };
      const body = src.slice(i, end + (c === '"' ? 1 : 2));
      if (c === '"') toks.push({ k: 'str', v: body.slice(1, -1), line });
      line += lines(body);
      i += body.length;
    } else if ((m = /^([0-9A-F]+\.?[0-9A-F]*|\.[0-9A-F]+)/.exec(rest))) (toks.push({ k: 'num', v: m[0], line }), (i += m[0].length));
    else if ((m = /^[a-z][a-z0-9_]*/.exec(rest))) (toks.push({ k: 'name', v: m[0], line }), (i += m[0].length));
    else {
      const op = OPS.find((o) => rest.startsWith(o)) ?? c;
      depth += Number(op === '{' || op === '(') - Number(op === '}' || op === ')');
      toks.push({ k: 'op', v: op, line });
      i += op.length;
    }
  }
  toks.push({ k: 'eof', v: '', line });
  return { toks, open: depth > 0 };
}

export class Parser {
  private toks: Tok[];
  private i = 0;

  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(ahead = 0): Tok {
    return this.toks[Math.min(this.i + ahead, this.toks.length - 1)];
  }

  private at(v: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return (t.k === 'op' || t.k === 'name') && t.v === v;
  }

  private eat(v: string): void {
    if (!this.at(v)) throw new BcSyntaxError(this.peek().line);
    this.i++;
  }

  private separator(): boolean {
    return this.peek().k === 'nl' || this.at(';');
  }

  private skipNewlines(): void {
    while (this.peek().k === 'nl') this.i++;
  }

  get done(): boolean {
    return this.peek().k === 'eof';
  }

  /** Skips past the rest of the line after a syntax error, as bc does. */
  recover(): void {
    while (!this.done && this.peek().k !== 'nl') this.i++;
  }

  /** The next top-level statement, or null for a bare separator. */
  next(): Stmt | null {
    if (this.separator()) return (this.i++, null);
    const s = this.statement();
    if (!this.separator() && !this.done) throw new BcSyntaxError(this.peek().line);
    return s;
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.k === 'str') return (this.i++, { t: 'str', s: t.v });
    if (this.at('{')) {
      this.i++;
      const body: Stmt[] = [];
      for (;;) {
        while (this.separator()) this.i++;
        if (this.at('}')) return (this.i++, { t: 'block', body });
        if (this.done) throw new BcSyntaxError(t.line);
        body.push(this.statement());
        if (!this.separator() && !this.at('}')) throw new BcSyntaxError(this.peek().line);
      }
    }
    if (t.k !== 'name' || !KEYWORDS.has(t.v)) return { t: 'expr', e: this.expr() };
    this.i++;
    switch (t.v) {
      case 'if': {
        const cond = this.condition();
        const then = this.statement();
        let n = 0;
        while (this.peek(n).k === 'nl') n++;
        if (!this.at('else', n)) return { t: 'if', cond, then };
        this.i += n + 1;
        this.skipNewlines();
        return { t: 'if', cond, then, otherwise: this.statement() };
      }
      case 'while':
        return { t: 'while', cond: this.condition(), body: this.statement() };
      case 'for': {
        this.eat('(');
        const init = this.at(';') ? undefined : this.expr();
        this.eat(';');
        const cond = this.at(';') ? undefined : this.expr();
        this.eat(';');
        const step = this.at(')') ? undefined : this.expr();
        this.eat(')');
        this.skipNewlines();
        return { t: 'for', init, cond, step, body: this.statement() };
      }
      case 'print': {
        const items: (Expr | string)[] = [];
        for (;;) {
          const tok = this.peek();
          items.push(tok.k === 'str' ? (this.i++, tok.v) : this.expr());
          if (!this.at(',')) return { t: 'print', items };
          this.i++;
        }
      }
      case 'break': case 'continue': case 'quit': case 'halt':
        return { t: t.v };
      default:
        throw new BcSyntaxError(t.line);
    }
  }

  private condition(): Expr {
    this.eat('(');
    const cond = this.expr();
    this.eat(')');
    this.skipNewlines();
    return cond;
  }

  expr(): Expr {
    return this.binary(['||'], () => this.binary(['&&'], () => this.not()));
  }

  private binary(ops: string[], operand: () => Expr): Expr {
    let l = operand();
    while (ops.some((o) => this.at(o))) {
      const op = this.toks[this.i++].v;
      l = { t: 'bin', op, l, r: operand() };
    }
    return l;
  }

  private not(): Expr {
    if (this.at('!')) return (this.i++, { t: 'not', e: this.not() });
    const l = this.assign();
    if (!RELATIONAL.has(this.peek().v) || this.peek().k !== 'op') return l;
    const op = this.toks[this.i++].v;
    return { t: 'bin', op, l, r: this.assign() };
  }

  private assign(): Expr {
    const t = this.peek();
    if (t.k === 'name' && !KEYWORDS.has(t.v) && this.peek(1).k === 'op' && ASSIGN.has(this.peek(1).v)) {
      this.i += 2;
      return { t: 'assign', name: t.v, op: this.toks[this.i - 1].v, value: this.assign() };
    }
    return this.binary(['+', '-'], () => this.binary(['*', '/', '%'], () => this.power()));
  }

  private power(): Expr {
    const base = this.unary();
    if (!this.at('^')) return base;
    this.i++;
    return { t: 'bin', op: '^', l: base, r: this.power() };
  }

  private unary(): Expr {
    if (this.at('-')) return (this.i++, { t: 'neg', e: this.unary() });
    if (this.at('++') || this.at('--')) {
      const delta = this.toks[this.i++].v === '++' ? 1 : -1;
      const name = this.peek();
      if (name.k !== 'name' || KEYWORDS.has(name.v)) throw new BcSyntaxError(name.line);
      return (this.i++, { t: 'step', name: name.v, delta, prefix: true });
    }
    const e = this.primary();
    if (e.t === 'var' && (this.at('++') || this.at('--'))) return { t: 'step', name: e.name, delta: this.toks[this.i++].v === '++' ? 1 : -1, prefix: false };
    return e;
  }

  private primary(): Expr {
    const t = this.peek();
    this.i++;
    if (t.k === 'num') return { t: 'num', text: t.v };
    if (t.k === 'op' && t.v === '(') {
      const e = this.expr();
      this.eat(')');
      return e;
    }
    if (t.k !== 'name' || KEYWORDS.has(t.v)) throw new BcSyntaxError(t.line);
    if (!this.at('(')) return { t: 'var', name: t.v };
    this.i++;
    const args: Expr[] = [];
    while (!this.at(')')) {
      args.push(this.expr());
      if (!this.at(')')) this.eat(',');
    }
    this.i++;
    return { t: 'call', name: t.v, args };
  }
}
