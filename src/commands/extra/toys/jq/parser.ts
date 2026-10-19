import { ID, lit, type Dep, type FuncDef, type Node, type Pattern, type Program } from './ast.ts';
import { Cursor, index, type StrTok } from './cursor.ts';
import { KEYWORDS, lex } from './lexer.ts';

const CONSTANTS: Record<string, null | boolean> = { null: null, true: true, false: false };
const ASSIGN = ['=', '|=', '+=', '-=', '*=', '/=', '%=', '//='];
const BINARY: Record<string, [number, 'l' | 'r' | 'n']> = {
  '//': [1, 'r'],
  ...Object.fromEntries(ASSIGN.map((op) => [op, [2, 'n']])),
  or: [3, 'l'],
  and: [4, 'l'],
  ...Object.fromEntries(['==', '!=', '<', '<=', '>', '>='].map((op) => [op, [5, 'n']])),
  '+': [6, 'l'],
  '-': [6, 'l'],
  '*': [7, 'l'],
  '/': [7, 'l'],
  '%': [7, 'l'],
};

function binNode(op: string, l: Node, r: Node): Node {
  if (op === '//') return { k: 'alt', l, r };
  if (op === 'and' || op === 'or') return { k: op, l, r };
  return { k: ASSIGN.includes(op) ? 'assign' : 'bin', op, l, r };
}

class Parser extends Cursor {
  pipe(): Node {
    const l = this.comma();
    return this.eatOp('|') ? { k: 'pipe', l, r: this.pipe() } : l;
  }

  private comma(): Node {
    let l = this.binary(1);
    while (this.eatOp(',')) l = { k: 'comma', l, r: this.binary(1) };
    return l;
  }

  private binOp(): string | null {
    const t = this.peek();
    return (t.t === 'op' || (t.t === 'ident' && (t.v === 'and' || t.v === 'or'))) && t.v in BINARY ? t.v : null;
  }

  protected binary(min: number): Node {
    let l = this.unary();
    for (let op = this.binOp(); op && BINARY[op][0] >= min; op = this.binOp()) {
      const [prec, assoc] = BINARY[op];
      this.i++;
      l = binNode(op, l, this.binary(assoc === 'r' ? prec : prec + 1));
      const after = this.binOp();
      if (assoc === 'n' && after && BINARY[after][0] === prec) this.fail();
    }
    return l;
  }

  private unary(): Node {
    if (this.eatOp('-')) return { k: 'neg', e: this.unary() };
    const t = this.postfix();
    if (!this.eatKw('as')) return t;
    const pat = this.pattern();
    const alts: Pattern[] = [];
    while (this.eatOp('?//')) alts.push(this.pattern());
    this.expectOp('|');
    return { k: 'bind', src: t, pat, alts, body: this.pipe() };
  }

  private postfix(): Node {
    let t = this.primary();
    for (;;) {
      const tok = this.peek();
      if (tok.t === 'field') {
        this.i++;
        t = index(t, lit(tok.v));
      } else if (this.isOp('.') && this.peek(1).t === 'str') {
        this.i++;
        t = index(t, this.string(this.next() as StrTok, null));
      } else if (this.isOp('.') && this.isOp('[', 1)) {
        this.i++;
        t = this.bracket(t);
      } else if (this.isOp('[')) t = this.bracket(t);
      else if (this.eatOp('?')) t = { k: 'try', body: t, handler: null };
      else return t;
    }
  }

  private bracket(t: Node): Node {
    this.expectOp('[');
    if (this.eatOp(']')) return { k: 'iter', t };
    const from = this.isOp(':') ? null : this.pipe();
    if (!this.eatOp(':')) {
      this.expectOp(']');
      return index(t, from!);
    }
    const to = this.isOp(']') ? null : this.pipe();
    this.expectOp(']');
    return { k: 'slice', t, from, to };
  }

  private primary(): Node {
    const tok = this.next();
    switch (tok.t) {
      case 'num': return lit(tok.v);
      case 'str': return this.string(tok, null);
      case 'fmt': return this.peek().t === 'str' ? this.string(this.next() as StrTok, tok.v) : { k: 'fmt', name: tok.v };
      case 'field': return index(ID, lit(tok.v));
      case 'var': return tok.v === '__loc__' ? this.loc(tok.pos) : { k: 'var', name: tok.v, pos: tok.pos };
      case 'ident': return this.word(tok.v, tok.pos);
      case 'op':
        if (tok.v === '.') return this.peek().t === 'str' ? index(ID, this.string(this.next() as StrTok, null)) : ID;
        if (tok.v === '..') return { k: 'call', name: 'recurse', args: [], pos: tok.pos };
        if (tok.v === '-') return { k: 'neg', e: this.postfix() };
        if (tok.v === '{') return this.object();
        if (tok.v === '[' && this.eatOp(']')) return { k: 'arr', e: null };
        if (tok.v === '(' || tok.v === '[') {
          const e = this.pipe();
          this.expectOp(tok.v === '(' ? ')' : ']');
          return tok.v === '(' ? e : { k: 'arr', e };
        }
    }
    return this.fail(tok);
  }

  private word(name: string, pos: number): Node {
    switch (name) {
      case 'if': return this.ifRest();
      case 'try': {
        const body = this.postfix();
        return { k: 'try', body, handler: this.eatKw('catch') ? this.postfix() : null };
      }
      case 'reduce':
      case 'foreach': {
        const src = this.postfix();
        this.expectKw('as');
        const pat = this.pattern();
        this.expectOp('(');
        const init = this.pipe();
        this.expectOp(';');
        const update = this.pipe();
        const extract = name === 'foreach' && this.eatOp(';') ? this.pipe() : null;
        this.expectOp(')');
        return name === 'reduce' ? { k: 'reduce', src, pat, init, update } : { k: 'foreach', src, pat, init, update, extract };
      }
      case 'label':
      case 'break': {
        const v = this.next();
        if (v.t !== 'var') this.fail(v);
        if (name === 'break') return { k: 'break', name: v.v, pos };
        this.expectOp('|');
        return { k: 'label', name: v.v, body: this.pipe() };
      }
      case 'def': {
        const fn = this.funcDef();
        return { k: 'def', fn, body: this.peek().t === 'eof' ? ID : this.pipe() };
      }
    }
    if (KEYWORDS.has(name)) this.fail(this.peek(-1));
    if (Object.hasOwn(CONSTANTS, name) && !this.isOp('(')) return lit(CONSTANTS[name]);
    const args: Node[] = [];
    if (this.eatOp('(')) {
      do args.push(this.pipe());
      while (this.eatOp(';'));
      this.expectOp(')');
    }
    return { k: 'call', name, args, pos };
  }

  private ifRest(): Node {
    const cond = this.pipe();
    this.expectKw('then');
    const then = this.pipe();
    if (this.eatKw('elif')) return { k: 'if', cond, then, else: this.ifRest() };
    const otherwise = this.eatKw('else') ? this.pipe() : null;
    this.expectKw('end');
    return { k: 'if', cond, then, else: otherwise };
  }

  funcDef(): FuncDef {
    const name = this.next();
    if (name.t !== 'ident' || KEYWORDS.has(name.v)) return this.fail(name);
    const params: string[] = [];
    if (this.eatOp('(')) {
      do {
        const p = this.next();
        if (p.t === 'var') params.push(`$${p.v}`);
        else if (p.t === 'ident' && !KEYWORDS.has(p.v)) params.push(p.v);
        else this.fail(p);
      } while (this.eatOp(';'));
      this.expectOp(')');
    }
    this.expectOp(':');
    const body = this.pipe();
    this.expectOp(';');
    return { name: name.v, params, body };
  }

  defs(): FuncDef[] {
    const out: FuncDef[] = [];
    while (this.eatKw('def')) out.push(this.funcDef());
    if (this.peek().t !== 'eof') this.fail();
    return out;
  }

  /** `module {...};` then any `import "p" as name [meta];` / `include "p" [meta];` lines. */
  directives(): Pick<Program, 'meta' | 'deps'> {
    let meta: Node | null = null;
    if (this.eatKw('module')) {
      meta = this.constObject();
      this.expectOp(';');
    }
    const deps: Dep[] = [];
    for (let t = this.peek(); t.t === 'ident' && (t.v === 'import' || t.v === 'include'); t = this.peek()) {
      this.i++;
      const path = this.next();
      if (path.t !== 'str' || path.parts.length !== 1 || typeof path.parts[0] !== 'string') this.fail(path);
      let alias: string | null = null;
      let data = false;
      if (t.v === 'import') {
        this.expectKw('as');
        const a = this.next();
        if (a.t !== 'ident' && a.t !== 'var') this.fail(a);
        alias = a.v;
        data = a.t === 'var';
      }
      const depMeta = this.isOp('{') ? this.constObject() : null;
      this.expectOp(';');
      deps.push({ path: path.parts[0] as string, alias, data, meta: depMeta, pos: t.pos });
    }
    return { meta, deps };
  }

  private constObject(): Node {
    const t = this.peek();
    if (!this.eatOp('{')) this.fail(t);
    return this.object();
  }

  protected string(tok: StrTok, fmt: string | null): Node {
    const parts = tok.parts.map((p) => {
      if (typeof p === 'string') return p;
      const sub = new Parser(p, this.src);
      const e = sub.pipe();
      if (sub.peek().t !== 'eof') sub.fail();
      return e;
    });
    return parts.every((p) => typeof p === 'string') ? lit(parts.join('')) : { k: 'str', parts, fmt };
  }
}

export const parseDefs = (src: string): FuncDef[] => new Parser(lex(src).toks, src).defs();

/** A main program: directives, then a filter (which may start with defs). */
export function parseProgram(src: string): Program {
  const p = new Parser(lex(src).toks, src);
  const head = p.directives();
  if (p.peek().t === 'eof') return { ...head, body: ID, defs: [] };
  const body = p.pipe();
  if (p.peek().t !== 'eof') p.fail();
  return { ...head, body, defs: [] };
}

/** A library module: directives, then only function definitions. */
export function parseModule(src: string): Program {
  const p = new Parser(lex(src).toks, src);
  const head = p.directives();
  return { ...head, body: ID, defs: p.defs() };
}
