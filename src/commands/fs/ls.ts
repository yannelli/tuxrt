import { checkpoint } from '../../shell/interpreter.ts';
import type { Stat } from '../../vfs/types.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { blocksKb, err, human, joinPath, msgOf, q } from './common.ts';
import { makeEntry, render, type Entry, type LsOpts } from './lsformat.ts';

interface Run extends LsOpts {
  all: boolean;
  almost: boolean;
  recursive: boolean;
  dirsAsFiles: boolean;
  width: number;
  compare: (a: Entry, b: Entry) => number;
  status: number;
  first: boolean;
  headers: boolean;
  colored: boolean;
}

const COLOR_WHEN: Record<string, 'always' | 'never' | 'auto'> = {
  always: 'always', yes: 'always', force: 'always',
  never: 'never', no: 'never', none: 'never',
  auto: 'auto', tty: 'auto', 'if-tty': 'auto',
};

/** Pulls out --color[=WHEN] since parseArgs has no optional-value long options. */
function splitColor(args: string[]): { rest: string[]; when: string } {
  const rest: string[] = [];
  let when = 'never';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') {
      rest.push(...args.slice(i));
      break;
    }
    const m = /^--colou?r(?:=(.*))?$/.exec(args[i]);
    if (m) when = m[1] ?? 'always';
    else rest.push(args[i]);
  }
  return { rest, when };
}

function comparator(opts: Record<string, string | true>): (a: Entry, b: Entry) => number {
  const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const key = opts.S ? (e: Entry) => -e.st.size : opts.t ? (e: Entry) => -e.st.mtime : null;
  const cmp = key ? (a: Entry, b: Entry) => key(a) - key(b) || byName(a, b) : byName;
  return opts.r ? (a, b) => cmp(b, a) : cmp;
}

function write(ctx: Ctx, run: Run, text: string): void {
  if (run.color && !run.colored && text.includes('\x1b[')) {
    run.colored = true;
    text = text.replace('\x1b[', '\x1b[0m\x1b[');
  }
  ctx.stdout.write(text);
}

async function listDir(ctx: Ctx, run: Run, shown: string, path: string, cmdline: boolean): Promise<void> {
  const { vfs } = ctx;
  let names: string[];
  try {
    names = vfs.readdir(path);
  } catch (e) {
    run.status = Math.max(run.status, err(ctx, `cannot open directory ${q(shown)}: ${msgOf(e)}`, cmdline ? 2 : 1));
    return;
  }
  if (run.headers) write(ctx, run, `${run.first ? '' : '\n'}${shown}:\n`);
  run.first = false;
  if (!run.all) names = names.filter((n) => !n.startsWith('.'));
  if (run.all && !run.almost) names = ['.', '..', ...names];
  const entries: Entry[] = [];
  for (const name of names) {
    const child = name === '.' ? path : name === '..' ? joinPath(path, '..') : joinPath(path, name);
    try {
      entries.push(makeEntry(vfs, name, child, vfs.stat(child, false)));
    } catch (e) {
      run.status = Math.max(run.status, err(ctx, `cannot access ${q(joinPath(shown, name))}: ${msgOf(e)}`));
    }
  }
  entries.sort(run.compare);
  if (run.long) {
    const kb = entries.reduce((sum, e) => sum + blocksKb(e.st), 0);
    write(ctx, run, `total ${run.human ? human(kb * 1024) : kb}\n`);
  }
  write(ctx, run, render(entries, run, vfs, run.width));
  if (!run.recursive) return;
  for (const e of entries) {
    if (e.st.kind !== 'dir' || e.name === '.' || e.name === '..') continue;
    await checkpoint(ctx.shell);
    await listDir(ctx, run, joinPath(shown, e.name), e.path, false);
  }
}

async function ls(ctx: Ctx): Promise<number> {
  const { rest, when } = splitColor(ctx.args);
  const mode = COLOR_WHEN[when];
  if (!mode) {
    const valid = "Valid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'";
    return err(ctx, `invalid argument ${q(when)} for '--color'\n${valid}\nTry 'ls --help' for more information.`, 2);
  }
  const { opts, operands } = parseArgs(rest, {
    flags: 'aAlhR1dFtSrinC',
    long: {
      all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', directory: 'd',
      classify: 'F', reverse: 'r', inode: 'i', 'numeric-uid-gid': 'n',
    },
  });
  const tty = !!ctx.stdout.isTTY;
  const long = !!(opts.l || opts.n);
  const columns = Number(ctx.env.COLUMNS ?? ctx.shell.get('COLUMNS')) || 80;
  const run: Run = {
    long, human: !!opts.h, inode: !!opts.i, numeric: !!opts.n, classify: !!opts.F,
    color: mode === 'always' || (mode === 'auto' && tty), quote: tty,
    all: !!(opts.a || opts.A), almost: !!opts.A, recursive: !!opts.R, dirsAsFiles: !!opts.d,
    width: !long && !opts['1'] && (opts.C || tty) ? columns : 0,
    compare: comparator(opts), status: 0, first: true, headers: operands.length > 1 || !!opts.R, colored: false,
  };
  const { vfs } = ctx;
  const files: Entry[] = [];
  const dirs: Entry[] = [];
  for (const op of operands.length ? operands : ['.']) {
    const path = ctx.shell.abs(op);
    let st: Stat;
    try {
      st = vfs.stat(path, op.endsWith('/'));
    } catch (e) {
      run.status = err(ctx, `cannot access ${q(op)}: ${msgOf(e)}`, 2);
      continue;
    }
    if (st.kind === 'symlink' && !run.long && !run.dirsAsFiles && !run.classify) {
      const target = vfs.tryLookup(path) ? vfs.stat(path) : null;
      if (target?.kind === 'dir') st = target;
    }
    (st.kind === 'dir' && !run.dirsAsFiles ? dirs : files).push(makeEntry(vfs, op, path, st));
  }
  files.sort(run.compare);
  dirs.sort(run.compare);
  if (files.length) {
    write(ctx, run, render(files, run, vfs, run.width));
    run.first = false;
  }
  for (const d of dirs) await listDir(ctx, run, d.name, d.path, true);
  return run.status;
}

export const lsCommands: CommandTable = {
  ls: { desc: 'list directory contents', fn: command(ls) },
};
