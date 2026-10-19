import { ansiC } from '../../shell/expand.ts';
import { shellQuote } from '../../shell/quote.ts';
import { formatMode } from '../../vfs/mode.ts';
import type { Stat } from '../../vfs/types.ts';
import { groupName, userName } from '../../vfs/users.ts';
import type { VFS } from '../../vfs/vfs.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { blocksKb, DEVICES, err, fullTime, msgOf, q, usage } from './common.ts';
import { mountOf } from './mounts.ts';

interface Info {
  name: string;
  path: string;
  st: Stat;
  target?: string;
}

// coreutils 9.4 default_format(), verbatim.
const HEAD = '  File: %N\n  Size: %-10s\tBlocks: %-10b IO Block: %-6o %F\n';
const DEV = 'Device: %Hd,%Ld\tInode: %-11i Links: %h\n';
const CHARDEV = 'Device: %Hd,%Ld\tInode: %-11i Links: %-5h Device type: %Hr,%Lr\n';
const TAIL = 'Access: (%04a/%10.10A)  Uid: (%5u/%8U)   Gid: (%5g/%8G)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w\n';
const TERSE = '%n %s %b %f %u %g %D %i %h %t %T %X %Y %Z %W %o\n';
const TYPE_BITS = { file: 0o100000, dir: 0o040000, symlink: 0o120000 };

function fileType({ path, st }: Info): string {
  if (DEVICES[path]) return 'character special file';
  if (st.kind === 'dir') return 'directory';
  if (st.kind === 'symlink') return 'symbolic link';
  return st.size ? 'regular file' : 'regular empty file';
}

function field(conv: string, i: Info, vfs: VFS): string | number | null {
  const { st } = i;
  const dev = mountOf(i.path).dev;
  const rdev = DEVICES[i.path] ?? [0, 0];
  // The VFS only bumps mtime on writes, but Linux updates ctime too.
  const changed = Math.max(st.ctime, st.mtime);
  const typeBits = DEVICES[i.path] ? 0o020000 : TYPE_BITS[st.kind];
  switch (conv) {
    case 'n': return i.name;
    case 'N': return shellQuote(i.name) + (i.target === undefined ? '' : ` -> ${shellQuote(i.target)}`);
    case 's': return st.size;
    case 'b': return blocksKb(st) * 2;
    case 'B': return 512;
    case 'o': return 4096;
    case 'a': return (st.mode & 0o7777).toString(8);
    case 'A': return formatMode(st.kind, st.mode, !!DEVICES[i.path]);
    case 'f': return (typeBits | (st.mode & 0o7777)).toString(16);
    case 'F': return fileType(i);
    case 'u': return st.uid;
    case 'U': return userName(vfs, st.uid);
    case 'g': return st.gid;
    case 'G': return groupName(vfs, st.gid);
    case 'i': return st.ino;
    case 'h': return st.nlink;
    case 'd': return dev[0] * 256 + dev[1];
    case 'D': return (dev[0] * 256 + dev[1]).toString(16);
    case 'Hd': return dev[0];
    case 'Ld': return dev[1];
    case 'Hr': return rdev[0];
    case 'Lr': return rdev[1];
    case 't': return rdev[0].toString(16);
    case 'T': return rdev[1].toString(16);
    case 'm': return mountOf(i.path).target;
    case 'x':
    case 'y': return fullTime(st.mtime);
    case 'z': return fullTime(changed);
    case 'w': return '-';
    case 'X':
    case 'Y': return Math.floor(st.mtime / 1000);
    case 'Z': return Math.floor(changed / 1000);
    case 'W': return 0;
    default: return null;
  }
}

function render(fmt: string, info: Info, vfs: VFS): string {
  return fmt.replace(/%([-#+ 0]*)(\d*)(?:\.(\d+))?([HL]?[a-zA-Z%])/g, (whole, flags: string, width: string, prec: string, conv: string) => {
    if (conv === '%') return '%';
    const value = field(conv, info, vfs);
    if (value === null) return whole;
    let s = String(value);
    if (conv === 'a' && flags.includes('#')) s = `0${s}`;
    if (prec !== undefined && typeof value === 'string' && conv !== 'a') s = s.slice(0, Number(prec));
    const w = Number(width || 0);
    if (flags.includes('-')) return s.padEnd(w);
    return s.padStart(w, flags.includes('0') && /^[0-9a-f]+$/.test(s) ? '0' : ' ');
  });
}

function stat(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'Lt',
    values: 'c',
    long: { dereference: 'L', 'format=': 'c', 'printf=': 'printf', terse: 't' },
  });
  if (!operands.length) return usage(ctx, 'missing operand');
  let status = 0;
  for (const op of operands) {
    const path = ctx.shell.abs(op);
    let st: Stat;
    try {
      st = ctx.vfs.stat(path, !!opts.L);
    } catch (e) {
      status = err(ctx, `cannot statx ${q(op)}: ${msgOf(e)}`);
      continue;
    }
    const info: Info = { name: op, path, st, target: st.kind === 'symlink' ? ctx.vfs.readlink(path) : undefined };
    let fmt = HEAD + (DEVICES[path] ? CHARDEV : DEV) + TAIL;
    if (typeof opts.printf === 'string') fmt = ansiC(opts.printf);
    else if (typeof opts.c === 'string') fmt = `${opts.c}\n`;
    else if (opts.t) fmt = TERSE;
    ctx.stdout.write(render(fmt, info, ctx.vfs));
  }
  return status;
}

export const statCommands: CommandTable = {
  stat: { desc: 'display file or file system status', fn: command(stat) },
};
