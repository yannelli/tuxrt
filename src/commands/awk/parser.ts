import type { Expr, Program, Redir, Stmt } from './ast.ts';
import { ExprParser } from './expr.ts';
import { AwkSyntaxError, lex } from './lexer.ts';

const TERMINATORS = new Set([';', 'nl', '}', 'eof']);
const REDIRS = new Set(['>', '>>', '|']);
const EMPTY: Stmt = { k: 'block', body: [] };

class Parser extends ExprParser {
  program(): Program {
    const prog: Program = { begin: [], end: [], rules: [], funcs: new Map() };
    this.skipTerms();
    while (!this.is('eof')) {
      this.item(prog);
      this.skipTerms();
    }
    for (const call of this.calls) {
      if (!prog.funcs.has(call.v)) throw new AwkSyntaxError(`function ${call.v} never defined`, call.line);
    }
    return prog;
  }

  private skipTerms(): void {
    while (this.is('nl') || this.is(';')) this.pos++;
  }

  private item(prog: Program): void {
    const t = this.tok.t;
    if (t === 'BEGIN' || t === 'END') {
      this.pos++;
      (t === 'BEGIN' ? prog.begin : prog.end).push(this.block());
    } else if (t === 'function') this.func(prog);
    else if (t === '{') prog.rules.push({ body: this.block(), inRange: false });
    else {
      const pattern = this.expr();
      let end: Expr | undefined;
      if (this.accept(',')) {
        this.optNl();
        end = this.expr();
      }
      prog.rules.push({ pattern, end, body: this.is('{') ? this.block() : undefined, inRange: false });
    }
  }

  private func(prog: Program): void {
    this.pos++;
    const name = this.tok;
    if (name.t !== 'name' && name.t !== 'funcname') throw this.error();
    this.pos++;
    this.expect('(');
    const params: string[] = [];
    this.optNl();
    while (!this.accept(')')) {
      if (params.length) this.expect(',');
      this.optNl();
      params.push(this.expect('name').v);
      this.optNl();
    }
    this.optNl();
    if (prog.funcs.has(name.v)) throw new AwkSyntaxError(`function ${name.v} redefined`, name.line);
    this.params = params;
    prog.funcs.set(name.v, { params, body: this.block() });
    this.params = null;
  }

  private block(): Stmt[] {
    this.expect('{');
    const body: Stmt[] = [];
    this.skipTerms();
    while (!this.accept('}')) {
      if (this.is('eof')) throw this.error();
      body.push(this.statement());
      this.skipTerms();
    }
    return body;
  }

  private statement(): Stmt {
    switch (this.tok.t) {
      case '{':
        return { k: 'block', body: this.block() };
      case ';':
        this.pos++;
        return EMPTY;
      case 'if':
        return this.ifStmt();
      case 'while': {
        this.pos++;
        const c = this.cond();
        if (this.accept(';')) return { k: 'while', c, body: EMPTY };
        this.optNl();
        return { k: 'while', c, body: this.statement() };
      }
      case 'do': {
        this.pos++;
        this.optNl();
        const body = this.statement();
        this.skipTerms();
        this.expect('while');
        const c = this.cond();
        this.endSimple();
        return { k: 'do', body, c };
      }
      case 'for':
        return this.forStmt();
    }
    const s = this.simple();
    this.endSimple();
    return s;
  }

  private endSimple(): void {
    if (this.is(';') || this.is('nl')) this.pos++;
    else if (!this.is('}') && !this.is('eof')) throw this.error();
  }

  private cond(): Expr {
    this.expect('(');
    const c = this.expr();
    this.optNl();
    this.expect(')');
    return c;
  }

  private ifStmt(): Stmt {
    this.pos++;
    const c = this.cond();
    this.optNl();
    const t = this.statement();
    const save = this.pos;
    this.skipTerms();
    if (!this.accept('else')) {
      this.pos = save;
      return { k: 'if', c, t };
    }
    this.optNl();
    return { k: 'if', c, t, f: this.statement() };
  }

  private forStmt(): Stmt {
    this.pos++;
    this.expect('(');
    if (this.is('name') && this.peek().t === 'in' && this.peek(2).t === 'name' && this.peek(3).t === ')') {
      const v = this.ref(this.tok.v);
      this.pos += 2;
      const arr = this.arrayRef();
      this.expect(')');
      this.optNl();
      return { k: 'forin', v, arr, body: this.statement() };
    }
    const init = this.is(';') ? undefined : this.expr();
    this.expect(';');
    this.optNl();
    const c = this.is(';') ? undefined : this.expr();
    this.expect(';');
    this.optNl();
    const step = this.is(')') ? undefined : this.expr();
    this.expect(')');
    if (this.accept(';')) return { k: 'for', init, c, step, body: EMPTY };
    this.optNl();
    return { k: 'for', init, c, step, body: this.statement() };
  }

  private simple(): Stmt {
    const t = this.tok.t;
    switch (t) {
      case 'print':
      case 'printf':
        return this.print(t);
      case 'next':
      case 'nextfile':
      case 'break':
      case 'continue':
        this.pos++;
        return { k: 'jump', op: t };
      case 'return':
        if (!this.params) throw this.error();
      // falls through
      case 'exit':
        this.pos++;
        return { k: t, e: TERMINATORS.has(this.tok.t) ? undefined : this.expr() };
      case 'delete': {
        this.pos++;
        const arr = this.arrayRef();
        return { k: 'delete', arr, subs: this.accept('[') ? this.subscripts() : undefined };
      }
    }
    return { k: 'expr', e: this.expr() };
  }

  private print(k: 'print' | 'printf'): Stmt {
    this.pos++;
    let args: Expr[] = [];
    if (this.is('(') && this.groupedArgs()) {
      this.pos++;
      args = this.nested(() => this.exprList());
      this.optNl();
      this.expect(')');
    } else if (!TERMINATORS.has(this.tok.t) && !REDIRS.has(this.tok.t)) {
      this.noGt = true;
      args = this.exprList();
      this.noGt = false;
    }
    if (k === 'printf' && !args.length) throw this.error();
    let redir: Redir | undefined;
    if (REDIRS.has(this.tok.t)) redir = { op: this.toks[this.pos++].t, e: this.concat() };
    return { k, args, redir };
  }

  /** `print (a, b) > f` groups the argument list; `print (a)(b)` does not. */
  private groupedArgs(): boolean {
    let depth = 0;
    for (let i = this.pos; i < this.toks.length; i++) {
      const t = this.toks[i].t;
      if (t === '(') depth++;
      else if (t === ')' && --depth === 0) return TERMINATORS.has(this.toks[i + 1].t) || REDIRS.has(this.toks[i + 1].t);
      else if (t === 'eof') return false;
    }
    return false;
  }
}

export function parse(src: string): Program {
  return new Parser(lex(src)).program();
}
