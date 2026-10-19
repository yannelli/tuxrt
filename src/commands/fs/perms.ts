import { checkpoint } from '../../shell/interpreter.ts';
import { applyChmod, formatMode } from '../../vfs/mode.ts';
import type { Stat } from '../../vfs/types.ts';
import { findGroup, findUser, groupName, userName } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, joinPath, msgOf, q, usage } from './common.ts';

type Visit = (shown: string, path: string, st: Stat, top: boolean) => void;

/** Visits each operand (following a top-level symlink) and, with -R, everything below it without following links. */
async function walk(ctx: Ctx, operands: string[], recursive: boolean, visit: Visit): Promise<number> {
  let status = 0;
  const descend = async (shown: string, path: string, st: Stat, top: boolean): Promise<void> => {
    visit(shown, path, st, top);
    if (!recursive || st.kind !== 'dir') return;
    let names: string[];
    try {
      names = ctx.vfs.readdir(path);
    } catch (e) {
      status = err(ctx, `cannot read directory ${q(shown)}: ${msgOf(e)}`);
      return;
    }
    for (const name of names) {
      await checkpoint(ctx.shell);
      const child = joinPath(path, name);
      await descend(joinPath(shown, name), child, ctx.vfs.stat(child, false), false);
    }
  };
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    try {
      await descend(op, path, ctx.vfs.stat(path), true);
    } catch (e) {
      status = err(ctx, `cannot access ${q(op)}: ${msgOf(e)}`);
    }
  }
  return status;
}

const octal = (m: number) => `${m.toString(8).padStart(4, '0')} (${formatMode('file', m).slice(1)})`;

async function chmod(ctx: Ctx): Promise<number> {
  const args = [...ctx.args];
  // Modes like "-x" or "-rw" look like options, so pick the mode operand out by hand.
  let modeAt = -1;
  for (let i = 0; i < args.length && modeAt === -1; i++) {
    if (args[i] === '--') modeAt = i + 1;
    else if (!/^-[cfvR]+$/.test(args[i]) && !args[i].startsWith('--')) modeAt = i;
  }
  if (modeAt === -1 || modeAt >= args.length) return usage(ctx, 'missing operand');
  const [spec] = args.splice(modeAt, 1);
  const { opts, operands } = parseArgs(args, {
    flags: 'cfvR',
    long: { changes: 'c', silent: 'f', quiet: 'f', verbose: 'v', recursive: 'R' },
  });
  if (applyChmod(spec, 0, false) === null) return usage(ctx, `invalid mode: ${q(spec)}`);
  if (!operands.length) return usage(ctx, `missing operand after ${q(spec)}`);
  let status = 0;
  const walked = await walk(ctx, operands, !!opts.R, (shown, path, st) => {
    if (st.kind === 'symlink') return;
    const before = st.mode & 0o7777;
    const after = applyChmod(spec, before, st.kind === 'dir')!;
    try {
      ctx.vfs.chmod(path, after);
    } catch (e) {
      if (!opts.f) status = err(ctx, `changing permissions of ${q(shown)}: ${msgOf(e)}`);
      return;
    }
    if (before !== after && (opts.v || opts.c)) ctx.stdout.write(`mode of ${q(shown)} changed from ${octal(before)} to ${octal(after)}\n`);
    else if (before === after && opts.v) ctx.stdout.write(`mode of ${q(shown)} retained as ${octal(before)}\n`);
  });
  return status || walked;
}

function resolveId(ctx: Ctx, name: string, kind: 'user' | 'group'): number | undefined {
  if (/^\d+$/.test(name)) return Number(name);
  return kind === 'user' ? findUser(ctx.vfs, name)?.uid : findGroup(ctx.vfs, name)?.gid;
}

async function changeOwner(ctx: Ctx, groupOnly: boolean): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'cfvRhHLP',
    long: { changes: 'c', silent: 'f', quiet: 'f', verbose: 'v', recursive: 'R', 'no-dereference': 'h', dereference: 'L' },
  });
  const [spec, ...files] = operands;
  if (spec === undefined) return usage(ctx, 'missing operand');
  if (!files.length) return usage(ctx, `missing operand after ${q(spec)}`);
  let uid: number | undefined;
  let gid: number | undefined;
  const sep = spec.indexOf(':');
  const userPart = groupOnly ? '' : sep === -1 ? spec : spec.slice(0, sep);
  const groupPart = groupOnly ? spec : sep === -1 ? '' : spec.slice(sep + 1);
  if (userPart) {
    uid = resolveId(ctx, userPart, 'user');
    if (uid === undefined) return err(ctx, `invalid user: ${q(spec)}`);
    if (sep !== -1 && !groupPart) gid = findUser(ctx.vfs, uid)?.gid;
  }
  if (groupPart) {
    gid = resolveId(ctx, groupPart, 'group');
    if (gid === undefined) return err(ctx, `invalid group: ${q(spec)}`);
  }
  const { vfs } = ctx;
  const owner = (u: number, g: number) => (groupOnly ? groupName(vfs, g) : `${userName(vfs, u)}:${groupName(vfs, g)}`);
  const what = groupOnly ? 'group' : 'ownership';
  let status = 0;
  const walked = await walk(ctx, files, !!opts.R, (shown, path, st, top) => {
    const follow = top ? !opts.h : false;
    const cur = follow ? vfs.stat(path) : st;
    const [u, g] = [uid ?? cur.uid, gid ?? cur.gid];
    try {
      vfs.chown(path, u, g, follow);
    } catch (e) {
      if (!opts.f) status = err(ctx, `changing ${what} of ${q(shown)}: ${msgOf(e)}`);
      return;
    }
    const [from, to] = [owner(cur.uid, cur.gid), owner(u, g)];
    if (from !== to && (opts.v || opts.c)) ctx.stdout.write(`changed ${what} of ${q(shown)} from ${from} to ${to}\n`);
    else if (from === to && opts.v) ctx.stdout.write(`${what} of ${q(shown)} retained as ${from}\n`);
  });
  return status || walked;
}

export const permCommands: CommandTable = {
  chmod: { desc: 'change file mode bits', fn: command(chmod) },
  chown: { desc: 'change file owner and group', fn: command((ctx) => changeOwner(ctx, false)) },
  chgrp: { desc: 'change group ownership', fn: command((ctx) => changeOwner(ctx, true)) },
};
