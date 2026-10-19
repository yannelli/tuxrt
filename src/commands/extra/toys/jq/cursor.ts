import { ID, lit, type Node, type Pattern } from './ast.ts';
import { KEYWORDS, type Tok } from './lexer.ts';
import { CompileError } from './value.ts';

export type StrTok = Extract<Tok, { t: 'str' }>;
type ObjPattern = Extract<Pattern, { k: 'obj' }>;

/** Bison's token names, as they appear in jq's "unexpected ..." messages. */
function tokName(t: Tok): string {
  switch (t.t) {
    case 'eof': return 'end of file';
    case 'num': return 'LITERAL';
    case 'str': return 'QQSTRING_START';
    case 'field': return 'FIELD';
    case 'var': return 'BINDING';
    case 'fmt': return 'FORMAT';
    case 'ident': return KEYWORDS.has(t.v) ? t.v : 'IDENT';
    case 'op': return t.v.length === 1 ? `'${t.v}'` : t.v;
  }
}

export const index = (t: Node, i: Node): Node => ({ k: 'index', t, i });

/** Token navigation plus the object-construction and destructuring grammar. */
export abstract class Cursor {
  protected readonly toks: Tok[];
  protected readonly src: string;
  protected i = 0;

  constructor(toks: Tok[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  abstract pipe(): Node;
  protected abstract binary(min: number): Node;
  protected abstract string(tok: StrTok, fmt: string | null): Node;

  peek(off = 0): Tok {
    return this.toks[Math.max(0, Math.min(this.i + off, this.toks.length - 1))];
  }

  protected next(): Tok {
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1];
  }

  protected isOp(v: string, off = 0): boolean {
    const t = this.peek(off);
    return t.t === 'op' && t.v === v;
  }

  protected eatOp(v: string): boolean {
    if (!this.isOp(v)) return false;
    this.i++;
    return true;
  }

  protected eatKw(v: string): boolean {
    const t = this.peek();
    if (t.t !== 'ident' || t.v !== v) return false;
    this.i++;
    return true;
  }

  protected expectOp(v: string): void {
    if (!this.eatOp(v)) this.fail();
  }

  protected expectKw(v: string): void {
    if (!this.eatKw(v)) this.fail();
  }

  fail(t = this.peek()): never {
    throw new CompileError(`syntax error, unexpected ${tokName(t)}`, t.pos);
  }

  protected loc(pos: number): Node {
    const line = this.src.slice(0, pos).split('\n').length;
    return lit(new Map<string, string | number>([['file', '<top-level>'], ['line', line]]));
  }

  protected object(): Node {
    const entries: { key: Node; val: Node }[] = [];
    while (!this.eatOp('}')) {
      const t = this.next();
      let key: Node;
      let val: Node | null = null;
      if (t.t === 'var' && t.v !== '__loc__' && this.eatOp(':')) {
        key = { k: 'var', name: t.v, pos: t.pos };
        val = this.objVal();
      } else if (t.t === 'var') {
        key = lit(t.v);
        val = t.v === '__loc__' ? this.loc(t.pos) : { k: 'var', name: t.v, pos: t.pos };
      } else if (t.t === 'ident') key = lit(t.v);
      else if (t.t === 'str') key = this.string(t, null);
      else if (t.t === 'fmt' && this.peek().t === 'str') key = this.string(this.next() as StrTok, t.v);
      else if (t.t === 'op' && t.v === '(') {
        key = this.pipe();
        this.expectOp(')');
        this.expectOp(':');
        val = this.objVal();
      } else return this.fail(t);
      entries.push({ key, val: val ?? (this.eatOp(':') ? this.objVal() : index(ID, key)) });
      if (!this.eatOp(',')) {
        this.expectOp('}');
        break;
      }
    }
    return { k: 'obj', entries };
  }

  /** jq restricts object values to pipes of terms; any comma-free expression is accepted here. */
  private objVal(): Node {
    const l = this.binary(1);
    return this.eatOp('|') ? { k: 'pipe', l, r: this.objVal() } : l;
  }

  protected pattern(): Pattern {
    const t = this.next();
    if (t.t === 'var') return { k: 'var', name: t.v, pos: t.pos };
    if (t.t === 'op' && t.v === '[') {
      const items: Pattern[] = [];
      do items.push(this.pattern());
      while (this.eatOp(','));
      this.expectOp(']');
      return { k: 'arr', items };
    }
    if (t.t !== 'op' || t.v !== '{') return this.fail(t);
    const entries: ObjPattern['entries'] = [];
    do entries.push(this.patternEntry());
    while (this.eatOp(','));
    this.expectOp('}');
    return { k: 'obj', entries };
  }

  private patternEntry(): ObjPattern['entries'][number] {
    const k = this.next();
    if (k.t === 'var') return { key: lit(k.v), bind: k.v, pat: this.eatOp(':') ? this.pattern() : null };
    let key: Node;
    if (k.t === 'ident') key = lit(k.v);
    else if (k.t === 'str') key = this.string(k, null);
    else if (k.t === 'op' && k.v === '(') {
      key = this.pipe();
      this.expectOp(')');
    } else return this.fail(k);
    this.expectOp(':');
    return { key, bind: null, pat: this.pattern() };
  }
}
