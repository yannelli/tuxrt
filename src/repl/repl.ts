import { createInterface, type Interface } from 'node:readline';
import type { Runtime } from '../runtime.ts';
import { IncompleteInput } from '../shell/ast.ts';
import { reapJobs } from '../shell/jobs.ts';
import { tokenize } from '../shell/lexer.ts';
import { parse } from '../shell/parser.ts';
import { completer } from './complete.ts';
import { renderPrompt } from './prompt.ts';
import { terminalWriter, TTYReader } from './tty.ts';

/** Interactive terminal session. Resolves with the shell's exit status. */
export function startRepl(rt: Runtime): Promise<number> {
  const stdout = terminalWriter(process.stdout);
  const stderr = terminalWriter(process.stderr);
  const tty = new TTYReader();
  const { shell } = rt;
  let rl: Interface;
  let running = false;
  let buffer = '';
  let finish: (code: number) => void;
  let closing = false;

  const prompt = () => {
    reapJobs(shell, stderr);
    const ps = buffer ? (shell.get('PS2') ?? '> ') : (shell.get('PS1') ?? '\\u@\\h:\\w\\$ ');
    rl.setPrompt(renderPrompt(ps, shell));
    rl.prompt();
  };

  const end = (code: number) => {
    closing = true;
    rl.close();
    finish(code);
  };

  const run = async (src: string) => {
    running = true;
    rl.setPrompt('');
    try {
      await rt.run(src, { stdin: tty, stdout, stderr });
    } catch (e) {
      stderr.write(`tuxrt: internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    }
    running = false;
    tty.reset();
    if (rt.exited !== null) return end(rt.exited);
    prompt();
  };

  const onLine = async (line: string) => {
    if (running) return tty.push(`${line}\n`);
    buffer += `${line}\n`;
    try {
      tokenize(buffer);
      parse(buffer);
    } catch (e) {
      if (e instanceof IncompleteInput) return prompt();
    }
    const src = buffer;
    buffer = '';
    if (src.trim()) recordHistory(rt, src.trimEnd());
    await run(src);
  };

  const onSigint = () => {
    stdout.write('^C\n');
    if (running) {
      rt.interrupt();
      tty.push(null);
      return;
    }
    buffer = '';
    rl.setPrompt(renderPrompt(shell.get('PS1') ?? '$ ', shell));
    // Ctrl-U clears the typed text and redraws the prompt on the fresh line.
    rl.write('', { ctrl: true, name: 'u' });
  };

  const onClose = () => {
    if (closing) return;
    if (running) {
      tty.push(null);
      open();
      return;
    }
    open();
    stdout.write('\n');
    void run('exit');
  };

  const open = () => {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: completer(rt),
      history: [...rt.kernel.history].reverse(),
      historySize: 1000,
      removeHistoryDuplicates: true,
      terminal: true,
    });
    rl.on('line', (line) => void onLine(line));
    rl.on('SIGINT', onSigint);
    rl.on('close', onClose);
  };

  return new Promise((resolve) => {
    finish = resolve;
    open();
    prompt();
  });
}

function recordHistory(rt: Runtime, line: string): void {
  rt.kernel.history.push(line);
  const home = rt.shell.get('HOME');
  try {
    if (home) rt.shell.vfs.writeFile(`${home}/.bash_history`, `${line}\n`, true);
  } catch {
    // History is best effort, e.g. after `cd /` as a user whose $HOME was removed.
  }
}
