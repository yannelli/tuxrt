import { FsError } from '../../vfs/errors.ts';
import { basename, normalize, split } from '../../vfs/path.ts';
import type { VFS } from '../../vfs/vfs.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, joinPath, msgOf, q, tryStat, usage } from './common.ts';

/** e: every component must exist; f: all but the last; m: none need to. */
type Existence = 'e' | 'f' | 'm';

export function canonicalize(vfs: VFS, path: string, need: Existence): string {
  let parts = split(normalize(path));
  let out: string[] = [];
  let hops = 0;
  while (parts.length) {
    const name = parts.shift()!;
    const cur = `/${[...out, name].join('/')}`;
    let node;
    try {
      node = vfs.lookup(cur, false);
    } catch (e) {
      const missing = e instanceof FsError && e.code === 'ENOENT';
      if (missing && (need === 'm' || (need === 'f' && !parts.length))) {
        out.push(name);
        continue;
      }
      throw e;
    }
    if (node.kind === 'symlink') {
      if (++hops > 40) throw new FsError('ELOOP', path);
      parts = [...split(normalize(node.target, `/${out.join('/')}`)), ...parts];
      out = [];
      continue;
    }
    if (node.kind !== 'dir' && parts.length && need !== 'm') throw new FsError('ENOTDIR', path);
    out.push(name);
  }
  return `/${out.join('/')}`;
}

function ln(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'sfnvTP',
    values: 't',
    long: {
      symbolic: 's', force: 'f', 'no-dereference': 'n', verbose: 'v',
      'no-target-directory': 'T', 'target-directory=': 't', physical: 'P',
    },
  });
  if (!operands.length) return usage(ctx, 'missing file operand');
  const { vfs } = ctx;
  const explicit = typeof opts.t === 'string' ? opts.t : null;
  const dest = explicit ?? (operands.length === 1 ? '.' : operands.at(-1)!);
  const sources = explicit || operands.length === 1 ? operands : operands.slice(0, -1);
  const destAbs = ctx.shell.abs(dest);
  const destIsLink = tryStat(vfs, destAbs, false)?.kind === 'symlink';
  const intoDir = !opts.T && vfs.isDir(destAbs) && !(opts.n && destIsLink);
  if (!intoDir && sources.length > 1) return err(ctx, `target ${q(dest)} is not a directory`);
  let status = 0;
  for (const src of sources) {
    const link = intoDir ? joinPath(dest, basename(src)) : dest;
    const linkAbs = ctx.shell.abs(link);
    const kind = opts.s ? 'symbolic link' : 'hard link';
    if (!opts.s) {
      let target;
      try {
        target = vfs.stat(ctx.shell.abs(src));
      } catch (e) {
        status = err(ctx, `failed to access ${q(src)}: ${msgOf(e)}`);
        continue;
      }
      if (target.kind === 'dir') {
        status = err(ctx, `${q(src)}: hard link not allowed for directory`);
        continue;
      }
    }
    try {
      const existing = tryStat(vfs, linkAbs, false);
      if (existing && opts.f) {
        if (existing.kind === 'dir') {
          status = err(ctx, `${q(link)}: cannot overwrite directory`);
          continue;
        }
        vfs.unlink(linkAbs);
      }
      if (opts.s) vfs.symlink(src, linkAbs);
      else vfs.link(ctx.shell.abs(src), linkAbs);
      if (opts.v) ctx.stdout.write(`${q(link)} ${opts.s ? '->' : '=>'} ${q(src)}\n`);
    } catch (e) {
      status = err(ctx, `failed to create ${kind} ${q(link)}: ${msgOf(e)}`);
    }
  }
  return status;
}

function terminator(opts: Record<string, string | true>): string {
  return opts.z ? '\0' : '\n';
}

function readlink(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'femnqsvz',
    long: {
      canonicalize: 'f', 'canonicalize-existing': 'e', 'canonicalize-missing': 'm',
      'no-newline': 'n', quiet: 'q', silent: 's', verbose: 'v', zero: 'z',
    },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  const need: Existence | null = opts.e ? 'e' : opts.m ? 'm' : opts.f ? 'f' : null;
  const end = opts.n && operands.length === 1 ? '' : terminator(opts);
  let status = 0;
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    try {
      ctx.stdout.write(`${need ? canonicalize(ctx.vfs, path, need) : ctx.vfs.readlink(path)}${end}`);
    } catch (e) {
      status = 1;
      if (opts.v) err(ctx, `${op}: ${msgOf(e)}`);
    }
  }
  return status;
}

function realpath(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'emsqzLP',
    long: {
      'canonicalize-existing': 'e', 'canonicalize-missing': 'm', strip: 's', 'no-symlinks': 's',
      quiet: 'q', zero: 'z', logical: 'L', physical: 'P',
    },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  const need: Existence = opts.e ? 'e' : opts.m ? 'm' : 'f';
  let status = 0;
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    try {
      if (opts.s && need === 'e') ctx.vfs.lookup(path, false);
      ctx.stdout.write(`${opts.s ? path : canonicalize(ctx.vfs, path, need)}${terminator(opts)}`);
    } catch (e) {
      status = 1;
      if (!opts.q) err(ctx, `${op}: ${msgOf(e)}`);
    }
  }
  return status;
}

export const linkCommands: CommandTable = {
  ln: { desc: 'make links between files', fn: command(ln) },
  readlink: { desc: 'print symlink targets or full paths', fn: command(readlink) },
  realpath: { desc: 'print the resolved path', fn: command(realpath) },
};
