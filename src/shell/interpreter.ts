import { IncompleteInput, ShellSyntaxError, type Node } from './ast.ts';
import { execCond } from './cond.ts';
import { BreakSignal, ContinueSignal, ExitSignal, Interrupt, ReturnSignal } from './control.ts';
import { expandPattern, expandWord, expandWords } from './expand.ts';
import { globToRegExp } from './glob.ts';
import { BrokenPipe, Pipe, type IO } from './io.ts';
import { startJob } from './jobs.ts';
import { ParamError } from './params.ts';
import { parse } from './parser.ts';
import { openRedirs, RedirError } from './redirect.ts';
import type { Shell } from './shell.ts';
import { execSimple } from './simple.ts';

export interface RunOptions {
  /** Treat `exit` as ending only this run (subshells, command substitution, scripts). */
  subshell?: boolean;
}

export async function runSource(shell: Shell, src: string, io: IO, opts: RunOptions = {}): Promise<number> {
  let ast: Node;
  try {
    ast = parse(src);
  } catch (e) {
    if (e instanceof ShellSyntaxError || e instanceof IncompleteInput) {
      io.stderr.write(`${shell.argv0}: ${e.message}\n`);
      return (shell.status = 2);
    }
    throw e;
  }
  return runNode(shell, ast, io, opts);
}

export async function runNode(shell: Shell, ast: Node, io: IO, opts: RunOptions = {}): Promise<number> {
  try {
    return (shell.status = await exec(ast, shell, io));
  } catch (e) {
    if (e instanceof ExitSignal && opts.subshell) return (shell.status = e.code);
    if (e instanceof ParamError || e instanceof RedirError) {
      io.stderr.write(`${shell.argv0}: ${e.message}\n`);
      if (!shell.interactive && e instanceof ParamError) throw new ExitSignal(1);
      return (shell.status = 1);
    }
    if (e instanceof BreakSignal || e instanceof ContinueSignal) return (shell.status = 0);
    throw e;
  }
}

let ticks = 0;

/** Checks for delivered signals and periodically yields so timers, Ctrl-C and other jobs get to run. */
export async function checkpoint(shell: Shell): Promise<void> {
  if (shell.signal.aborted) throw new Interrupt(128 + (Number(shell.signal.reason) || 2));
  if (++ticks % 256 === 0) await new Promise((r) => setImmediate(r));
}

export async function exec(node: Node, shell: Shell, io: IO): Promise<number> {
  await checkpoint(shell);
  switch (node.type) {
    case 'seq': {
      let status = 0;
      for (const item of node.items) {
        status = shell.status = await exec(item, shell, io);
        if (status && shell.options.errexit && !['and', 'or', 'not'].includes(item.type)) throw new ExitSignal(status);
      }
      return status;
    }
    case 'bg':
      return startJob(node.body, shell, io);
    case 'and':
    case 'or': {
      const left = (shell.status = await exec(node.left, shell, io));
      return (left === 0) === (node.type === 'and') ? exec(node.right, shell, io) : left;
    }
    case 'not':
      return (await exec(node.body, shell, io)) === 0 ? 1 : 0;
    case 'pipe':
      return execPipeline(node.cmds, shell, io);
    case 'cmd':
      return execSimple(node, shell, io);
    case 'subshell':
      return runNode(shell.fork(), node.body, io, { subshell: true });
    case 'group':
      return exec(node.body, shell, io);
    case 'redirect': {
      const redirected = await openRedirs(node.redirs, shell, io);
      return redirected ? exec(node.body, shell, redirected) : 1;
    }
    case 'func':
      shell.functions.set(node.name, node.body);
      return 0;
    case 'cond':
      return execCond(node.words, shell, io);
    case 'if':
      for (const b of node.branches) {
        if ((shell.status = await exec(b.cond, shell, io)) === 0) return exec(b.body, shell, io);
      }
      return node.otherwise ? exec(node.otherwise, shell, io) : 0;
    case 'for': {
      const items = node.items ? await expandWords(node.items, shell) : [...shell.positional];
      return loop(shell, io, node.body, async (i) => {
        if (i >= items.length) return false;
        shell.set(node.name, items[i]);
        return true;
      });
    }
    case 'while':
      return loop(shell, io, node.body, async () => ((await exec(node.cond, shell, io)) === 0) !== node.until);
    case 'case': {
      const subject = await expandWord(node.word, shell);
      for (const arm of node.arms) {
        for (const p of arm.patterns) {
          if (globToRegExp(await expandPattern(p, shell)).test(subject)) return exec(arm.body, shell, io);
        }
      }
      return 0;
    }
  }
}

async function loop(shell: Shell, io: IO, body: Node, next: (i: number) => Promise<boolean>): Promise<number> {
  let status = 0;
  for (let i = 0; await next(i); i++) {
    try {
      status = await exec(body, shell, io);
    } catch (e) {
      if (e instanceof BreakSignal) {
        if (--e.levels > 0) throw e;
        break;
      }
      if (e instanceof ContinueSignal) {
        if (--e.levels > 0) throw e;
        continue;
      }
      throw e;
    }
    await checkpoint(shell);
  }
  return status;
}

/** Runs all stages concurrently, connected by streaming pipes, each in its own forked shell. */
async function execPipeline(cmds: Node[], shell: Shell, io: IO): Promise<number> {
  const pipes = cmds.slice(1).map(() => new Pipe());
  const codes = await Promise.all(
    cmds.map(async (cmd, i) => {
      const stdin = i === 0 ? io.stdin : pipes[i - 1];
      const stdout = i === cmds.length - 1 ? io.stdout : pipes[i];
      try {
        return await runNode(shell.fork(), cmd, { stdin, stdout, stderr: io.stderr }, { subshell: true });
      } catch (e) {
        if (e instanceof BrokenPipe) return 141;
        if (e instanceof ReturnSignal) return e.code;
        throw e;
      } finally {
        if (i < cmds.length - 1) pipes[i].close();
        if (i > 0) pipes[i - 1].closeRead();
      }
    }),
  );
  if (shell.options.pipefail) return [...codes].reverse().find((c) => c !== 0) ?? 0;
  return codes.at(-1)!;
}
