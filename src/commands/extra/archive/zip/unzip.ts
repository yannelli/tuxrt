import { globToRegExp } from '../../../../shell/glob.ts';
import type { Ctx } from '../../../types.ts';
import { command, parseArgs } from '../../../util.ts';
import { fromBytes, toBytes } from '../../bytes.ts';
import { isoMinute } from '../stamp.ts';
import { extract, type UnzipOpts } from './extract.ts';
import { readZip, unpack, ZipError, type ZipEntry } from './format.ts';

const USAGE = `UnZip 6.00 of 20 April 2009, by Debian. Original by Info-ZIP.

Usage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]
  Default action is to extract files in list, except those in xlist, to exdir;
  file[.zip] may be a wildcard.  -Z => ZipInfo mode ("unzip -Z" for usage).

  -p  extract files to pipe, no messages     -l  list files (short format)
  -d  extract files into exdir               -j  junk paths (do not make directories)
  -o  overwrite files WITHOUT prompting      -n  never overwrite existing files
  -q  quiet mode (-qq => quieter)
`;

const NO_EOCD = `  End-of-central-directory signature not found.  Either this file is not
  a zipfile, or it constitutes one disk of a multi-part archive.  In the
  latter case the central directory and zipfile comment will be found on
  the last disk(s) of this archive.
`;

function open(ctx: Ctx, arg: string): { name: string; bytes: Uint8Array } | null {
  for (const name of [arg, `${arg}.zip`, `${arg}.ZIP`]) {
    const path = ctx.shell.abs(name);
    if (ctx.vfs.tryLookup(path)?.kind !== 'file') continue;
    try {
      return { name, bytes: toBytes(ctx.vfs.readFile(path)) };
    } catch {
      return null;
    }
  }
  return null;
}

function list(ctx: Ctx, entries: ZipEntry[]): void {
  let total = 0;
  let out = '  Length      Date    Time    Name\n---------  ---------- -----   ----\n';
  for (const e of entries) {
    total += e.size;
    out += `${String(e.size).padStart(9)}  ${isoMinute(e.mtime)}   ${e.name}\n`;
  }
  const n = entries.length;
  out += `---------                     -------\n${String(total).padStart(9)}                     ${n} file${n === 1 ? '' : 's'}\n`;
  ctx.stdout.write(out);
}

async function unzip(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'lonqjp', values: 'd' });
  if (!operands.length) {
    ctx.stdout.write(USAGE);
    return 0;
  }
  const [arg, ...patterns] = operands;
  const archive = open(ctx, arg);
  if (!archive) {
    ctx.stderr.write(`unzip:  cannot find or open ${arg}, ${arg}.zip or ${arg}.ZIP.\n`);
    return 9;
  }
  const quiet = !!opts.q || !!opts.p;
  if (!quiet) ctx.stdout.write(`Archive:  ${archive.name}\n`);
  let entries: ZipEntry[];
  try {
    entries = readZip(archive.bytes);
  } catch (e) {
    const detail = e instanceof ZipError && e.message.startsWith('End-of') ? NO_EOCD : `error: ${(e as Error).message}\n`;
    ctx.stderr.write(`${detail}unzip:  cannot find zipfile directory in one of ${arg} or\n        ${arg}.zip, and cannot find ${arg}.ZIP, period.\n`);
    return 9;
  }
  const matchers = patterns.map((p) => globToRegExp(p));
  const used = new Set<number>();
  const selected = !matchers.length ? entries : entries.filter((e) => {
    const hits = matchers.map((m, i) => (m.test(e.name) ? i : -1)).filter((i) => i >= 0);
    for (const i of hits) used.add(i);
    return hits.length > 0;
  });
  let status = 0;
  if (opts.l) list(ctx, selected);
  else if (opts.p) ctx.stdout.write(fromBytes(Buffer.concat(selected.filter((e) => !e.name.endsWith('/')).map(unpack))));
  else {
    const exdir = typeof opts.d === 'string' ? opts.d : null;
    const o: UnzipOpts = { overwrite: !!opts.o, never: !!opts.n, quiet, junk: !!opts.j, exdir };
    status = await extract(ctx, o, ctx.shell.abs(exdir ?? '.'), selected);
  }
  const missing = patterns.filter((_, i) => !used.has(i));
  for (const p of missing) ctx.stderr.write(`caution: filename not matched:  ${p}\n`);
  return missing.length ? 11 : status;
}

export const unzipCommand = command(unzip);
