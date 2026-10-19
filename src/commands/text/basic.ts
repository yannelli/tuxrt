import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fsFail, parseArgs, readInputs } from '../util.ts';
import { chomp, chunks, eachLine, pause, splitKeep, toBytes } from './stream.ts';

function caret(b: number): string {
  if (b < 32) return `^${String.fromCharCode(b + 64)}`;
  return b === 127 ? '^?' : String.fromCharCode(b);
}

/** cat -v: control characters as ^X, high bytes as M-X. */
export function showNonprinting(s: string, tabs: boolean): string {
  if (!/[^\x20-\x7e\t]/.test(s)) return tabs ? s.replaceAll('\t', '^I') : s;
  let out = '';
  for (const b of toBytes(s)) {
    if (b === 9 && !tabs) out += '\t';
    else out += b >= 128 ? `M-${caret(b - 128)}` : caret(b);
  }
  return out;
}

async function cat(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'AbeEnstTuv',
    long: { 'show-all': 'A', 'number-nonblank': 'b', 'show-ends': 'E', number: 'n', 'squeeze-blank': 's', 'show-tabs': 'T', 'show-nonprinting': 'v' },
  });
  const ends = !!(opts.A || opts.e || opts.E);
  const tabs = !!(opts.A || opts.t || opts.T);
  const nonprint = !!(opts.A || opts.e || opts.t || opts.v);
  const files = operands.length ? operands : ['-'];
  if (!ends && !tabs && !nonprint && !opts.n && !opts.b && !opts.s) {
    let status = 0;
    for (const f of files) {
      if (f === '-') {
        for await (const c of chunks(ctx.stdin)) ctx.stdout.write(c);
        continue;
      }
      try {
        ctx.stdout.write(ctx.vfs.readFile(abs(ctx, f)));
      } catch (e) {
        status = fsFail(ctx, f, e);
      }
    }
    return status;
  }
  let num = 0;
  let prevBlank = false;
  return eachLine(ctx, files, (line) => {
    const nl = line.endsWith('\n');
    let body = chomp(line);
    const blank = body === '';
    if (opts.s && blank && prevBlank) return;
    prevBlank = blank;
    const numbered = opts.b ? !blank : !!opts.n;
    if (nonprint) body = showNonprinting(body, tabs);
    else if (tabs) body = body.replaceAll('\t', '^I');
    if (ends && nl) body += '$';
    ctx.stdout.write(`${numbered ? `${String(++num).padStart(6)}\t` : ''}${body}${nl ? '\n' : ''}`);
  });
}

async function tee(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'aip', long: { append: 'a', 'ignore-interrupts': 'i' } });
  let status = 0;
  const targets: string[] = [];
  for (const f of operands) {
    try {
      ctx.vfs.writeFile(abs(ctx, f), '', !!opts.a);
      targets.push(abs(ctx, f));
    } catch (e) {
      status = fsFail(ctx, f, e);
    }
  }
  for await (const c of chunks(ctx.stdin)) {
    ctx.stdout.write(c);
    for (const t of targets) ctx.vfs.writeFile(t, c, true);
  }
  return status;
}

async function yes(ctx: Ctx): Promise<number> {
  const args = ctx.args[0] === '--' ? ctx.args.slice(1) : ctx.args;
  const line = `${args.length ? args.join(' ') : 'y'}\n`;
  const block = line.repeat(Math.max(1, Math.floor(4096 / line.length)));
  for (;;) {
    for (let i = 0; i < 16; i++) ctx.stdout.write(block);
    await pause(ctx);
  }
}

export const basicCommands: CommandTable = {
  cat: { fn: command(cat), desc: 'join files and print them' },
  tac: {
    desc: 'concatenate and print files in reverse',
    fn: command((ctx) => readInputs(ctx, parseArgs(ctx.args, {}).operands, (text) => ctx.stdout.write(splitKeep(text).reverse().join('')))),
  },
  rev: {
    desc: 'reverse lines characterwise',
    fn: command((ctx) => eachLine(ctx, parseArgs(ctx.args, {}).operands, (l) => {
      ctx.stdout.write([...chomp(l)].reverse().join('') + (l.endsWith('\n') ? '\n' : ''));
    })),
  },
  tee: { fn: command(tee), desc: 'copy stdin to stdout and files' },
  yes: { fn: yes, desc: 'output a string repeatedly until killed' },
};
