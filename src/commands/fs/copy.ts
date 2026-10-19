import { checkpoint } from '../../shell/interpreter.ts';
import { basename } from '../../vfs/path.ts';
import type { Stat } from '../../vfs/types.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, joinPath, msgOf, q, tryStat, usage } from './common.ts';

interface CpOpts {
  recursive: boolean;
  noDeref: boolean;
  preserve: boolean;
  noClobber: boolean;
  force: boolean;
  verbose: boolean;
}

/** Splits operands into sources and a destination, honoring -t DIR and -T. */
export function targets(ctx: Ctx, opts: Record<string, string | true>, operands: string[]): { pairs: [string, string][] } | number {
  if (!operands.length) return usage(ctx, 'missing file operand');
  const explicit = typeof opts.t === 'string' ? opts.t : null;
  if (!explicit && operands.length === 1) return usage(ctx, `missing destination file operand after ${q(operands[0])}`);
  const dest = explicit ?? operands.at(-1)!;
  const sources = explicit ? operands : operands.slice(0, -1);
  const intoDir = !opts.T && ctx.vfs.isDir(ctx.shell.abs(dest));
  if (opts.T && sources.length > 1) return usage(ctx, `extra operand ${q(sources[1])}`);
  if (!intoDir && (explicit || sources.length > 1)) return err(ctx, `target ${q(dest)} is not a directory`);
  return { pairs: sources.map((s) => [s, intoDir ? joinPath(dest, basename(s)) : dest]) };
}

function applyMeta(ctx: Ctx, path: string, st: Stat): void {
  if (ctx.vfs.cred.uid === 0) ctx.vfs.chown(path, st.uid, st.gid, false);
  if (st.kind !== 'symlink') ctx.vfs.touch(path, st.mtime);
}

async function copy(ctx: Ctx, o: CpOpts, src: string, dst: string): Promise<boolean> {
  const { vfs } = ctx;
  const srcAbs = ctx.shell.abs(src);
  const dstAbs = ctx.shell.abs(dst);
  const fail = (msg: string) => (err(ctx, msg), false);
  let st: Stat;
  try {
    st = vfs.stat(srcAbs, !o.noDeref);
  } catch (e) {
    return fail(`cannot stat ${q(src)}: ${msgOf(e)}`);
  }
  const existing = tryStat(vfs, dstAbs, st.kind !== 'symlink');
  if (existing && existing.ino === st.ino) return fail(`${q(src)} and ${q(dst)} are the same file`);
  if (existing && o.noClobber && st.kind !== 'dir') return true;
  const mode = o.preserve ? st.mode : st.mode & ~vfs.umask;
  try {
    if (st.kind === 'dir') {
      if (!o.recursive) return fail(`-r not specified; omitting directory ${q(src)}`);
      if (`${dstAbs}/`.startsWith(`${srcAbs}/`)) return fail(`cannot copy a directory, ${q(src)}, into itself, ${q(dst)}`);
      if (existing && existing.kind !== 'dir') return fail(`cannot overwrite non-directory ${q(dst)} with directory ${q(src)}`);
      if (!existing) {
        vfs.mkdir(dstAbs, false, mode | 0o700);
        if (o.verbose) ctx.stdout.write(`${q(src)} -> ${q(dst)}\n`);
      }
      let ok = true;
      for (const name of vfs.readdir(srcAbs)) {
        await checkpoint(ctx.shell);
        ok = (await copy(ctx, o, joinPath(src, name), joinPath(dst, name))) && ok;
      }
      if (!existing || o.preserve) vfs.chmod(dstAbs, mode);
      if (o.preserve) applyMeta(ctx, dstAbs, st);
      return ok;
    }
    if (existing?.kind === 'dir') return fail(`cannot overwrite directory ${q(dst)} with non-directory`);
    if (st.kind === 'symlink') {
      if (existing) vfs.unlink(dstAbs);
      vfs.symlink(vfs.readlink(srcAbs), dstAbs);
    } else {
      let data: string;
      try {
        data = vfs.readFile(srcAbs);
      } catch (e) {
        return fail(`cannot open ${q(src)} for reading: ${msgOf(e)}`);
      }
      try {
        vfs.writeFile(dstAbs, data);
      } catch (e) {
        if (!(existing && o.force)) return fail(`cannot create regular file ${q(dst)}: ${msgOf(e)}`);
        vfs.unlink(dstAbs);
        vfs.writeFile(dstAbs, data);
      }
      if (!existing || o.preserve) vfs.chmod(dstAbs, mode);
    }
    if (o.preserve) applyMeta(ctx, dstAbs, st);
  } catch (e) {
    return fail(`cannot create ${st.kind === 'dir' ? 'directory' : 'regular file'} ${q(dst)}: ${msgOf(e)}`);
  }
  if (o.verbose) ctx.stdout.write(`${q(src)} -> ${q(dst)}\n`);
  return true;
}

async function cp(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'rRapfnviTdPL',
    values: 't',
    long: {
      recursive: 'r', archive: 'a', force: 'f', 'no-clobber': 'n', verbose: 'v', interactive: 'i',
      'no-target-directory': 'T', 'no-dereference': 'P', dereference: 'L', 'target-directory=': 't',
    },
  });
  const t = targets(ctx, opts, operands);
  if (typeof t === 'number') return t;
  const recursive = !!(opts.r || opts.R || opts.a);
  const o: CpOpts = {
    recursive,
    noDeref: !opts.L && !!(recursive || opts.P || opts.d),
    preserve: !!(opts.p || opts.a),
    noClobber: !!opts.n,
    force: !!opts.f,
    verbose: !!opts.v,
  };
  let status = 0;
  for (const [src, dst] of t.pairs) if (!(await copy(ctx, o, src, dst))) status = 1;
  return status;
}

export const copyCommands: CommandTable = {
  cp: { desc: 'copy files and directories', fn: command(cp) },
};
