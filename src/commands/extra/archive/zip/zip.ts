import { checkpoint } from '../../../../shell/interpreter.ts';
import { errMessage } from '../../../../vfs/errors.ts';
import { basename } from '../../../../vfs/path.ts';
import type { Stat } from '../../../../vfs/types.ts';
import type { Ctx } from '../../../types.ts';
import { command, parseArgs } from '../../../util.ts';
import { fromBytes, toBytes } from '../../../../vfs/bytes.ts';
import { makeEntry, readZip, writeZip, ZipError, type ZipEntry } from './format.ts';

interface ZipOpts {
  recurse: boolean;
  quiet: boolean;
  junk: boolean;
  symlinks: boolean;
}

interface Source {
  name: string;
  path: string;
  st: Stat;
}

const USAGE = `Zip 3.0 (July 5th 2008). Usage:
zip [-options] [-b path] [-t mmddyyyy] [-n suffixes] [zipfile list] [-xi list]
  Adds each file in list to zipfile, updating entries that already exist.
  -r   descend into directories     -j   store bare file names, no paths
  -q   print nothing                -y   archive symlinks themselves
`;

/** Info-ZIP's percent(): rounds half up and never reports negative savings. */
function percent(size: number, packed: number): number {
  return size > packed ? Math.floor((1 + Math.floor((200 * (size - packed)) / size)) / 2) : 0;
}

/** Info-ZIP stores paths relative: leading "/", "./" and "../" components are dropped. */
function storedName(name: string): string {
  return name.replace(/^(\/|\.\.?\/)+/, '');
}

async function collect(ctx: Ctx, o: ZipOpts, arg: string, archive: string, out: Source[]): Promise<boolean> {
  const path = ctx.shell.abs(arg);
  let st: Stat;
  try {
    st = ctx.vfs.stat(path, !o.symlinks);
  } catch {
    return false;
  }
  if (path === archive) return true;
  const name = o.junk ? basename(arg) : storedName(arg.replace(/\/+$/, '')).replace(/^\.$/, '');
  if (st.kind !== 'dir') {
    out.push({ name, path, st });
    return true;
  }
  if (!o.junk && name) out.push({ name: `${name}/`, path, st });
  if (!o.recurse) return true;
  let children: string[] = [];
  try {
    children = ctx.vfs.readdir(path);
  } catch (e) {
    ctx.stdout.write(`\tzip warning: ${arg}: ${errMessage(e)}\n`);
  }
  for (const child of children) {
    await checkpoint(ctx.shell);
    await collect(ctx, o, `${arg.replace(/\/+$/, '')}/${child}`, archive, out);
  }
  return true;
}

function entryFor(ctx: Ctx, s: Source): ZipEntry {
  const { vfs } = ctx;
  if (s.st.kind === 'dir') return makeEntry(s.name, new Uint8Array(0), s.st.mode, 'dir', s.st.mtime);
  const data = s.st.kind === 'symlink' ? Buffer.from(vfs.readlink(s.path), 'utf8') : toBytes(vfs.readFile(s.path));
  return makeEntry(s.name, data, s.st.mode, s.st.kind, s.st.mtime);
}

async function zip(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'rqjy',
    long: { 'recurse-paths': 'r', quiet: 'q', 'junk-paths': 'j', symlinks: 'y' },
  });
  if (!operands.length) {
    ctx.stdout.write(USAGE);
    return 0;
  }
  const o: ZipOpts = { recurse: !!opts.r, quiet: !!opts.q, junk: !!opts.j, symlinks: !!opts.y };
  const zipName = /\.[^/]*$/.test(basename(operands[0])) ? operands[0] : `${operands[0]}.zip`;
  const archive = ctx.shell.abs(zipName);
  let entries: ZipEntry[] = [];
  if (ctx.vfs.exists(archive)) {
    try {
      entries = readZip(toBytes(ctx.vfs.readFile(archive)));
    } catch (e) {
      const why = e instanceof ZipError ? 'Zip file structure invalid' : errMessage(e);
      ctx.stdout.write(`\nzip error: ${why} (${zipName})\n`);
      return 3;
    }
  }
  const sources: Source[] = [];
  for (const arg of operands.slice(1)) {
    if (!(await collect(ctx, o, arg, archive, sources))) ctx.stdout.write(`\tzip warning: name not matched: ${arg}\n`);
  }
  if (!sources.length) {
    ctx.stdout.write(`\nzip error: Nothing to do! (${zipName})\n`);
    return 12;
  }
  let unreadable = false;
  for (const s of sources) {
    let entry: ZipEntry;
    try {
      entry = entryFor(ctx, s);
    } catch {
      ctx.stdout.write(`\tzip warning: could not open for reading: ${s.name}\n`);
      unreadable = true;
      continue;
    }
    const at = entries.findIndex((e) => e.name === entry.name);
    if (at === -1) entries.push(entry);
    else entries[at] = entry;
    const how = entry.method === 8 ? 'deflated' : 'stored';
    if (!o.quiet) ctx.stdout.write(`${at === -1 ? '  adding' : 'updating'}: ${entry.name} (${how} ${percent(entry.size, entry.packed.length)}%)\n`);
  }
  try {
    ctx.vfs.writeFile(archive, fromBytes(writeZip(entries)));
  } catch {
    ctx.stdout.write(`\nzip error: Could not create output file (${zipName})\n`);
    return 15;
  }
  if (!unreadable) return 0;
  ctx.stdout.write('\tzip warning: Not all files were readable\n');
  return 18;
}

export const zipCommand = command(zip);
