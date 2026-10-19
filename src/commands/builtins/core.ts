import { ansiC } from '../../shell/expand.ts';
import { BreakSignal, ContinueSignal, ExitSignal, ReturnSignal } from '../../shell/control.ts';
import { runSource } from '../../shell/interpreter.ts';
import { shellQuote } from '../../shell/quote.ts';
import { resolveCommand } from '../../shell/resolve.ts';
import { dispatch } from '../../shell/simple.ts';
import type { Shell } from '../../shell/shell.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { bfail } from '../util.ts';

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do', 'done', 'in', 'function', '{', '}', '!', '[[', ']]']);

function cd(ctx: Ctx): number {
  const { shell } = ctx;
  const args = [...ctx.args];
  while (/^-[LPe@]+$/.test(args[0] ?? '')) args.shift();
  if (args[0] === '--') args.shift();
  if (args.length > 1) return bfail(ctx, 'too many arguments');
  let target = args[0] ?? shell.get('HOME');
  if (target === undefined) return bfail(ctx, 'HOME not set');
  if (target === '-') {
    target = shell.get('OLDPWD') ?? '';
    if (!target) return bfail(ctx, 'OLDPWD not set');
    ctx.stdout.write(`${target}\n`);
  }
  const path = shell.abs(target);
  const node = shell.vfs.tryLookup(path);
  if (!node) return bfail(ctx, `${target}: No such file or directory`);
  if (node.kind !== 'dir') return bfail(ctx, `${target}: Not a directory`);
  if (!shell.vfs.can(node, 1)) return bfail(ctx, `${target}: Permission denied`);
  shell.cwd = path;
  return 0;
}

function echo(ctx: Ctx): number {
  let args = ctx.args;
  let newline = true;
  let escapes = false;
  while (args.length && /^-[neE]+$/.test(args[0])) {
    for (const f of args[0].slice(1)) {
      if (f === 'n') newline = false;
      else escapes = f === 'e';
    }
    args = args.slice(1);
  }
  let text = args.join(' ');
  if (escapes) {
    const cut = text.indexOf('\\c');
    if (cut !== -1) {
      text = text.slice(0, cut);
      newline = false;
    }
    text = ansiC(text.replace(/\\0([0-7]{0,3})/g, (_, o: string) => String.fromCharCode(parseInt(o || '0', 8))));
  }
  ctx.stdout.write(newline ? `${text}\n` : text);
  return 0;
}

function exit(ctx: Ctx): number {
  const { shell } = ctx;
  const code = ctx.args[0] !== undefined ? Number(ctx.args[0]) & 255 : shell.status;
  if (Number.isNaN(code)) {
    bfail(ctx, `${ctx.args[0]}: numeric argument required`);
    throw new ExitSignal(2);
  }
  const prev = shell.logins.pop();
  if (prev) {
    ctx.stdout.write('logout\n');
    shell.vars = prev.vars;
    shell.applyUser(prev.user);
    shell.vars.set('PWD', prev.cwd);
    return 0;
  }
  if (shell.interactive) ctx.stderr.write('exit\n');
  throw new ExitSignal(code);
}

function loopControl(ctx: Ctx): number {
  const n = Number(ctx.args[0] ?? 1);
  if (!Number.isInteger(n) || n < 1) return bfail(ctx, `${ctx.args[0]}: loop count out of range`);
  throw ctx.name === 'break' ? new BreakSignal(n) : new ContinueSignal(n);
}

async function source(ctx: Ctx): Promise<number> {
  const [file, ...args] = ctx.args;
  if (!file) return bfail(ctx, 'filename argument required', 2);
  const { shell } = ctx;
  const candidates = file.includes('/') ? [file] : [...(shell.get('PATH') ?? '').split(':').map((d) => `${d}/${file}`), file];
  const path = candidates.map((c) => shell.abs(c)).find((p) => shell.vfs.tryLookup(p)?.kind === 'file');
  if (!path) return bfail(ctx, `${file}: No such file or directory`);
  const saved = shell.positional;
  if (args.length) shell.positional = args;
  try {
    return await runSource(shell, shell.vfs.readFile(path), ctx);
  } catch (e) {
    if (e instanceof ReturnSignal) return e.code;
    throw e;
  } finally {
    if (args.length) shell.positional = saved;
  }
}

function describeName(shell: Shell, name: string): { kind: string; text: string } | null {
  if (shell.aliases.has(name)) return { kind: 'alias', text: `${name} is aliased to \`${shell.aliases.get(name)}'` };
  if (KEYWORDS.has(name)) return { kind: 'keyword', text: `${name} is a shell keyword` };
  const r = resolveCommand(name, shell);
  if (!r || r.kind === 'error') return null;
  if (r.kind === 'function') return { kind: 'function', text: `${name} is a function` };
  if (r.kind === 'builtin') return { kind: 'builtin', text: `${name} is a shell builtin` };
  if (r.kind === 'binary' || r.kind === 'script') return { kind: 'file', text: `${name} is ${r.path}` };
  return null;
}

function type(ctx: Ctx): number {
  const terse = ctx.args.includes('-t');
  let status = 0;
  for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
    const d = describeName(ctx.shell, name);
    if (!d) status = bfail(ctx, `${name}: not found`);
    else ctx.stdout.write(`${terse ? d.kind : d.text}\n`);
  }
  return status;
}

async function commandBuiltin(ctx: Ctx): Promise<number> {
  const flag = ctx.args[0];
  if (flag === '-v' || flag === '-V') {
    let status = 0;
    for (const name of ctx.args.slice(1)) {
      const r = resolveCommand(name, ctx.shell, true);
      if (!r || r.kind === 'error') status = 1;
      else if (flag === '-V') ctx.stdout.write(`${describeName(ctx.shell, name)?.text}\n`);
      else ctx.stdout.write(`${r.kind === 'binary' || r.kind === 'script' ? r.path : r.kind === 'alias' ? `alias ${name}=${shellQuote(r.value)}` : name}\n`);
    }
    return status;
  }
  return ctx.args.length ? dispatch(ctx.args, ctx.shell, ctx) : 0;
}

function alias(ctx: Ctx): number {
  const { aliases } = ctx.shell;
  const args = ctx.args.filter((a) => a !== '-p');
  if (!args.length) {
    for (const [k, v] of [...aliases].sort()) ctx.stdout.write(`alias ${k}=${shellQuote(v)}\n`);
    return 0;
  }
  let status = 0;
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) aliases.set(a.slice(0, eq), a.slice(eq + 1));
    else if (aliases.has(a)) ctx.stdout.write(`alias ${a}=${shellQuote(aliases.get(a)!)}\n`);
    else status = bfail(ctx, `${a}: not found`);
  }
  return status;
}

function unalias(ctx: Ctx): number {
  if (ctx.args[0] === '-a') {
    ctx.shell.aliases.clear();
    return 0;
  }
  let status = 0;
  for (const a of ctx.args) if (!ctx.shell.aliases.delete(a)) status = bfail(ctx, `${a}: not found`);
  return status;
}

function umask(ctx: Ctx): number {
  const { vfs } = ctx;
  if (!ctx.args.length) ctx.stdout.write(`${vfs.umask.toString(8).padStart(4, '0')}\n`);
  else if (/^[0-7]{1,4}$/.test(ctx.args[0])) vfs.umask = parseInt(ctx.args[0], 8);
  else return bfail(ctx, `${ctx.args[0]}: octal number out of range`);
  return 0;
}

export const coreBuiltins: CommandTable = {
  cd: { fn: cd, builtin: true, desc: 'Change the shell working directory' },
  pwd: { fn: (ctx) => (ctx.stdout.write(`${ctx.args.includes('-P') ? ctx.vfs.realpath(ctx.shell.cwd) : ctx.shell.cwd}\n`), 0), builtin: true, stub: true, desc: 'Print the current directory path' },
  echo: { fn: echo, builtin: true, stub: true, desc: 'Write arguments to the standard output' },
  true: { fn: () => 0, builtin: true, stub: true, desc: 'Return a successful result' },
  false: { fn: () => 1, builtin: true, stub: true, desc: 'Return an unsuccessful result' },
  ':': { fn: () => 0, builtin: true, desc: 'Null command' },
  exit: { fn: exit, builtin: true, desc: 'Exit the shell' },
  logout: { fn: exit, builtin: true, desc: 'Exit a login shell' },
  return: { fn: (ctx) => { throw new ReturnSignal(ctx.args[0] ? Number(ctx.args[0]) & 255 : ctx.shell.status); }, builtin: true, desc: 'Return from a shell function' },
  break: { fn: loopControl, builtin: true, desc: 'Exit for, while, or until loops' },
  continue: { fn: loopControl, builtin: true, desc: 'Skip to the next loop pass' },
  source: { fn: source, builtin: true, desc: 'Run a script inside this shell' },
  '.': { fn: source, builtin: true, desc: 'Run a script inside this shell' },
  eval: { fn: (ctx) => runSource(ctx.shell, ctx.args.join(' '), ctx), builtin: true, desc: 'Execute arguments as a shell command' },
  exec: { fn: async (ctx) => { if (!ctx.args.length) return 0; throw new ExitSignal(await dispatch(ctx.args, ctx.shell, ctx)); }, builtin: true, desc: 'Swap this shell for a command' },
  type: { fn: type, builtin: true, desc: 'Display information about command type' },
  command: { fn: commandBuiltin, builtin: true, desc: 'Run or describe a command' },
  alias: { fn: alias, builtin: true, desc: 'Define or display aliases' },
  unalias: { fn: unalias, builtin: true, desc: 'Remove alias definitions' },
  umask: { fn: umask, builtin: true, desc: 'Display or set file mode mask' },
  hash: { fn: () => 0, builtin: true, desc: 'Remember or display program locations' },
  trap: { fn: () => 0, builtin: true, desc: 'Trap signals and other events' },
};
