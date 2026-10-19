import { randomInt } from 'node:crypto';
import { basename as base, dirname as parent } from '../../vfs/path.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { err, joinPath, msgOf, q, usage } from './common.ts';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function basename(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'az',
    values: 's',
    long: { multiple: 'a', 'suffix=': 's', zero: 'z' },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  const multiple = opts.a || opts.s !== undefined;
  if (!multiple && operands.length > 2) return usage(ctx, `extra operand ${q(operands[2])}`);
  const suffix = typeof opts.s === 'string' ? opts.s : multiple ? undefined : operands[1];
  const names = multiple ? operands : [operands[0]];
  for (const n of names) ctx.stdout.write(`${base(n, suffix)}${opts.z ? '\0' : '\n'}`);
  return 0;
}

function dirname(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'z', long: { zero: 'z' } });
  if (!operands.length) return usage(ctx, 'missing operand');
  for (const n of operands) {
    const dir = parent(n);
    ctx.stdout.write(`${/^\/+$/.test(dir) ? dir : dir.replace(/\/+$/, '')}${opts.z ? '\0' : '\n'}`);
  }
  return 0;
}

function mktemp(ctx: Ctx): number {
  const args = ctx.args.map((a) => (a === '--tmpdir' ? '-t' : a.startsWith('--tmpdir=') ? `-p${a.slice(9)}` : a));
  const { opts, operands } = parseArgs(args, {
    flags: 'dqut',
    values: 'p',
    long: { directory: 'd', quiet: 'q', 'dry-run': 'u' },
  });
  if (operands.length > 1) return usage(ctx, `too many templates`);
  const template = operands[0] ?? 'tmp.XXXXXXXXXX';
  const inTmp = !operands.length || opts.t || opts.p !== undefined;
  if (inTmp && operands.length && template.includes('/')) {
    return err(ctx, `invalid template, ${q(template)}, contains directory separator`);
  }
  const xs = /X*$/.exec(template)![0].length;
  if (xs < 3) return err(ctx, `too few X's in template ${q(template)}`);
  const dir = typeof opts.p === 'string' ? opts.p : ctx.env.TMPDIR || '/tmp';
  const stem = inTmp ? joinPath(dir, template) : template;
  const kind = opts.d ? 'directory' : 'file';
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = stem.slice(0, -xs) + Array.from({ length: xs }, () => ALNUM[randomInt(ALNUM.length)]).join('');
    const path = ctx.shell.abs(name);
    if (ctx.vfs.tryLookup(path, false)) continue;
    try {
      if (opts.u) ctx.vfs.lookup(parent(path));
      else if (opts.d) ctx.vfs.mkdir(path, false, 0o700);
      else {
        ctx.vfs.writeFile(path, '');
        ctx.vfs.chmod(path, 0o600);
      }
    } catch (e) {
      return opts.q ? 1 : err(ctx, `failed to create ${kind} via template ${q(stem)}: ${msgOf(e)}`);
    }
    ctx.stdout.write(`${name}\n`);
    return 0;
  }
  return opts.q ? 1 : err(ctx, `failed to create ${kind} via template ${q(stem)}: File exists`);
}

export const nameCommands: CommandTable = {
  basename: { desc: 'strip directory and suffix from filenames', fn: command(basename) },
  dirname: { desc: 'strip last component from file name', fn: command(dirname) },
  mktemp: { desc: 'create a temporary file or directory', fn: command(mktemp) },
};
