import { readAll } from '../../../../shell/io.ts';
import { errMessage } from '../../../../vfs/errors.ts';
import type { Ctx } from '../../../types.ts';
import { fromBytes, toBytes } from '../../../../vfs/bytes.ts';
import { GzipError, gunzip, gzip, isGzip } from '../gzfmt.ts';
import { parseTarArgs, TarUsage, type TarArgs } from './args.ts';
import { createEntries } from './create.ts';
import { listOrExtract } from './extract.ts';
import { TarStatus } from './status.ts';
import { buildTar, parseTar } from './ustar.ts';

function usage(ctx: Ctx, msg: string): number {
  ctx.stderr.write(`tar: ${msg}\nTry 'tar --help' or 'tar --usage' for more information.\n`);
  return 2;
}

async function create(ctx: Ctx, a: TarArgs, status: TarStatus, file: string): Promise<number> {
  if (!a.operands.length) return usage(ctx, 'Cowardly refusing to create an empty archive');
  const path = file === '-' ? null : ctx.shell.abs(file);
  if (!path && ctx.stdout.isTTY) return status.fatal('Refusing to write archive contents to terminal (missing -f option?)');
  const badDir = a.operands.find((op) => !ctx.vfs.isDir(op.dir));
  if (badDir) return status.fatal(`${badDir.dir}: Cannot open: No such file or directory`);
  try {
    if (path) ctx.vfs.writeFile(path, '');
  } catch (e) {
    return status.fatal(`${file}: Cannot open: ${errMessage(e)}`);
  }
  const blocks = await createEntries(ctx, a, status, path, path ? ctx.stdout : ctx.stderr);
  let bytes: Uint8Array = buildTar(blocks);
  if (a.gzip || (a.auto && /\.(tgz|taz|gz)$/.test(file))) bytes = gzip(bytes).out;
  if (path) ctx.vfs.writeFile(path, fromBytes(bytes));
  else ctx.stdout.write(fromBytes(bytes));
  return status.finish();
}

function gzipFailure(ctx: Ctx, msg: string): number {
  ctx.stderr.write(`gzip: stdin: ${msg}\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now\n`);
  return 2;
}

async function read(ctx: Ctx, a: TarArgs, status: TarStatus, file: string): Promise<number> {
  let raw: Uint8Array;
  if (file === '-') {
    if (ctx.stdin.isTTY) return status.fatal('Refusing to read archive contents from terminal (missing -f option?)');
    raw = toBytes(await readAll(ctx.stdin));
  } else {
    try {
      raw = toBytes(ctx.vfs.readFile(ctx.shell.abs(file)));
    } catch (e) {
      return status.fatal(`${file}: Cannot open: ${errMessage(e)}`);
    }
  }
  if (a.mode === 'x' && !a.toStdout && !ctx.vfs.isDir(a.dir)) {
    const why = ctx.vfs.exists(a.dir) ? 'Not a directory' : 'No such file or directory';
    return status.fatal(`${a.dirArg ?? a.dir}: Cannot open: ${why}`);
  }
  if (isGzip(raw)) {
    try {
      raw = gunzip(raw);
    } catch (e) {
      return gzipFailure(ctx, e instanceof GzipError ? e.message : errMessage(e));
    }
  } else if (a.gzip) return gzipFailure(ctx, 'not in gzip format');
  const parsed = parseTar(raw, (msg) => status.error(msg));
  await listOrExtract(ctx, a, status, parsed.entries);
  if (parsed.fatal === 'Unexpected EOF in archive') return status.fatal(parsed.fatal);
  if (parsed.fatal) status.error(parsed.fatal);
  return status.finish();
}

export async function tarCommand(ctx: Ctx): Promise<number> {
  let a: TarArgs;
  try {
    a = parseTarArgs(ctx.args, ctx.shell.cwd);
  } catch (e) {
    if (e instanceof TarUsage) return usage(ctx, e.message);
    throw e;
  }
  if (!a.mode) return usage(ctx, "You must specify one of the '-Acdtrux', '--delete' or '--test-label' options");
  const status = new TarStatus(ctx.stderr);
  const file = a.file ?? '-';
  return a.mode === 'c' ? create(ctx, a, status, file) : read(ctx, a, status, file);
}
