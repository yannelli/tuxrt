import type { CommandDef, Ctx } from '../commands/types.ts';
import { FsError, errMessage } from '../vfs/errors.ts';
import type { Node } from './ast.ts';
import { BreakSignal, ContinueSignal, ExitSignal, Interrupt, ReturnSignal } from './control.ts';
import { expandWord, expandWords } from './expand.ts';
import { BrokenPipe, type IO } from './io.ts';
import { ParamError } from './params.ts';
import { parse } from './parser.ts';
import { shellQuote } from './quote.ts';
import { openRedirs, RedirError } from './redirect.ts';
import { resolveCommand } from './resolve.ts';
import { runScriptFile } from './script.ts';
import type { Shell } from './shell.ts';
import { exec } from './interpreter.ts';

type CmdNode = Extract<Node, { type: 'cmd' }>;

export async function execSimple(node: CmdNode, shell: Shell, io: IO): Promise<number> {
  const aliased = expandAlias(node, shell);
  if (aliased) return exec(aliased, shell, io);

  shell.lastSubst = null;
  const argv = await expandWords(node.words, shell);
  const assigns: [string, string][] = [];
  for (const a of node.assigns) {
    const eq = a.indexOf('=');
    const append = a[eq - 1] === '+';
    const name = a.slice(0, append ? eq - 1 : eq);
    const value = await expandWord(a.slice(eq + 1), shell);
    assigns.push([name, append ? (shell.get(name) ?? '') + value : value]);
  }
  if (!argv.length) {
    for (const [name, value] of assigns) shell.set(name, value);
    return (await openRedirs(node.redirs, shell, io)) ? (shell.lastSubst ?? 0) : 1;
  }

  const cmdIO = await openRedirs(node.redirs, shell, io);
  if (!cmdIO) return 1;
  if (shell.options.xtrace) io.stderr.write(`+ ${[...assigns.map(([k, v]) => `${k}=${shellQuote(v)}`), ...argv.map(shellQuote)].join(' ')}\n`);

  const saved = assigns.map(([name]) => [name, shell.vars.get(name), shell.exported.has(name)] as const);
  for (const [name, value] of assigns) shell.export(name, value);
  try {
    return await dispatch(argv, shell, cmdIO);
  } finally {
    for (const [name, value, wasExported] of saved) {
      if (value === undefined) shell.unset(name);
      else shell.set(name, value);
      if (!wasExported) shell.exported.delete(name);
    }
  }
}

function expandAlias(node: CmdNode, shell: Shell): Node | null {
  const first = node.words[0];
  if (!first || !shell.aliases.has(first) || node.noAlias?.includes(first)) return null;
  const src = [...node.assigns, shell.aliases.get(first)!, ...node.words.slice(1)].join(' ');
  const parsed = parse(src);
  const seen = [...(node.noAlias ?? []), first];
  const mark = (n: Node): void => {
    if (n.type === 'cmd') n.noAlias = seen;
    else if (n.type === 'pipe') n.cmds.forEach(mark);
    else if (n.type === 'seq') n.items.forEach(mark);
    else if (n.type === 'and' || n.type === 'or') (mark(n.left), mark(n.right));
  };
  mark(parsed);
  return node.redirs.length ? { type: 'redirect', body: parsed, redirs: node.redirs } : parsed;
}

/** Runs an already-expanded argv: function, builtin, /usr/bin binary, or script. */
export async function dispatch(argv: string[], shell: Shell, io: IO): Promise<number> {
  const [name, ...args] = argv;
  const found = resolveCommand(name, shell);
  if (!found) {
    io.stderr.write(`${name}: command not found\n`);
    return 127;
  }
  switch (found.kind) {
    case 'function':
      return callFunction(shell.functions.get(name)!, args, shell, io);
    case 'builtin':
      return runCommand(found.def, name, args, shell, io);
    case 'binary': {
      if (shell.jobProc !== null) {
        shell.jobProc = null;
        return runCommand(found.def, name, args, shell, io);
      }
      const proc = shell.kernel.procs.spawn(argv.join(' '), shell.user.uid, shell.pid, shell.job);
      try {
        return await runCommand(found.def, name, args, shell, io);
      } finally {
        shell.kernel.procs.exit(proc.pid);
      }
    }
    case 'script':
      return runScriptFile(found.path, name, args, shell, io);
    case 'error':
      io.stderr.write(`${shell.argv0}: ${found.message}\n`);
      return found.code;
    case 'alias':
      return 1;
  }
}

async function callFunction(body: Node, args: string[], shell: Shell, io: IO): Promise<number> {
  const savedArgs = shell.positional;
  shell.positional = args;
  shell.locals.push(new Map());
  try {
    return await exec(body, shell, io);
  } catch (e) {
    if (e instanceof ReturnSignal) return e.code;
    throw e;
  } finally {
    for (const [name, value] of shell.locals.pop()!) {
      if (value === undefined) shell.unset(name);
      else shell.set(name, value);
    }
    shell.positional = savedArgs;
  }
}

const passthrough = [BrokenPipe, ExitSignal, ReturnSignal, BreakSignal, ContinueSignal, Interrupt, ParamError, RedirError];

async function runCommand(def: CommandDef, name: string, args: string[], shell: Shell, io: IO): Promise<number> {
  const { stdin, stdout, stderr } = io;
  const ctx: Ctx = { name, args, stdin, stdout, stderr, shell, vfs: shell.vfs, signal: shell.signal, env: shell.env() };
  try {
    return await def.fn(ctx);
  } catch (e) {
    if (passthrough.some((cls) => e instanceof cls)) throw e;
    const where = e instanceof FsError && e.path ? `${e.path}: ` : '';
    io.stderr.write(`${name}: ${where}${errMessage(e)}\n`);
    return 1;
  }
}
