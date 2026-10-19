import { FsError } from '../vfs/errors.ts';
import type { Redir } from './ast.ts';
import { expandHeredoc, expandWord } from './expand.ts';
import { DISCARD, StringReader, type IO, type Reader, type Writer } from './io.ts';
import type { Shell } from './shell.ts';

export class RedirError extends Error {}

class FileWriter implements Writer {
  private readonly shell: Shell;
  private readonly path: string;

  constructor(shell: Shell, path: string, append: boolean) {
    this.shell = shell;
    this.path = path;
    if (!append || !shell.vfs.exists(path)) shell.vfs.writeFile(path, '');
    else shell.vfs.writeFile(path, '', true);
  }

  write(data: string): void {
    this.shell.vfs.writeFile(this.path, data, true);
  }
}

/** Applies redirections left to right, returning the new IO. Throws RedirError with a bash-style message. */
export async function applyRedirs(redirs: Redir[], shell: Shell, io: IO): Promise<IO> {
  const fds: (Reader | Writer)[] = [io.stdin, io.stdout, io.stderr];
  for (const r of redirs) {
    const input = r.op === '<' || r.op === '<<' || r.op === '<<-' || r.op === '<<<' || r.op === '<&' || r.op === '<>';
    const fd = r.fd ?? (input ? 0 : 1);
    if (r.heredoc) {
      fds[fd] = new StringReader(r.heredoc.expand ? await expandHeredoc(r.heredoc.body, shell) : r.heredoc.body);
      continue;
    }
    const target = await expandWord(r.target, shell);
    try {
      switch (r.op) {
        case '<':
        case '<>':
          fds[fd] = new StringReader(shell.vfs.readFile(shell.abs(target)));
          break;
        case '<<<':
          fds[fd] = new StringReader(`${target}\n`);
          break;
        case '>&':
        case '<&':
          if (target === '-') fds[fd] = input ? new StringReader('') : DISCARD;
          else if (/^\d+$/.test(target)) fds[fd] = fds[Number(target)] ?? DISCARD;
          else if (r.fd === null && !input) fds[1] = fds[2] = openWriter(shell, target, false, io);
          else throw new RedirError(`${target}: ambiguous redirect`);
          break;
        case '&>':
        case '&>>':
          fds[1] = fds[2] = openWriter(shell, target, r.op === '&>>', io);
          break;
        default:
          fds[fd] = openWriter(shell, target, r.op === '>>', io);
      }
    } catch (e) {
      if (e instanceof FsError) throw new RedirError(`${target}: ${e.message}`);
      throw e;
    }
  }
  return { stdin: fds[0] as Reader, stdout: fds[1] as Writer, stderr: fds[2] as Writer };
}

function openWriter(shell: Shell, target: string, append: boolean, io: IO): Writer {
  if (target === '') throw new RedirError(': No such file or directory');
  const path = shell.abs(target);
  if (path === '/dev/stdout' || path === '/proc/self/fd/1') return io.stdout;
  if (path === '/dev/stderr' || path === '/proc/self/fd/2') return io.stderr;
  if (path === '/dev/null') return DISCARD;
  if (path === '/dev/tty') return shell.kernel.stderr;
  return new FileWriter(shell, path, append);
}
