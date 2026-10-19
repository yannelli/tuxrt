import { applyChmod } from '../../vfs/mode.ts';
import { FsError } from '../../vfs/errors.ts';
import { dirname } from '../../vfs/path.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, msgOf, q, usage } from './common.ts';

/** mkdir -p over the operand's own prefixes so -v reports paths as the user typed them. */
function makeParents(ctx: Ctx, op: string, mode: number | undefined, created: (shown: string) => void): void {
  const parts = op.split('/').filter(Boolean);
  let shown = op.startsWith('/') ? '/' : '';
  parts.forEach((part, i) => {
    shown = shown === '' ? part : shown.endsWith('/') ? shown + part : `${shown}/${part}`;
    const path = ctx.shell.abs(shown);
    const last = i === parts.length - 1;
    const node = ctx.vfs.tryLookup(path);
    if (node?.kind === 'dir' || part === '.' || part === '..') return;
    if (node) throw new FsError(last ? 'EEXIST' : 'ENOTDIR', path);
    ctx.vfs.mkdir(path, false, last ? mode : undefined);
    created(shown);
  });
}

function mkdir(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'pv',
    values: 'm',
    long: { parents: 'p', verbose: 'v', 'mode=': 'm' },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  let mode: number | undefined;
  if (typeof opts.m === 'string') {
    const m = applyChmod(opts.m, 0o777, true);
    if (m === null) return err(ctx, `invalid mode ${q(opts.m)}`);
    mode = m;
  }
  const created = (shown: string) => opts.v && ctx.stdout.write(`mkdir: created directory ${q(shown)}\n`);
  let status = 0;
  for (const op of operands) {
    try {
      if (opts.p) makeParents(ctx, op, mode, created);
      else {
        ctx.vfs.mkdir(ctx.shell.abs(op), false, mode);
        created(op);
      }
    } catch (e) {
      status = err(ctx, `cannot create directory ${q(op)}: ${msgOf(e)}`);
    }
  }
  return status;
}

function rmdir(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'pv',
    long: { parents: 'p', verbose: 'v', 'ignore-fail-on-non-empty': 'ignore' },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  let status = 0;
  const remove = (dir: string): boolean => {
    if (opts.v) ctx.stdout.write(`rmdir: removing directory, ${q(dir)}\n`);
    try {
      ctx.vfs.rmdir(ctx.shell.abs(dir));
      return true;
    } catch (e) {
      if (!(opts.ignore && e instanceof FsError && e.code === 'ENOTEMPTY')) {
        status = err(ctx, `failed to remove ${q(dir)}: ${msgOf(e)}`);
      }
      return false;
    }
  };
  for (const op of operands) {
    let dir = op.replace(/(.)\/+$/, '$1');
    if (!remove(dir) || !opts.p) continue;
    for (let up = dirname(dir); up !== dir && up !== '.' && up !== '/'; up = dirname(dir)) {
      dir = up;
      if (!remove(dir)) break;
    }
  }
  return status;
}

export const dirCommands: CommandTable = {
  mkdir: { desc: 'make directories', fn: command(mkdir) },
  rmdir: { desc: 'remove empty directories', fn: command(rmdir) },
};
