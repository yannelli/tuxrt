import { IncompleteInput, type Heredoc, type RedirOp } from './ast.ts';

export type Token =
  | { t: 'word'; v: string; at?: number; end?: number }
  | { t: 'op'; v: string; at?: number; end?: number }
  | { t: 'redir'; op: RedirOp; fd: number | null; target?: string; heredoc?: Heredoc }
  | { t: 'eof' };

const OPS = ['&&', '||', ';;', '|&', '|', ';', '&', '(', ')', '\n'];
const REDIRS: RedirOp[] = ['<<<', '<<-', '&>>', '<<', '>>', '>&', '<&', '&>', '>|', '<>', '<', '>'];
const META = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')']);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const pending: { delim: string; strip: boolean; doc: Heredoc }[] = [];
  let i = 0;

  const readHeredocBodies = () => {
    for (const p of pending) {
      const lines: string[] = [];
      for (;;) {
        if (i >= src.length) throw new IncompleteInput('here-document');
        const end = src.indexOf('\n', i);
        let line = end === -1 ? src.slice(i) : src.slice(i, end);
        i = end === -1 ? src.length : end + 1;
        if (p.strip) line = line.replace(/^\t+/, '');
        if (line === p.delim) break;
        lines.push(line);
        if (end === -1) throw new IncompleteInput('here-document');
      }
      p.doc.body = lines.length ? `${lines.join('\n')}\n` : '';
    }
    pending.length = 0;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const redir = REDIRS.find((r) => src.startsWith(r, i));
    if (redir) {
      i += redir.length;
      const prev = tokens.at(-1);
      let fd: number | null = null;
      if (prev?.t === 'word' && /^\d$/.test(prev.v) && src[i - redir.length - 1] === prev.v) {
        tokens.pop();
        fd = Number(prev.v);
      }
      if (redir === '<<' || redir === '<<-') {
        while (src[i] === ' ' || src[i] === '\t') i++;
        const start = i;
        i = scanWord(src, i);
        const raw = src.slice(start, i);
        if (!raw) throw new IncompleteInput('here-document delimiter');
        const doc: Heredoc = { body: '', expand: !/['"\\]/.test(raw) };
        pending.push({ delim: raw.replace(/['"\\]/g, ''), strip: redir === '<<-', doc });
        tokens.push({ t: 'redir', op: redir, fd, target: raw, heredoc: doc });
      } else tokens.push({ t: 'redir', op: redir, fd });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      tokens.push({ t: 'op', v: op, at: i - op.length, end: i });
      if (op === '\n' && pending.length) readHeredocBodies();
      continue;
    }
    const start = i;
    i = scanWord(src, i);
    tokens.push({ t: 'word', v: src.slice(start, i), at: start, end: i });
  }
  if (pending.length) throw new IncompleteInput('here-document');
  tokens.push({ t: 'eof' });
  return tokens;
}

/** Returns the index just past a shell word starting at `i`, honoring quotes and $(...) nesting. */
export function scanWord(src: string, i: number): number {
  while (i < src.length && !META.has(src[i])) i = skipUnit(src, i);
  return i;
}

function skipUnit(src: string, i: number): number {
  const c = src[i];
  if (c === '\\') return i + 1 >= src.length ? fail('escape') : i + 2;
  if (c === "'") {
    const end = src.indexOf("'", i + 1);
    return end === -1 ? fail('quote') : end + 1;
  }
  if (c === '"') {
    i++;
    while (i < src.length && src[i] !== '"') i = src[i] === '\\' ? i + 2 : src[i] === '$' || src[i] === '`' ? skipUnit(src, i) : i + 1;
    return i >= src.length ? fail('quote') : i + 1;
  }
  if (c === '`') {
    i++;
    while (i < src.length && src[i] !== '`') i += src[i] === '\\' ? 2 : 1;
    return i >= src.length ? fail('backquote') : i + 1;
  }
  if (c === '$' && (src[i + 1] === '(' || src[i + 1] === '{')) return skipBalanced(src, i + 1);
  return i + 1;
}

/** Skips a (...) or {...} group starting at `i`, skipping quoted regions. */
export function skipBalanced(src: string, i: number): number {
  const open = src[i];
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
    if (c === "'" || c === '"' || c === '`' || c === '\\' || (c === '$' && (src[i + 1] === '(' || src[i + 1] === '{'))) {
      i = skipUnit(src, i);
      continue;
    }
    i++;
  }
  return fail(open === '(' ? 'parenthesis' : 'brace');
}

function fail(what: string): never {
  throw new IncompleteInput(`unexpected EOF while looking for matching ${what}`);
}
