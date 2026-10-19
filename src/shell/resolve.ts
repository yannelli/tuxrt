import type { CommandDef } from '../commands/types.ts';
import { ELF_MAGIC } from '../vfs/bootstrap.ts';
import type { Shell } from './shell.ts';

export type Resolved =
  | { kind: 'alias'; value: string }
  | { kind: 'function' }
  | { kind: 'builtin'; def: CommandDef }
  | { kind: 'binary'; path: string; def: CommandDef }
  | { kind: 'script'; path: string }
  | { kind: 'error'; message: string; code: number };

/** Finds what a command name refers to, in bash's lookup order. */
export function resolveCommand(name: string, shell: Shell, withAliases = false): Resolved | null {
  if (withAliases && shell.aliases.has(name)) return { kind: 'alias', value: shell.aliases.get(name)! };
  if (shell.functions.has(name)) return { kind: 'function' };
  const def = shell.kernel.commands.get(name);
  if (def?.builtin) return { kind: 'builtin', def };
  if (name.includes('/')) return resolvePath(shell, shell.abs(name), name);
  for (const dir of (shell.get('PATH') ?? '').split(':')) {
    if (!dir) continue;
    const path = shell.abs(`${dir}/${name}`);
    const node = shell.vfs.tryLookup(path);
    if (node?.kind === 'file' && shell.vfs.can(node, 1)) return resolvePath(shell, path, name);
  }
  return null;
}

function resolvePath(shell: Shell, path: string, shown: string): Resolved {
  const node = shell.vfs.tryLookup(path);
  if (!node) return { kind: 'error', message: `${shown}: No such file or directory`, code: 127 };
  if (node.kind === 'dir') return { kind: 'error', message: `${shown}: Is a directory`, code: 126 };
  if (!shell.vfs.can(node, 1)) return { kind: 'error', message: `${shown}: Permission denied`, code: 126 };
  const content = shell.vfs.readFile(path);
  if (content.startsWith(ELF_MAGIC)) {
    const def = shell.kernel.commands.get(content.slice(ELF_MAGIC.length).trim());
    if (def) return { kind: 'binary', path, def };
    return { kind: 'error', message: `${shown}: cannot execute binary file: Exec format error`, code: 126 };
  }
  return { kind: 'script', path };
}
