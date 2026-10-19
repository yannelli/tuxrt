import { checkpoint } from '../../shell/interpreter.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { blocksKb, err, human, joinPath, msgOf, q, usage } from './common.ts';
import { mountOf, mounts, usedKb, type Mount } from './mounts.ts';

async function du(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'shacxk',
    values: 'd',
    long: { summarize: 's', 'human-readable': 'h', all: 'a', total: 'c', 'max-depth=': 'd', 'one-file-system': 'x' },
  });
  if (opts.s && opts.a) return usage(ctx, 'cannot both summarize and show all entries');
  let maxDepth = Infinity;
  if (typeof opts.d === 'string') {
    if (!/^\d+$/.test(opts.d)) return usage(ctx, `invalid maximum depth ${q(opts.d)}`);
    maxDepth = Number(opts.d);
  }
  if (opts.s) maxDepth = 0;
  const fmt = (kb: number) => (opts.h ? human(kb * 1024) : String(kb));
  const seen = new Set<number>();
  let status = 0;

  const walk = async (shown: string, path: string, depth: number): Promise<number> => {
    const st = ctx.vfs.stat(path, false);
    if (st.kind !== 'dir' && st.nlink > 1) {
      if (seen.has(st.ino)) return 0;
      seen.add(st.ino);
    }
    let kb = blocksKb(st);
    if (st.kind === 'dir') {
      try {
        for (const name of ctx.vfs.readdir(path)) {
          await checkpoint(ctx.shell);
          kb += await walk(joinPath(shown, name), joinPath(path, name), depth + 1);
        }
      } catch (e) {
        status = err(ctx, `cannot read directory ${q(shown)}: ${msgOf(e)}`);
      }
    }
    if ((st.kind === 'dir' || opts.a || depth === 0) && depth <= maxDepth) ctx.stdout.write(`${fmt(kb)}\t${shown}\n`);
    return kb;
  };

  let total = 0;
  for (const op of operands.length ? operands : ['.']) {
    const path = ctx.shell.abs(op);
    try {
      ctx.vfs.lookup(path, false);
    } catch (e) {
      status = err(ctx, `cannot access ${q(op)}: ${msgOf(e)}`);
      continue;
    }
    total += await walk(op, path, 0);
  }
  if (opts.c) ctx.stdout.write(`${fmt(total)}\ttotal\n`);
  return status;
}

function df(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'hTak',
    long: { 'human-readable': 'h', 'print-type': 'T', all: 'a' },
  });
  let status = 0;
  const chosen: Mount[] = [];
  for (const op of operands) {
    try {
      chosen.push(mountOf(ctx.vfs.realpath(ctx.shell.abs(op))));
    } catch (e) {
      status = err(ctx, `${op}: ${msgOf(e)}`);
    }
  }
  if (operands.length && !chosen.length) return status;
  const list = operands.length ? chosen : mounts().filter((m) => opts.a || !m.hidden);
  const size = (kb: number) => (opts.h ? human(kb * 1024) : String(kb));
  const rows = list.map((m) => {
    const used = usedKb(ctx.vfs, m);
    const avail = Math.max(0, m.sizeKb - used);
    const pct = m.sizeKb ? `${Math.ceil((used * 100) / (used + avail))}%` : '-';
    return [m.source, m.type, size(m.sizeKb), size(used), size(avail), pct, m.target];
  });
  const header = ['Filesystem', 'Type', opts.h ? 'Size' : '1K-blocks', 'Used', opts.h ? 'Avail' : 'Available', 'Use%', 'Mounted on'];
  const minWidth = [14, 4, 5, 5, 5, 4, 0];
  const keep = (_: unknown, i: number) => i !== 1 || !!opts.T;
  const table = [header, ...rows].map((r) => r.filter(keep));
  const widths = minWidth.filter(keep).map((w, i) => Math.max(w, ...table.map((r) => r[i].length)));
  const leftAligned = (i: number) => i === 0 || i === widths.length - 1 || (opts.T && i === 1);
  for (const row of table) {
    const cells = row.map((c, i) => (i === row.length - 1 ? c : leftAligned(i) ? c.padEnd(widths[i]) : c.padStart(widths[i])));
    ctx.stdout.write(`${cells.join(' ')}\n`);
  }
  return status;
}

export const usageCommands: CommandTable = {
  du: { desc: 'estimate file space usage', fn: command(du) },
  df: { desc: 'report file system space usage', fn: command(df) },
};
