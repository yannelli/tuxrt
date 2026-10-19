import { errMessage } from '../../../vfs/errors.ts';
import { basename, dirname } from '../../../vfs/path.ts';
import type { CommandTable, Ctx } from '../../types.ts';
import { abs, command } from '../../util.ts';
import { getopt } from '../args.ts';
import { SedRun } from './exec.ts';
import { SedInput } from './input.ts';
import { parseScript, SedError, type Cmd } from './parse.ts';

const LONG: Record<string, string> = {
  quiet: 'n', silent: 'n', 'regexp-extended': 'E', 'expression=': 'e', 'file=': 'f', 'in-place': 'i', separate: 's',
  unbuffered: 'u', 'line-length=': 'l', posix: 'P', debug: 'D', sandbox: 'S', 'follow-symlinks': 'F',
};

function backupName(file: string, suffix: string): string {
  if (!suffix.includes('*')) return file + suffix;
  const name = suffix.replaceAll('*', basename(file));
  return name.includes('/') ? name : `${dirname(file)}/${name}`;
}

async function inPlace(ctx: Ctx, run: SedRun, files: string[], suffix: string | true): Promise<number> {
  let status = 0;
  for (const f of files) {
    if (run.quit !== null) break;
    const path = abs(ctx, f);
    const node = ctx.vfs.tryLookup(path);
    if (!node || node.kind !== 'file') {
      ctx.stderr.write(node ? `sed: couldn't edit ${f}: not a regular file\n` : `sed: can't read ${f}: No such file or directory\n`);
      status = node ? 4 : 2;
      continue;
    }
    let buf = '';
    run.out = (s) => (buf += s);
    run.input = new SedInput(ctx, [f]);
    await run.run();
    if (typeof suffix === 'string') ctx.vfs.writeFile(abs(ctx, backupName(f, suffix)), ctx.vfs.readFile(path));
    ctx.vfs.writeFile(path, buf);
  }
  return status;
}

async function sed(ctx: Ctx): Promise<number> {
  const { list, opts, operands } = getopt(ctx.args, { flags: 'nErsuPDSF', values: 'efl', optional: 'i', long: LONG });
  const parts: string[] = [];
  for (const [k, v] of list) {
    if (k === 'e') parts.push(String(v));
    else if (k === 'f') {
      try {
        parts.push(ctx.vfs.readFile(abs(ctx, String(v))).replace(/\n$/, ''));
      } catch (e) {
        ctx.stderr.write(`sed: couldn't open file ${v}: ${errMessage(e)}\n`);
        return 1;
      }
    }
  }
  const files = [...operands];
  if (!parts.length) {
    if (!files.length) {
      ctx.stderr.write('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n');
      return 1;
    }
    parts.push(files.shift()!);
  }
  const script = parts.join('\n');
  let prog: Cmd[];
  try {
    prog = parseScript(script, !!(opts.E || opts.r));
  } catch (e) {
    if (!(e instanceof SedError)) throw e;
    ctx.stderr.write(`sed: ${e.message}\n`);
    return 1;
  }
  for (const c of prog) {
    if (c.file && 'wWs'.includes(c.name) && !c.file.startsWith('/dev/std')) ctx.vfs.writeFile(abs(ctx, c.file), '');
  }
  const quiet = !!opts.n || /^#n(\n|$)/.test(script);
  const run = new SedRun(prog, ctx, quiet, Number(opts.l ?? 70));
  const inputs = files.length ? files : ['-'];
  let status = 0;
  try {
    if (opts.i !== undefined) status = await inPlace(ctx, run, inputs, opts.i);
    else {
      run.out = (s) => ctx.stdout.write(s);
      for (const group of opts.s ? inputs.map((f) => [f]) : [inputs]) {
        if (run.quit !== null) break;
        run.input = new SedInput(ctx, group);
        await run.run();
        if (run.input.failed) status = 2;
      }
    }
  } catch (e) {
    if (!(e instanceof SedError)) throw e;
    ctx.stderr.write(`sed: ${e.message}\n`);
    return 4;
  }
  return run.quit || status;
}

export const sedCommands: CommandTable = {
  sed: { fn: command(sed), desc: 'edit text streams with a script' },
};
