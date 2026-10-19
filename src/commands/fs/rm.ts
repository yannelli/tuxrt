import { checkpoint } from '../../shell/interpreter.ts';
import { FsError } from '../../vfs/errors.ts';
import { basename } from '../../vfs/path.ts';
import type { Stat } from '../../vfs/types.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, joinPath, msgOf, q, usage } from './common.ts';

interface RmOpts {
  recursive: boolean;
  dir: boolean;
  verbose: boolean;
}

/** Removes one path; returns false when it (or something below it) could not be removed. */
async function remove(ctx: Ctx, o: RmOpts, shown: string, path: string, st: Stat): Promise<boolean> {
  const { vfs } = ctx;
  const failed = (e: unknown) => (err(ctx, `cannot remove ${q(shown)}: ${msgOf(e)}`), false);
  if (st.kind !== 'dir') {
    try {
      vfs.unlink(path);
    } catch (e) {
      return failed(e);
    }
    if (o.verbose) ctx.stdout.write(`removed ${q(shown)}\n`);
    return true;
  }
  if (!o.recursive && !o.dir) return failed(new FsError('EISDIR', path));
  if (o.recursive) {
    let names: string[];
    try {
      names = vfs.readdir(path);
    } catch (e) {
      return failed(e);
    }
    let ok = true;
    for (const name of names) {
      await checkpoint(ctx.shell);
      const child = joinPath(path, name);
      const cst = vfs.tryLookup(child, false) ? vfs.stat(child, false) : null;
      if (cst) ok = (await remove(ctx, o, joinPath(shown, name), child, cst)) && ok;
    }
    if (!ok) return false;
  }
  try {
    vfs.rmdir(path);
  } catch (e) {
    return failed(e);
  }
  if (o.verbose) ctx.stdout.write(`removed directory ${q(shown)}\n`);
  return true;
}

async function rm(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'rRfivdI',
    long: {
      recursive: 'r', force: 'f', verbose: 'v', dir: 'd', interactive: 'i',
      'no-preserve-root': 'no-preserve-root', 'preserve-root': 'preserve-root',
    },
  });
  if (!operands.length) return opts.f ? 0 : usage(ctx, 'missing operand');
  const o: RmOpts = { recursive: !!(opts.r || opts.R), dir: !!opts.d, verbose: !!opts.v };
  let status = 0;
  for (const op of operands) {
    const base = basename(op);
    if (base === '.' || base === '..') {
      status = err(ctx, `refusing to remove '.' or '..' directory: skipping ${q(op)}`);
      continue;
    }
    const path = ctx.shell.abs(op);
    if (o.recursive && path === '/' && !opts['no-preserve-root']) {
      const same = op === '/' ? '' : " (same as '/')";
      status = err(ctx, `it is dangerous to operate recursively on ${q(op)}${same}\nrm: use --no-preserve-root to override this failsafe`);
      continue;
    }
    let st: Stat;
    try {
      st = ctx.vfs.stat(path, false);
    } catch (e) {
      if (!(opts.f && e instanceof FsError && e.code === 'ENOENT')) status = err(ctx, `cannot remove ${q(op)}: ${msgOf(e)}`);
      continue;
    }
    if (!(await remove(ctx, o, op, path, st))) status = 1;
  }
  return status;
}

export const rmCommands: CommandTable = {
  rm: { desc: 'remove files or directories', fn: command(rm) },
};
