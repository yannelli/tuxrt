import type { Runtime } from '../runtime.ts';

const COMMAND_POSITION = /(^|[;&|(]|&&|\|\||\b(then|do|else|sudo|time|exec)\s)\s*$/;

/** readline completer: command names in command position, VFS paths elsewhere. */
export function completer(rt: Runtime) {
  return (line: string): [string[], string] => {
    const word = /(\S*)$/.exec(line)![1];
    const before = line.slice(0, line.length - word.length);
    if (COMMAND_POSITION.test(before) && !word.includes('/')) return [commands(rt, word), word];
    // Complete only the last path segment so the candidate list shows basenames, like bash.
    const base = word.slice(word.lastIndexOf('/') + 1);
    return [paths(rt, word), base];
  };
}

function commands(rt: Runtime, prefix: string): string[] {
  const { shell } = rt;
  const names = new Set([...shell.aliases.keys(), ...shell.functions.keys()]);
  for (const [name, def] of shell.kernel.commands) if (def.builtin) names.add(name);
  for (const dir of (shell.get('PATH') ?? '').split(':')) {
    try {
      for (const entry of shell.vfs.readdir(shell.abs(dir))) names.add(entry);
    } catch {
      // Missing or unreadable PATH entries are skipped, like bash.
    }
  }
  return [...names].filter((n) => n.startsWith(prefix)).sort().map((n) => `${n} `);
}

function paths(rt: Runtime, word: string): string[] {
  const { shell } = rt;
  const home = shell.get('HOME') ?? '/';
  const slash = word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
  const base = word.slice(slash + 1);
  const lookup = dirPart.startsWith('~') ? home + dirPart.slice(1) : dirPart || '.';
  let entries: string[];
  try {
    entries = shell.vfs.readdir(shell.abs(lookup));
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.startsWith(base) && (base.startsWith('.') || !e.startsWith('.')))
    .map((e) => {
      const full = shell.abs(`${lookup}/${e}`);
      return `${e}${shell.vfs.isDir(full) ? '/' : ' '}`;
    });
}
