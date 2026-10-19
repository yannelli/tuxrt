import type { CondWord, Node, Redir } from './ast.ts';
import { TokenCursor } from './cursor.ts';
import { tokenize, type Token } from './lexer.ts';

const TERMINATORS = new Set(['then', 'elif', 'else', 'fi', 'do', 'done', 'esac', '}']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

export function parse(src: string): Node {
  return new Parser(tokenize(src)).program();
}

class Parser extends TokenCursor {
  program(): Node {
    const node = this.list();
    const t = this.peek();
    if (t.t !== 'eof') this.unexpected(t);
    return node;
  }

  private atListEnd(): boolean {
    const t = this.peek();
    if (t.t === 'eof') return true;
    if (t.t === 'op') return t.v === ')' || t.v === ';;';
    return t.t === 'word' && TERMINATORS.has(t.v);
  }

  private list(): Node {
    const items: Node[] = [];
    this.skipNewlines();
    while (!this.atListEnd()) {
      let node = this.andOr();
      if (this.isOp('&')) {
        this.pos++;
        node = { type: 'bg', body: node };
      } else if (this.isOp(';') || this.isOp('\n')) this.pos++;
      else {
        items.push(node);
        break;
      }
      items.push(node);
      this.skipNewlines();
    }
    return items.length === 1 ? items[0] : { type: 'seq', items };
  }

  private andOr(): Node {
    let left = this.pipeline();
    while (this.isOp('&&') || this.isOp('||')) {
      const op = (this.tokens[this.pos++] as { v: string }).v;
      this.skipNewlines();
      left = { type: op === '&&' ? 'and' : 'or', left, right: this.pipeline() };
    }
    return left;
  }

  private pipeline(): Node {
    let negate = false;
    while (this.isWord('!')) {
      this.pos++;
      negate = !negate;
    }
    const cmds = [this.command()];
    while (this.isOp('|') || this.isOp('|&')) {
      if (this.isOp('|&')) cmds[cmds.length - 1] = withRedirs(cmds.at(-1)!, [{ fd: 2, op: '>&', target: '1' }]);
      this.pos++;
      this.skipNewlines();
      cmds.push(this.command());
    }
    const node: Node = cmds.length === 1 ? cmds[0] : { type: 'pipe', cmds };
    return negate ? { type: 'not', body: node } : node;
  }

  private command(): Node {
    const t = this.peek();
    let node: Node | null = null;
    if (t.t === 'op' && t.v === '(') {
      this.pos++;
      node = { type: 'subshell', body: this.list() };
      if (!this.isOp(')')) this.unexpected(this.peek());
      this.pos++;
    } else if (t.t === 'word') {
      node = this.compound(t.v);
      if (!node && NAME.test(t.v) && this.isOp('(', 1) && this.isOp(')', 2)) {
        this.pos += 3;
        this.skipNewlines();
        return { type: 'func', name: t.v, body: this.command() };
      }
    }
    if (!node) return this.simple();
    const redirs = this.redirects();
    return redirs.length ? { type: 'redirect', body: node, redirs } : node;
  }

  private compound(word: string): Node | null {
    switch (word) {
      case '{': {
        this.pos++;
        const body = this.list();
        this.expectWord('}');
        return { type: 'group', body };
      }
      case 'if':
        return this.ifClause();
      case 'while':
      case 'until': {
        this.pos++;
        const cond = this.list();
        this.expectWord('do');
        const body = this.list();
        this.expectWord('done');
        return { type: 'while', cond, body, until: word === 'until' };
      }
      case 'for':
        return this.forClause();
      case 'case':
        return this.caseClause();
      case '[[':
        return this.condCommand();
      case 'function': {
        this.pos++;
        const name = this.peek();
        if (name.t !== 'word') this.unexpected(name);
        this.pos++;
        if (this.isOp('(') && this.isOp(')', 1)) this.pos += 2;
        this.skipNewlines();
        return { type: 'func', name: name.v, body: this.command() };
      }
    }
    return null;
  }

  private condCommand(): Node {
    this.pos++;
    const words: CondWord[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') this.unexpected(t);
      this.pos++;
      if (t.t === 'word' && t.v === ']]') return { type: 'cond', words };
      if (words.at(-1)?.raw === '=~' && t.t !== 'redir') {
        words.push({ raw: this.regexOperand(t), op: false });
        continue;
      }
      if (t.t === 'word') words.push({ raw: t.v, op: ['!', '==', '=', '!=', '=~', '-a', '-o'].includes(t.v) });
      else if (t.t === 'op' && ['&&', '||', '(', ')'].includes(t.v)) words.push({ raw: t.v, op: true });
      else if (t.t === 'redir' && (t.op === '<' || t.op === '>')) words.push({ raw: t.op, op: true });
      else if (!(t.t === 'op' && t.v === '\n')) this.unexpected(t);
    }
  }

  /** The RHS of =~ may contain unquoted ( ) |, so glue adjacent tokens back together. */
  private regexOperand(first: { v: string; end?: number }): string {
    let raw = first.v;
    let end = first.end;
    for (let t = this.peek(); t.t !== 'eof' && t.t !== 'redir' && t.at === end && !(t.t === 'word' && t.v === ']]'); t = this.peek()) {
      raw += t.v;
      end = t.end;
      this.pos++;
    }
    return raw;
  }

  private ifClause(): Node {
    const branches: { cond: Node; body: Node }[] = [];
    let otherwise: Node | null = null;
    this.pos++;
    for (;;) {
      const cond = this.list();
      this.expectWord('then');
      branches.push({ cond, body: this.list() });
      if (this.isWord('elif')) {
        this.pos++;
        continue;
      }
      if (this.isWord('else')) {
        this.pos++;
        otherwise = this.list();
      }
      this.expectWord('fi');
      return { type: 'if', branches, otherwise };
    }
  }

  private forClause(): Node {
    this.pos++;
    const name = this.peek();
    if (name.t !== 'word' || !NAME.test(name.v)) this.unexpected(name);
    this.pos++;
    this.skipNewlines();
    let items: string[] | null = null;
    if (this.isWord('in')) {
      this.pos++;
      items = [];
      for (let t = this.peek(); t.t === 'word'; t = this.peek()) {
        items.push(t.v);
        this.pos++;
      }
    }
    if (this.isOp(';')) this.pos++;
    this.skipNewlines();
    this.expectWord('do');
    const body = this.list();
    this.expectWord('done');
    return { type: 'for', name: name.v, items, body };
  }

  private caseClause(): Node {
    this.pos++;
    const word = this.peek();
    if (word.t !== 'word') this.unexpected(word);
    this.pos++;
    this.skipNewlines();
    this.expectWord('in');
    this.skipNewlines();
    const arms: { patterns: string[]; body: Node }[] = [];
    while (!this.isWord('esac')) {
      if (this.isOp('(')) this.pos++;
      const patterns: string[] = [];
      for (;;) {
        const p = this.peek();
        if (p.t !== 'word') this.unexpected(p);
        patterns.push(p.v);
        this.pos++;
        if (!this.isOp('|')) break;
        this.pos++;
      }
      if (!this.isOp(')')) this.unexpected(this.peek());
      this.pos++;
      arms.push({ patterns, body: this.list() });
      if (this.isOp(';;')) this.pos++;
      else if (!this.isWord('esac')) this.unexpected(this.peek());
      this.skipNewlines();
    }
    this.pos++;
    return { type: 'case', word: word.v, arms };
  }

  private redirects(): Redir[] {
    const redirs: Redir[] = [];
    for (let r = this.redirect(); r; r = this.redirect()) redirs.push(r);
    return redirs;
  }

  private redirect(): Redir | null {
    const t = this.peek();
    if (t.t !== 'redir') return null;
    this.pos++;
    if (t.heredoc) return { fd: t.fd, op: t.op, target: t.target ?? '', heredoc: t.heredoc };
    const target = this.peek();
    if (target.t !== 'word') this.unexpected(target);
    this.pos++;
    return { fd: t.fd, op: t.op, target: target.v };
  }

  private simple(): Node {
    const assigns: string[] = [];
    const words: string[] = [];
    const redirs: Redir[] = [];
    for (;;) {
      const r = this.redirect();
      if (r) {
        redirs.push(r);
        continue;
      }
      const t = this.peek();
      if (t.t !== 'word') break;
      this.pos++;
      if (!words.length && ASSIGNMENT.test(t.v)) assigns.push(t.v);
      else words.push(t.v);
    }
    if (!assigns.length && !words.length && !redirs.length) this.unexpected(this.peek());
    return { type: 'cmd', assigns, words, redirs };
  }
}

function withRedirs(node: Node, redirs: Redir[]): Node {
  if (node.type === 'cmd') return { ...node, redirs: [...node.redirs, ...redirs] };
  return { type: 'redirect', body: node, redirs };
}
