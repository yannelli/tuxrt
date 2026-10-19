import { IncompleteInput, ShellSyntaxError } from './ast.ts';
import type { Token } from './lexer.ts';

/** Token-stream primitives shared by the parser. */
export class TokenCursor {
  protected pos = 0;
  protected readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  protected peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  protected isOp(v: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.t === 'op' && t.v === v;
  }

  protected isWord(v: string): boolean {
    const t = this.peek();
    return t.t === 'word' && t.v === v;
  }

  protected unexpected(t: Token): never {
    if (t.t === 'eof') throw new IncompleteInput('syntax error: unexpected end of file');
    const text = t.t === 'redir' ? t.op : t.v === '\n' ? 'newline' : t.v;
    throw new ShellSyntaxError(`syntax error near unexpected token \`${text}'`);
  }

  protected expectWord(v: string): void {
    if (!this.isWord(v)) this.unexpected(this.peek());
    this.pos++;
  }

  protected skipNewlines(): void {
    while (this.isOp('\n')) this.pos++;
  }
}
