import type { CommandDef, CommandTable, Ctx } from '../types.ts';

const ADMIN = new Set([
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'adduser', 'chpasswd', 'reboot', 'shutdown', 'poweroff', 'halt',
  'service', 'ip', 'ping', 'sudo', 'lsblk', 'apt', 'apt-get', 'sync',
]);

const section = (name: string) => (ADMIN.has(name) ? 8 : 1);

function manual(ctx: Ctx, name: string): CommandDef | undefined {
  const def = ctx.shell.kernel.commands.get(name);
  return def && (!def.builtin || def.stub) ? def : undefined;
}

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
    const sec = section(name);
    const pages = manual(ctx, name) ? [`/usr/share/man/man${sec}/${name}.${sec}.gz`] : [];
    const found = [...(manOnly ? [] : bins), ...(binOnly ? [] : pages)];
    ctx.stdout.write(`${name}:${found.map((p) => ` ${p}`).join('')}\n`);
  }
  return 0;
}

function whatisLine(name: string, desc: string): string {
  return `${`${name} (${section(name)})`.padEnd(21)}- ${desc}\n`;
}

function whatis(ctx: Ctx): number {
  let status = 0;
  for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
    const def = manual(ctx, name);
    if (def) ctx.stdout.write(whatisLine(name, def.desc));
    else status = (ctx.stdout.write(`${name}: nothing appropriate.\n`), 16);
  }
  return status;
}

function apropos(ctx: Ctx): number {
  const words = ctx.args.filter((a) => !a.startsWith('-'));
  if (!words.length) return (ctx.stderr.write('apropos what?\n'), 1);
  const entries = [...ctx.shell.kernel.commands.keys()].sort().map((n) => [n, manual(ctx, n)] as const);
  let status = 0;
  for (const word of words) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hits = entries.filter(([n, def]) => def && (re.test(n) || re.test(def.desc)));
    if (!hits.length) status = (ctx.stdout.write(`${word}: nothing appropriate.\n`), 16);
    for (const [n, def] of hits) ctx.stdout.write(whatisLine(n, def!.desc));
  }
  return status;
}

function man(ctx: Ctx): number {
  const args = ctx.args.filter((a) => !/^\d[a-z]?$/.test(a));
  if (args[0] === '-k') return apropos({ ...ctx, args: args.slice(1) });
  if (args[0] === '-f') return whatis({ ...ctx, args: args.slice(1) });
  const names = args.filter((a) => !a.startsWith('-'));
  if (!names.length) return (ctx.stderr.write("What manual page do you want?\nFor example, try 'man man'.\n"), 1);
  let status = 0;
  for (const name of names) {
    const def = manual(ctx, name);
    if (!def) {
      status = (ctx.stderr.write(`No manual entry for ${name}\n`), 16);
      continue;
    }
    const sec = section(name);
    const tag = `${name.toUpperCase()}(${sec})`;
    const title = sec === 8 ? 'System Administration' : 'User Commands';
    const left = Math.floor((80 - title.length) / 2);
    const desc = def.desc.charAt(0).toUpperCase() + def.desc.slice(1).replace(/\.?$/, '.');
    ctx.stdout.write([
      `${tag.padEnd(left)}${title}`.padEnd(80 - tag.length) + tag,
      '',
      'NAME',
      `       ${name} - ${def.desc}`,
      '',
      'SYNOPSIS',
      `       ${name} [OPTION]... [ARGUMENT]...`,
      '',
      'DESCRIPTION',
      `       ${desc}`,
      '',
      `       Run '${name} --help' for a summary of options.`,
      '',
      `${'tuxrt'.padEnd(left)}${'October 2026'}`.padEnd(80 - tag.length) + tag,
      '',
    ].join('\n'));
  }
  return status;
}

const CLEAR = '\x1b[H\x1b[2J\x1b[3J';

export const docCommands: CommandTable = {
  which: { fn: which, desc: 'locate a command' },
  whereis: { fn: whereis, desc: 'locate the binary, source, and manual page files for a command' },
  man: { fn: man, desc: 'an interface to the system reference manuals' },
  whatis: { fn: whatis, desc: 'display one-line manual page descriptions' },
  apropos: { fn: apropos, desc: 'search the manual page names and descriptions' },
  clear: { fn: (ctx) => (ctx.stdout.write(ctx.args.includes('-x') ? '\x1b[H\x1b[2J' : CLEAR), 0), desc: 'clear the terminal screen' },
  reset: { fn: (ctx) => (ctx.stdout.write(CLEAR), 0), desc: 'terminal initialization' },
};
