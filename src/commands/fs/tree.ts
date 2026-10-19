import { checkpoint } from '../../shell/interpreter.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { joinPath, tryStat, usage } from './common.ts';

// tree's UTF-8 line drawing really does pad the vertical bar with two no-break spaces.
const BRANCH = '├── ';
const LAST = '└── ';
const VERT = '\u2502\u00a0\u00a0 ';
const GAP = '    ';

interface TreeRun {
  all: boolean;
  dirsOnly: boolean;
  maxDepth: number;
  dirs: number;
  files: number;
}

async function walk(ctx: Ctx, run: TreeRun, path: string, prefix: string, depth: number): Promise<void> {
  const { vfs } = ctx;
  const entries = vfs
    .readdir(path)
    .filter((name) => run.all || !name.startsWith('.'))
    .map((name) => {
      const child = joinPath(path, name);
      const lst = vfs.stat(child, false);
      const isDir = (lst.kind === 'symlink' ? tryStat(vfs, child) : lst)?.kind === 'dir';
      return { name, child, link: lst.kind === 'symlink' ? vfs.readlink(child) : null, isDir };
    })
    .filter((e) => !run.dirsOnly || e.isDir);
  for (const [i, e] of entries.entries()) {
    await checkpoint(ctx.shell);
    const last = i === entries.length - 1;
    let line = `${prefix}${last ? LAST : BRANCH}${e.name}${e.link === null ? '' : ` -> ${e.link}`}`;
    if (e.isDir) run.dirs++;
    else run.files++;
    const descend = e.isDir && e.link === null && depth < run.maxDepth;
    let readable = true;
    if (descend) {
      try {
        vfs.readdir(e.child);
      } catch {
        readable = false;
        line += '  [error opening dir]';
      }
    }
    ctx.stdout.write(`${line}\n`);
    if (descend && readable) await walk(ctx, run, e.child, prefix + (last ? GAP : VERT), depth + 1);
  }
}

async function tree(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'ad', values: 'L' });
  let maxDepth = Infinity;
  if (typeof opts.L === 'string') {
    maxDepth = Number(opts.L);
    if (!Number.isInteger(maxDepth) || maxDepth < 1) return usage(ctx, `Invalid level, must be greater than 0.`);
  }
  const run: TreeRun = { all: !!opts.a, dirsOnly: !!opts.d, maxDepth, dirs: 0, files: 0 };
  let status = 0;
  for (const op of operands.length ? operands : ['.']) {
    const path = ctx.shell.abs(op);
    const st = tryStat(ctx.vfs, path);
    let opened = st?.kind === 'dir';
    if (opened) {
      try {
        ctx.vfs.readdir(path);
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      ctx.stdout.write(`${op}  [error opening dir]\n`);
      status = 2;
      continue;
    }
    ctx.stdout.write(`${op}\n`);
    await walk(ctx, run, path, '', 1);
  }
  const dirs = `${run.dirs} director${run.dirs === 1 ? 'y' : 'ies'}`;
  const files = `${run.files} file${run.files === 1 ? '' : 's'}`;
  ctx.stdout.write(`\n${run.dirsOnly ? dirs : `${dirs}, ${files}`}\n`);
  return status;
}

export const treeCommands: CommandTable = {
  tree: { desc: 'list contents of directories in a tree-like format', fn: command(tree) },
};
