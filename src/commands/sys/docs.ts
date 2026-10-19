import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { lookup, MANPATH, readPage } from './man/lookup.ts';
import { render } from './man/render.ts';
import { apropos, env, mandb, runApropos, runWhatis, searchOpts, whatis } from './man/search.ts';

function executable(ctx: Ctx, path: string): boolean {
  const node = ctx.vfs.tryLookup(path);
  return node?.kind === 'file' && ctx.vfs.can(node, 1);
}

function which(ctx: Ctx): number {
  const all = ctx.args.includes('-a');
  const names = ctx.args.filter((a) => a !== '-a' && a !== '-s');
  const dirs = (ctx.shell.get('PATH') ?? '').split(':');
  let status = names.length ? 0 : 1;
  for (const name of names) {
    const hits = name.includes('/')
      ? [name].filter((n) => executable(ctx, ctx.shell.abs(n)))
      : dirs.map((d) => `${d || '.'}/${name}`).filter((p) => executable(ctx, ctx.shell.abs(p)));
    if (!hits.length) status = 1;
    for (const hit of all ? hits : hits.slice(0, 1)) ctx.stdout.write(`${hit}\n`);
  }
  return status;
}

function whereis(ctx: Ctx): number {
  const binOnly = ctx.args.includes('-b');
  const manOnly = ctx.args.includes('-m');
  for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
    const bins = ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin'].map((d) => `${d}/${name}`).filter((p) => ctx.vfs.exists(p));
    const pages = lookup(ctx, name).map((e) => e.path);
    const found = [...(manOnly ? [] : bins), ...(binOnly ? [] : pages)];
    ctx.stdout.write(`${name}:${found.map((p) => ` ${p}`).join('')}\n`);
  }
  return 0;
}

const MAN_SPEC = {
  flags: 'afkwWlhV',
  values: 'sSMPCLm',
  long: {
    all: 'a', whatis: 'f', apropos: 'k', where: 'w', path: 'w', location: 'w', 'where-cat': 'W', 'location-cat': 'W',
    'local-file': 'l', 'sections=': 's', 'manpath=': 'M', 'pager=': 'P', 'config-file=': 'C', 'locale=': 'L', help: 'h', version: 'V',
  },
};

const USAGE = `Usage: man [OPTION...] [SECTION] PAGE...

  -a, --all                  find all matching manual pages
  -f, --whatis               equivalent to whatis
  -k, --apropos              equivalent to apropos
  -l, --local-file           interpret PAGE argument(s) as local filename(s)
  -s, --sections=LIST        use colon separated section list
  -w, --where, --path, --location
                             print physical location of man page(s)
  -h, --help                 give this help list
  -V, --version              print program version

Pages are formatted for MANWIDTH or COLUMNS (default 80) columns.
`;

const SECTION = /^(\d\w*|n|l)$/;

/** Splits "passwd(5)" and "passwd.5" style references into name and section. */
function reference(arg: string): [string, string] | undefined {
  const m = /^(.+)\((\w+)\)$/.exec(arg) ?? /^(.+)\.(\d\w*)$/.exec(arg);
  return m ? [m[1], m[2]] : undefined;
}

function man(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, MAN_SPEC);
  if (opts.h) return (ctx.stdout.write(USAGE), 0);
  if (opts.V) return (ctx.stdout.write('man 2.12.0\n'), 0);
  let { sections } = searchOpts(opts);
  if (opts.k) return runApropos(ctx, operands, { sections, mode: 'regex' });
  if (opts.f) return runWhatis(ctx, operands, { sections, mode: 'exact' });
  if (!operands.length) {
    if (opts.w) return (ctx.stdout.write(`${MANPATH.join(':')}\n`), 0);
    ctx.stderr.write("What manual page do you want?\nFor example, try 'man man'.\n");
    return 1;
  }
  const width = Number(env(ctx, 'MANWIDTH')) || Number(env(ctx, 'COLUMNS')) || 80;
  const show = (roff: string) => ctx.stdout.write(render(roff, width, !!ctx.stdout.isTTY));
  let status = 0;
  for (let i = 0; i < operands.length; i++) {
    const arg = operands[i];
    if (SECTION.test(arg) && i + 1 < operands.length) {
      sections = [arg];
      continue;
    }
    if (opts.l || arg.includes('/')) {
      try {
        if (opts.w) ctx.stdout.write(`${arg}\n`);
        else show(readPage(ctx, ctx.shell.abs(arg)));
      } catch (e) {
        status = (ctx.stderr.write(`man: ${arg}: ${(e as Error).message}\n`), 16);
      }
      continue;
    }
    let found = lookup(ctx, arg, sections);
    const ref = found.length ? undefined : reference(arg);
    if (ref) found = lookup(ctx, ref[0], [ref[1]]);
    if (!found.length) {
      const where = sections?.length === 1 ? ` in section ${sections[0]}` : '';
      status = (ctx.stderr.write(`No manual entry for ${arg}${where}\n`), 16);
      continue;
    }
    for (const entry of opts.a ? found : found.slice(0, 1)) {
      if (opts.w || opts.W) ctx.stdout.write(`${entry.path}\n`);
      else show(entry.roff());
    }
  }
  return status;
}

const CLEAR = '\x1b[H\x1b[2J\x1b[3J';

export const docCommands: CommandTable = {
  which: { fn: which, desc: 'locate a command' },
  whereis: { fn: whereis, desc: 'locate the binary, source, and manual page files for a command' },
  man: { fn: command(man), desc: 'an interface to the system reference manuals' },
  whatis: { fn: command(whatis), desc: 'display one-line manual page descriptions' },
  apropos: { fn: command(apropos), desc: 'search the manual page names and descriptions' },
  mandb: { fn: command(mandb), desc: 'create or update the manual page index caches' },
  clear: { fn: (ctx) => (ctx.stdout.write(ctx.args.includes('-x') ? '\x1b[H\x1b[2J' : CLEAR), 0), desc: 'clear the terminal screen' },
  reset: { fn: (ctx) => (ctx.stdout.write(CLEAR), 0), desc: 'terminal initialization' },
};
