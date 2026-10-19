import { checkpoint } from '../../../../shell/interpreter.ts';
import { lineReader } from '../../../../shell/io.ts';
import { errMessage } from '../../../../vfs/errors.ts';
import { basename, dirname, normalize } from '../../../../vfs/path.ts';
import type { Ctx } from '../../../types.ts';
import { fromBytes } from '../../bytes.ts';
import { crc32 } from '../gzfmt.ts';
import { safeName } from '../tar/names.ts';
import { S_IFLNK, S_IFMT, unixMode, unpack, type ZipEntry } from './format.ts';

export interface UnzipOpts {
  overwrite: boolean;
  never: boolean;
  quiet: boolean;
  junk: boolean;
  exdir: string | null;
}

interface Run {
  ctx: Ctx;
  o: UnzipOpts;
  root: string;
  policy: 'ask' | 'all' | 'none';
  status: number;
  dirs: [string, ZipEntry][];
}

const hex = (n: number) => n.toString(16).padStart(8, '0');

function labelOf(r: Run, name: string): string {
  return r.o.exdir ? `${r.o.exdir.replace(/\/+$/, '')}/${name}` : name;
}

function say(r: Run, line: string): void {
  if (!r.o.quiet) r.ctx.stdout.write(`${line}\n`);
}

/** Info-ZIP's overwrite prompt. Only asked on a terminal; otherwise existing files are kept, like -n. */
async function decide(r: Run, label: string): Promise<string | null> {
  const { ctx } = r;
  if (r.o.overwrite || r.policy === 'all') return label;
  if (r.o.never || r.policy === 'none' || !ctx.stdin.isTTY) return null;
  for (;;) {
    ctx.stdout.write(`replace ${label}? [y]es, [n]o, [A]ll, [N]one, [r]ename: `);
    const answer = await lineReader(ctx.stdin).next();
    if (answer === null) {
      ctx.stdout.write('NULL\n(EOF or read error, treating as "[N]one" ...)\n');
      r.policy = 'none';
      return null;
    }
    const c = answer.trim()[0] ?? '';
    if (c === 'y' || c === 'Y') return label;
    if (c === 'n') return null;
    if (c === 'A' || c === 'N') {
      r.policy = c === 'A' ? 'all' : 'none';
      return c === 'A' ? label : null;
    }
    if (c === 'r' || c === 'R') {
      ctx.stdout.write('new name: ');
      return (await lineReader(ctx.stdin).next())?.trim() || null;
    }
    ctx.stdout.write(`error:  invalid response [${answer.trim()}]\n`);
  }
}

function setMeta(r: Run, path: string, e: ZipEntry): void {
  const { vfs } = r.ctx;
  const mode = unixMode(e);
  if (mode !== null) vfs.chmod(path, mode & 0o777);
  vfs.touch(path, e.mtime);
}

async function extractFile(r: Run, e: ZipEntry, name: string): Promise<void> {
  const { ctx } = r;
  const { vfs } = ctx;
  let label = labelOf(r, name);
  let path = normalize(name, r.root);
  if (vfs.tryLookup(path, false)) {
    const chosen = await decide(r, label);
    if (chosen === null) return;
    if (chosen !== label) [label, path] = [chosen, ctx.shell.abs(chosen)];
  }
  let data: Uint8Array;
  try {
    data = unpack(e);
  } catch (err) {
    ctx.stderr.write(`   skipping: ${label}  ${errMessage(err)}\n`);
    r.status = Math.max(r.status, 1);
    return;
  }
  const mode = unixMode(e);
  const link = mode !== null && (mode & S_IFMT) === S_IFLNK;
  say(r, link ? `    linking: ${label}  -> ${fromBytes(data)} ` : `${e.method === 0 ? ' extracting' : '  inflating'}: ${label.padEnd(22)}  `);
  if (crc32(data) !== e.crc) {
    ctx.stderr.write(`${label}:  bad CRC ${hex(crc32(data))}  (should be ${hex(e.crc)})\n`);
    r.status = 2;
    return;
  }
  try {
    vfs.mkdir(dirname(path), true);
    if (vfs.tryLookup(path, false)) vfs.unlink(path);
    if (link) vfs.symlink(fromBytes(data), path);
    else {
      vfs.writeFile(path, fromBytes(data));
      setMeta(r, path, e);
    }
  } catch (err) {
    ctx.stderr.write(`error:  cannot create ${label}\n        ${errMessage(err)}\n`);
    r.status = Math.max(r.status, 1);
  }
}

/** Extracts entries below `root`; returns the Info-ZIP exit status (0, 1 warnings, 2 errors). */
export async function extract(ctx: Ctx, o: UnzipOpts, root: string, entries: ZipEntry[]): Promise<number> {
  const r: Run = { ctx, o, root, policy: 'ask', status: 0, dirs: [] };
  for (const e of entries) {
    await checkpoint(ctx.shell);
    const isDir = e.name.endsWith('/');
    if (isDir && o.junk) continue;
    const name = o.junk ? basename(e.name) : safeName(e.name).name;
    if (!isDir) {
      await extractFile(r, e, name);
      continue;
    }
    const path = normalize(name, root);
    if (!ctx.vfs.isDir(path)) {
      try {
        ctx.vfs.mkdir(path, true);
      } catch (err) {
        ctx.stderr.write(`checkdir error:  cannot create ${name}\n                 ${errMessage(err)}\n`);
        r.status = 2;
        continue;
      }
      say(r, `   creating: ${labelOf(r, name)}`);
    }
    r.dirs.push([path, e]);
  }
  for (const [path, e] of r.dirs.reverse()) {
    try {
      setMeta(r, path, e);
    } catch {
      // Pre-existing directories we do not own keep their attributes; unzip does not fail on that.
    }
  }
  return r.status;
}
