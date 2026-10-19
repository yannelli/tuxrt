import { checkpoint } from '../../../shell/interpreter.ts';
import { dispatch } from '../../../shell/simple.ts';
import { basename } from '../../../vfs/path.ts';
import type { Stat } from '../../../vfs/types.ts';
import type { CommandTable, Ctx } from '../../types.ts';
import { command } from '../../util.ts';
import { err, joinPath, msgOf, q, tryStat } from '../common.ts';
import { parseExpression, type Expression, type FindState } from './parse.ts';
import { FindError, type Visit } from './tests.ts';

async function visit(state: FindState, expr: Expression, v: Visit): Promise<void> {
  const { ctx } = state;
  await checkpoint(ctx.shell);
  const matches = v.depth >= expr.minDepth;
  state.prune = false;
  if (matches && !expr.depthFirst) await expr.pred(v);
  const pruned = state.prune;
  if (state.quit) return;
  if (v.st.kind === 'dir' && v.depth < expr.maxDepth && !pruned) {
    let names: string[] = [];
    try {
      names = ctx.vfs.readdir(v.abs);
    } catch (e) {
      state.status = err(ctx, `${q(v.path)}: ${msgOf(e)}`);
    }
    for (const name of names) {
      const abs = joinPath(v.abs, name);
      const st = tryStat(ctx.vfs, abs, false);
      if (st) await visit(state, expr, { path: joinPath(v.path, name), abs, name, st, depth: v.depth + 1 });
      if (state.quit) return;
    }
  }
  if (matches && expr.depthFirst) await expr.pred(v);
}

async function find(ctx: Ctx): Promise<number> {
  const args = ctx.args;
  let i = 0;
  while (i < args.length && /^-[HLP]$/.test(args[i])) i++;
  const paths: string[] = [];
  while (i < args.length && !(args[i].startsWith('-') && args[i].length > 1) && args[i] !== '(' && args[i] !== '!') {
    paths.push(args[i++]);
  }
  const state: FindState = { ctx, status: 0, prune: false, quit: false, batches: [] };
  let expr: Expression;
  try {
    expr = parseExpression(args.slice(i), state);
  } catch (e) {
    if (e instanceof FindError) return err(ctx, e.message);
    throw e;
  }
  for (const path of paths.length ? paths : ['.']) {
    if (state.quit) break;
    const abs = ctx.shell.abs(path);
    let st: Stat;
    try {
      st = ctx.vfs.stat(abs, false);
    } catch (e) {
      state.status = err(ctx, `${q(path)}: ${msgOf(e)}`);
      continue;
    }
    await visit(state, expr, { path, abs, name: basename(path), st, depth: 0 });
  }
  const io = { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr };
  for (const b of state.batches) {
    if (b.paths.length && (await dispatch([...b.argv, ...b.paths], ctx.shell, io)) !== 0) state.status = 1;
  }
  return state.status;
}

export const findCommands: CommandTable = {
  find: { desc: 'search for files in a directory hierarchy', fn: command(find) },
};
