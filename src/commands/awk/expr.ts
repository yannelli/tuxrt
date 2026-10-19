import { isLValue, type Expr, type LValue, type Ref } from './ast.ts';
import { AwkSyntaxError, type Token } from './lexer.ts';

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^=']);
const COMPARE_OPS = new Set(['<', '<=', '==', '!=', '>', '>=']);
const MUL_OPS = new Set(['*', '/', '%']);
const CONCAT_START = new Set(['num', 'str', 'ere', 'name', 'funcname', 'builtin', '$', '(', '++', '--']);

/** Expression grammar, lowest to highest: assignment, ?:, ||, &&, in, ~, comparison, | getline, concatenation, + -, * / %, unary, ^, ++ --, $. */
export class ExprParser {
  protected readonly toks: Token[];
  protected pos = 0;
  /** Parameter names of the function being parsed; they resolve to frame slots. */
  protected params: string[] | null = null;
  /** In unparenthesized print arguments `>` is a redirection, not a comparison. */
  protected noGt = false;
  protected readonly calls: Token[] = [];

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  protected get tok(): Token {
    return this.toks[this.pos];
  }

  protected peek(n = 1): Token {
    return this.toks[Math.min(this.pos + n, this.toks.length - 1)];
  }

  protected is(t: string): boolean {
    return this.tok.t === t;
  }

  protected accept(t: string): boolean {
    if (!this.is(t)) return false;
    this.pos++;
    return true;
  }

  protected expect(t: string): Token {
    if (!this.is(t)) throw this.error();
    return this.toks[this.pos++];
  }

  protected optNl(): void {
    while (this.accept('nl'));
  }

  protected error(tok = this.tok): AwkSyntaxError {
    const near = tok.t === 'eof' ? 'end of file' : tok.t === 'nl' ? 'end of line' : tok.t === 'str' ? `"${tok.v}"` : tok.t === 'ere' ? `/${tok.v}/` : tok.v;
    return new AwkSyntaxError(`syntax error at or near ${near}`, tok.line);
  }

  /** Parses with `>` meaning comparison again (inside parentheses, brackets and call arguments). */
  protected nested<T>(fn: () => T): T {
    const saved = this.noGt;
    this.noGt = false;
    try {
      return fn();
    } finally {
      this.noGt = saved;
    }
  }

  protected exprList(): Expr[] {
    const list = [this.expr()];
    while (this.accept(',')) {
      this.optNl();
      list.push(this.expr());
    }
    return list;
  }

  expr(): Expr {
    const left = this.ternary();
    const op = this.tok.t;
    if (!ASSIGN_OPS.has(op) || !isLValue(left)) return left;
    this.pos++;
    this.optNl();
    return { k: 'assign', op, target: left, e: this.expr() };
  }

  private ternary(): Expr {
    const c = this.or();
    if (!this.accept('?')) return c;
    this.optNl();
    const t = this.expr();
    this.optNl();
    this.expect(':');
    this.optNl();
    return { k: 'cond', c, t, f: this.expr() };
  }

  private or(): Expr {
    let l = this.and();
    while (this.accept('||')) {
      this.optNl();
      l = { k: 'or', l, r: this.and() };
    }
    return l;
  }

  private and(): Expr {
    let l = this.inExpr();
    while (this.accept('&&')) {
      this.optNl();
      l = { k: 'and', l, r: this.inExpr() };
    }
    return l;
  }

  private inExpr(): Expr {
    let l = this.match();
    while (this.accept('in')) l = { k: 'in', subs: [l], arr: this.arrayRef() };
    return l;
  }

  private match(): Expr {
    let l = this.compare();
    while (this.is('~') || this.is('!~')) {
      const neg = this.toks[this.pos++].t === '!~';
      l = { k: 'match', neg, l, r: this.compare() };
    }
    return l;
  }

  private compare(): Expr {
    let l = this.pipeGetline();
    while (COMPARE_OPS.has(this.tok.t) && !(this.noGt && this.is('>'))) {
      const op = this.toks[this.pos++].t;
      l = { k: 'binary', op, l, r: this.pipeGetline() };
    }
    return l;
  }

  private pipeGetline(): Expr {
    let l = this.concat();
    while (this.is('|') && this.peek().t === 'getline') {
      this.pos += 2;
      l = { k: 'getline', from: 'cmd', src: l, target: this.optLValue() };
    }
    return l;
  }

  protected concat(): Expr {
    let l = this.additive();
    while (CONCAT_START.has(this.tok.t)) l = { k: 'binary', op: ' ', l, r: this.additive() };
    return l;
  }

  private additive(): Expr {
    let l = this.mul();
    while (this.is('+') || this.is('-')) {
      const op = this.toks[this.pos++].t;
      l = { k: 'binary', op, l, r: this.mul() };
    }
    return l;
  }

  private mul(): Expr {
    let l = this.unary();
    while (MUL_OPS.has(this.tok.t)) {
      const op = this.toks[this.pos++].t;
      l = { k: 'binary', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Expr {
    const op = this.tok.t;
    if (op !== '!' && op !== '-' && op !== '+') return this.power();
    this.pos++;
    return { k: 'unary', op, e: this.unary() };
  }

  private power(): Expr {
    const base = this.postfix();
    if (!this.accept('^')) return base;
    return { k: 'binary', op: '^', l: base, r: this.unary() };
  }

  private postfix(): Expr {
    const e = this.primary();
    if (!(this.is('++') || this.is('--')) || !isLValue(e)) return e;
    return { k: 'incdec', op: this.toks[this.pos++].t, pre: false, target: e };
  }

  protected primary(): Expr {
    const tok = this.tok;
    switch (tok.t) {
      case 'num':
        this.pos++;
        return { k: 'num', v: Number(tok.v) };
      case 'str':
        this.pos++;
        return { k: 'str', v: tok.v };
      case 'ere':
        this.pos++;
        return { k: 'regex', src: tok.v };
      case '$':
        this.pos++;
        return { k: 'field', e: this.primary() };
      case '++':
      case '--': {
        this.pos++;
        const target = this.primary();
        if (!isLValue(target)) throw this.error();
        return { k: 'incdec', op: tok.t, pre: true, target };
      }
      case '!':
      case '-':
      case '+':
        return this.unary();
      case '(':
        return this.paren();
      case 'name':
        return this.nameRef();
      case 'funcname':
        this.pos++;
        this.calls.push(tok);
        return { k: 'call', name: tok.v, args: this.args() };
      case 'builtin':
        this.pos++;
        if (this.is('(')) return { k: 'builtin', name: tok.v, args: this.args() };
        if (tok.v !== 'length') throw this.error();
        return { k: 'builtin', name: tok.v, args: [] };
      case 'getline': {
        this.pos++;
        const target = this.optLValue();
        if (this.accept('<')) return { k: 'getline', from: 'file', target, src: this.primary() };
        return { k: 'getline', from: 'main', target };
      }
    }
    throw this.error();
  }

  private paren(): Expr {
    this.pos++;
    const items = this.nested(() => this.exprList());
    this.optNl();
    this.expect(')');
    if (items.length === 1) return items[0];
    this.expect('in');
    return { k: 'in', subs: items, arr: this.arrayRef() };
  }

  private nameRef(): Expr {
    const ref = this.ref(this.toks[this.pos++].v);
    return this.accept('[') ? { k: 'index', arr: ref, subs: this.subscripts() } : ref;
  }

  protected subscripts(): Expr[] {
    const subs = this.nested(() => this.exprList());
    this.expect(']');
    return subs;
  }

  private args(): Expr[] {
    this.expect('(');
    this.optNl();
    const args = this.is(')') ? [] : this.nested(() => this.exprList());
    this.optNl();
    this.expect(')');
    return args;
  }

  protected ref(name: string): Ref {
    const i = this.params?.indexOf(name) ?? -1;
    return i >= 0 ? { k: 'local', i, name } : { k: 'var', name };
  }

  protected arrayRef(): Ref {
    return this.ref(this.expect('name').v);
  }

  private optLValue(): LValue | undefined {
    if (!this.is('name') && !this.is('$')) return undefined;
    const e = this.primary();
    if (!isLValue(e)) throw this.error();
    return e;
  }
}
