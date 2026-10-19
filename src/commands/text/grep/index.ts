import { lineReader } from '../../../shell/io.ts';
import { errMessage } from '../../../vfs/errors.ts';
import type { CommandTable, Ctx } from '../../types.ts';
import { abs, command, UsageError } from '../../util.ts';
import { RegexError } from '../regex.ts';
import { textLines } from '../stream.ts';
import { GrepError, parseGrep, type GrepOpts } from './options.ts';
import { search, type GrepState } from './search.ts';

interface Run {
  ctx: Ctx;
  o: GrepOpts;
  state: GrepState;
  matched: boolean;
  error: boolean;
  multi: boolean;
}

function warn(run: Run, msg: string): void {
  run.error = true;
  if (!run.o.silent) run.ctx.stderr.write(`grep: ${msg}\n`);
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

async function grepFile(run: Run, name: string, fromWalk: boolean): Promise<void> {
  const { ctx, o } = run;
  if (!fromWalk && o.recursive) {
    const node = ctx.vfs.tryLookup(abs(ctx, name), true);
    if (node?.kind === 'dir') return walk(run, name);
  }
  if ((o.include.length && !o.include.some((re) => re.test(base(name)))) || o.exclude.some((re) => re.test(base(name)))) return;
  let text: string;
  try {
    text = ctx.vfs.readFile(abs(ctx, name));
  } catch (e) {
    return warn(run, `${name}: ${errMessage(e)}`);
  }
  const binary = !o.text && text.includes('\0');
  if (binary && o.skipBinary) return;
  const showName = o.withName ?? (run.multi || fromWalk);
  const r = await search(textLines(text), name, showName, binary, o, ctx.stdout, run.state);
  if (r.selected) run.matched = true;
  if (r.binaryMatch) ctx.stderr.write(`grep: ${name}: binary file matches\n`);
}

async function walk(run: Run, dir: string): Promise<void> {
  const { ctx, o } = run;
  let entries: string[];
  try {
    entries = ctx.vfs.readdir(abs(ctx, dir));
  } catch (e) {
    return warn(run, `${dir}: ${errMessage(e)}`);
  }
  for (const name of entries) {
    if (run.state.done) return;
    const path = dir === '' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
    const full = abs(ctx, path);
    const link = ctx.vfs.tryLookup(full, false);
    if (link?.kind === 'symlink' && !o.deref) continue;
    const node = ctx.vfs.tryLookup(full, true);
    if (!node) continue;
    if (node.kind === 'dir') {
      if (!o.excludeDir.some((re) => re.test(name))) await walk(run, path);
    } else await grepFile(run, path, true);
  }
}

async function grep(ctx: Ctx): Promise<number> {
  if (ctx.name !== 'grep') ctx.stderr.write(`${ctx.name}: warning: ${ctx.name} is obsolescent; using grep -${ctx.name[0].toUpperCase()}\n`);
  let o: GrepOpts;
  try {
    o = parseGrep(ctx);
  } catch (e) {
    if (e instanceof UsageError && e.message === 'no pattern') {
      ctx.stderr.write(`Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`);
      return 2;
    }
    if (!(e instanceof RegexError || e instanceof GrepError)) throw e;
    ctx.stderr.write(`grep: ${e.message}\n`);
    return 2;
  }
  const run: Run = { ctx, o, state: { printed: false, done: false }, matched: false, error: false, multi: o.files.length > 1 };
  const files = o.files.length ? o.files : [o.recursive ? '' : '-'];
  for (const f of files) {
    if (run.state.done) break;
    if (f === '-') {
      const r = await search(lineReader(ctx.stdin), o.label, o.withName ?? run.multi, false, o, ctx.stdout, run.state);
      if (r.selected) run.matched = true;
      continue;
    }
    if (f === '') {
      await walk(run, '');
      continue;
    }
    const node = ctx.vfs.tryLookup(abs(ctx, f), true);
    if (!node) warn(run, `${f}: No such file or directory`);
    else if (node.kind === 'dir' && !o.recursive) warn(run, `${f}: Is a directory`);
    else await grepFile(run, f, false);
  }
  if (o.quiet && run.matched) return 0;
  return run.error ? 2 : run.matched ? 0 : 1;
}

export const grepCommands: CommandTable = {
  grep: { fn: command(grep), desc: 'print lines that match patterns' },
  egrep: { fn: command(grep), desc: 'grep with extended regexes (grep -E)' },
  fgrep: { fn: command(grep), desc: 'grep for fixed strings (grep -F)' },
};
