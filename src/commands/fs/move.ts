import type { Stat } from '../../vfs/types.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, msgOf, q, tryStat } from './common.ts';
import { targets } from './copy.ts';

function move(ctx: Ctx, opts: Record<string, string | true>, src: string, dst: string): boolean {
  const { vfs } = ctx;
  const srcAbs = ctx.shell.abs(src);
  const dstAbs = ctx.shell.abs(dst);
  const fail = (msg: string) => (err(ctx, msg), false);
  let st: Stat;
  try {
    st = vfs.stat(srcAbs, false);
  } catch (e) {
    return fail(`cannot stat ${q(src)}: ${msgOf(e)}`);
  }
  const existing = tryStat(vfs, dstAbs, false);
  if (existing?.ino === st.ino) return fail(`${q(src)} and ${q(dst)} are the same file`);
  if (st.kind === 'dir' && `${dstAbs}/`.startsWith(`${srcAbs}/`)) {
    return fail(`cannot move ${q(src)} to a subdirectory of itself, ${q(dst)}`);
  }
  if (existing) {
    if (opts.n) return true;
    if (existing.kind === 'dir' && st.kind !== 'dir') return fail(`cannot overwrite directory ${q(dst)} with non-directory`);
    if (existing.kind !== 'dir' && st.kind === 'dir') return fail(`cannot overwrite non-directory ${q(dst)} with directory ${q(src)}`);
  }
  try {
    vfs.rename(srcAbs, dstAbs);
  } catch (e) {
    return fail(`cannot move ${q(src)} to ${q(dst)}: ${msgOf(e)}`);
  }
  if (opts.v) ctx.stdout.write(`renamed ${q(src)} -> ${q(dst)}\n`);
  return true;
}

function mv(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'fnviT',
    values: 't',
    long: {
      force: 'f', 'no-clobber': 'n', verbose: 'v', interactive: 'i',
      'no-target-directory': 'T', 'target-directory=': 't',
    },
  });
  const t = targets(ctx, opts, operands);
  if (typeof t === 'number') return t;
  let status = 0;
  for (const [src, dst] of t.pairs) if (!move(ctx, opts, src, dst)) status = 1;
  return status;
}

export const moveCommands: CommandTable = {
  mv: { desc: 'move (rename) files', fn: command(mv) },
};
