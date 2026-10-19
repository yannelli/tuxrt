import { globToRegExp } from '../../shell/glob.ts';
import type { Shell } from '../../shell/shell.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { bfail } from '../util.ts';

export interface TestToken {
  s: string;
  /** Unquoted operator position in [[ ]]; for `test` every token may be an operator. */
  op: boolean;
  /** RHS of == / != in [[ ]]: a glob pattern rather than a literal. */
  pattern?: boolean;
}

export class TestError extends Error {}

const UNARY = new Set(['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-b', '-c', '-p', '-S', '-t', '-z', '-n', '-O', '-G', '-u', '-g', '-k', '-v']);
const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef', '=~']);

/** Evaluates test / [ / [[ expressions. Returns true/false; throws TestError on syntax errors. */
export function evalTest(tokens: TestToken[], shell: Shell, extended: boolean): boolean {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (s: string) => peek()?.s === s && peek().op;
  const or = (): boolean => {
    let v = and();
    while (isOp(extended ? '||' : '-o') && tokens.length > pos + 1) {
      pos++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  const and = (): boolean => {
    let v = not();
    while (isOp(extended ? '&&' : '-a') && tokens.length > pos + 1) {
      pos++;
      const r = not();
      v = v && r;
    }
    return v;
  };
  const not = (): boolean => {
    if (isOp('!') && tokens.length > pos + 1) {
      pos++;
      return !not();
    }
    return primary();
  };
  const primary = (): boolean => {
    const t = tokens[pos++];
    if (!t) throw new TestError('argument expected');
    if (t.s === '(' && t.op && tokens.length > pos) {
      const v = or();
      if (!isOp(')')) throw new TestError("')' expected");
      pos++;
      return v;
    }
    const next = tokens[pos];
    if (next && next.op && BINARY.has(next.s) && tokens[pos + 1] && !(UNARY.has(t.s) && t.op && tokens.length - pos === 1)) {
      pos += 2;
      return binary(t.s, next.s, tokens[pos - 1], shell, extended);
    }
    if (t.op && UNARY.has(t.s) && next) {
      pos++;
      return unary(t.s, next.s, shell);
    }
    return t.s !== '';
  };
  if (!tokens.length) return false;
  const result = or();
  if (pos < tokens.length) throw new TestError(`${tokens[pos].s}: unexpected operator`);
  return result;
}

function unary(op: string, arg: string, shell: Shell): boolean {
  if (op === '-z') return arg === '';
  if (op === '-n') return arg !== '';
  if (op === '-t') return arg === '0' || arg === '1' ? shell.interactive : false;
  if (op === '-v') return shell.get(arg) !== undefined;
  const path = shell.abs(arg);
  const { vfs } = shell;
  const node = vfs.tryLookup(path, op !== '-L' && op !== '-h');
  if (!node || arg === '') return false;
  switch (op) {
    case '-e': return true;
    case '-f': return node.kind === 'file';
    case '-d': return node.kind === 'dir';
    case '-L':
    case '-h': return node.kind === 'symlink';
    case '-r': return vfs.access(path, 'r');
    case '-w': return vfs.access(path, 'w');
    case '-x': return vfs.access(path, 'x');
    case '-s': return vfs.stat(path).size > 0;
    case '-c': return path.startsWith('/dev/') && node.kind === 'file';
    case '-O': return node.uid === shell.user.uid;
    case '-G': return node.gid === shell.user.gid;
    case '-u': return (node.mode & 0o4000) !== 0;
    case '-g': return (node.mode & 0o2000) !== 0;
    case '-k': return (node.mode & 0o1000) !== 0;
  }
  return false;
}

function integer(s: string): number {
  if (!/^\s*[-+]?\d+\s*$/.test(s)) throw new TestError(`${s}: integer expression expected`);
  return Number(s);
}

function binary(a: string, op: string, bTok: TestToken, shell: Shell, extended: boolean): boolean {
  const b = bTok.s;
  switch (op) {
    case '=':
    case '==':
    case '!=': {
      const eq = extended && bTok.pattern ? globToRegExp(b).test(a) : a === b;
      return op === '!=' ? !eq : eq;
    }
    case '=~': {
      let m: RegExpExecArray | null;
      try {
        m = new RegExp(b).exec(a);
      } catch {
        throw new TestError(`invalid regular expression \`${b}'`);
      }
      shell.set('BASH_REMATCH', m?.[0] ?? '');
      m?.forEach((g, i) => shell.set(`BASH_REMATCH_${i}`, g ?? ''));
      return m !== null;
    }
    case '<': return a < b;
    case '>': return a > b;
    case '-eq': return integer(a) === integer(b);
    case '-ne': return integer(a) !== integer(b);
    case '-lt': return integer(a) < integer(b);
    case '-le': return integer(a) <= integer(b);
    case '-gt': return integer(a) > integer(b);
    case '-ge': return integer(a) >= integer(b);
  }
  const sa = shell.vfs.tryLookup(shell.abs(a));
  const sb = shell.vfs.tryLookup(shell.abs(b));
  if (op === '-nt') return !!sa && (!sb || sa.mtime > sb.mtime);
  if (op === '-ot') return !!sb && (!sa || sa.mtime < sb.mtime);
  return !!sa && sa === sb;
}

function test(ctx: Ctx): number {
  let args = ctx.args;
  if (ctx.name === '[') {
    if (args.at(-1) !== ']') return bfail(ctx, "missing `]'", 2);
    args = args.slice(0, -1);
  }
  try {
    return evalTest(args.map((s) => ({ s, op: true })), ctx.shell, false) ? 0 : 1;
  } catch (e) {
    return bfail(ctx, (e as Error).message, 2);
  }
}

export const testBuiltins: CommandTable = {
  test: { fn: test, builtin: true, stub: true, desc: 'Evaluate conditional expression' },
  '[': { fn: test, builtin: true, stub: true, desc: 'Evaluate conditional expression' },
};
