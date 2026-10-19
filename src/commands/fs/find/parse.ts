import { dispatch } from '../../../shell/simple.ts';
import type { Ctx } from '../../types.ts';
import { err, msgOf, q } from '../common.ts';
import { FindError, FLAG_TESTS, VALUE_TESTS, type Pred, type Visit } from './tests.ts';

export interface FindState {
  ctx: Ctx;
  status: number;
  /** Set by -prune while evaluating the current file. */
  prune: boolean;
  quit: boolean;
  /** Pending `-exec ... {} +` invocations. */
  batches: { argv: string[]; paths: string[] }[];
}

export interface Expression {
  pred: Pred;
  maxDepth: number;
  minDepth: number;
  depthFirst: boolean;
}

const and = (a: Pred, b: Pred): Pred => async (v) => (await a(v)) && b(v);
const or = (a: Pred, b: Pred): Pred => async (v) => (await a(v)) || b(v);
const not = (a: Pred): Pred => async (v) => !(await a(v));
const BINARY = ['-a', '-and', '-o', '-or'];

export function parseExpression(tokens: string[], state: FindState): Expression {
  const { ctx } = state;
  const expr: Expression = { pred: () => true, maxDepth: Infinity, minDepth: 0, depthFirst: false };
  let pos = 0;
  let hasAction = false;
  let lastTest: string | null = null;
  const arg = (name: string) => {
    if (pos >= tokens.length) throw new FindError(`missing argument to ${q(name)}`);
    return tokens[pos++];
  };
  const depthArg = (name: string) => {
    const v = arg(name);
    if (!/^\d+$/.test(v)) throw new FindError(`Expected a positive decimal integer argument to ${name}, but got ${q(v)}`);
    return Number(v);
  };
  const globalOption = (name: string) => {
    if (lastTest) {
      ctx.stderr.write(
        `find: warning: you have specified the global option ${q(name)} after the argument ${q(lastTest)}, but global options are not positional, i.e., ${q(name)} affects tests specified before it as well as those specified after it.  Please specify global options before other arguments.\n`,
      );
    }
    return () => true;
  };

  const exec = (): Pred => {
    hasAction = true;
    const argv: string[] = [];
    let batch = false;
    for (;;) {
      const t = arg('-exec');
      if (t === ';') break;
      if (t === '+' && argv.at(-1) === '{}') {
        argv.pop();
        batch = true;
        break;
      }
      argv.push(t);
    }
    if (!argv.length) throw new FindError("missing argument to '-exec'");
    const io = { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr };
    if (!batch) return async (v) => (await dispatch(argv.map((a) => a.replaceAll('{}', v.path)), ctx.shell, io)) === 0;
    const pending = { argv, paths: [] as string[] };
    state.batches.push(pending);
    return (v) => (pending.paths.push(v.path), true);
  };

  const remove: Pred = (v) => {
    if (v.path === '.') return true;
    try {
      if (v.st.kind === 'dir') ctx.vfs.rmdir(v.abs);
      else ctx.vfs.unlink(v.abs);
      return true;
    } catch (e) {
      state.status = err(ctx, `cannot delete ${q(v.path)}: ${msgOf(e)}`);
      return false;
    }
  };

  const primary = (): Pred => {
    const tok = tokens[pos++];
    switch (tok) {
      case '-maxdepth':
        expr.maxDepth = depthArg(tok);
        return globalOption(tok);
      case '-mindepth':
        expr.minDepth = depthArg(tok);
        return globalOption(tok);
      case '-depth':
      case '-d':
        expr.depthFirst = true;
        return globalOption(tok);
      case '-xdev':
      case '-mount':
      case '-noleaf':
        return globalOption(tok);
      case '-print':
      case '-print0': {
        hasAction = true;
        const end = tok === '-print' ? '\n' : '\0';
        return (v: Visit) => (ctx.stdout.write(v.path + end), true);
      }
      case '-delete':
        hasAction = true;
        expr.depthFirst = true;
        return remove;
      case '-exec':
        return exec();
      case '-prune':
        return (v: Visit) => ((state.prune = v.st.kind === 'dir' && !expr.depthFirst), true);
      case '-quit':
        return () => ((state.quit = true), true);
    }
    lastTest = tok;
    if (VALUE_TESTS[tok]) return VALUE_TESTS[tok](arg(tok), ctx, tok);
    if (FLAG_TESTS[tok]) return FLAG_TESTS[tok](ctx);
    if (!tok.startsWith('-') || tok === '-') throw new FindError(`paths must precede expression: ${q(tok)}`);
    throw new FindError(`unknown predicate ${q(tok)}`);
  };

  const unary = (): Pred => {
    const tok = tokens[pos];
    if (tok === undefined) throw new FindError(`expected an expression after ${q(tokens[pos - 1])}`);
    if (BINARY.includes(tok)) throw new FindError(`invalid expression; you have used a binary operator ${q(tok)} with nothing before it.`);
    if (tok === ')') throw new FindError("invalid expression; you have too many ')'");
    if (tok === '!' || tok === '-not') {
      pos++;
      return not(unary());
    }
    if (tok !== '(') return primary();
    pos++;
    if (tokens[pos] === ')') throw new FindError('invalid expression; empty parentheses are not allowed.');
    const inner = disjunction();
    if (tokens[pos++] !== ')') throw new FindError("invalid expression; I was expecting to find a ')' somewhere but did not see one.");
    return inner;
  };

  const conjunction = (): Pred => {
    let left = unary();
    while (pos < tokens.length && !['-o', '-or', ')'].includes(tokens[pos])) {
      if (tokens[pos] === '-a' || tokens[pos] === '-and') pos++;
      left = and(left, unary());
    }
    return left;
  };

  const disjunction = (): Pred => {
    let left = conjunction();
    while (tokens[pos] === '-o' || tokens[pos] === '-or') {
      pos++;
      left = or(left, conjunction());
    }
    return left;
  };

  if (tokens.length) {
    expr.pred = disjunction();
    if (pos < tokens.length) throw new FindError("invalid expression; you have too many ')'");
  }
  if (!hasAction) expr.pred = and(expr.pred, (v) => (ctx.stdout.write(`${v.path}\n`), true));
  return expr;
}
