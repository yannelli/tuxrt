import type { IO } from './io.ts';
import { runSource } from './interpreter.ts';
import { dispatch } from './simple.ts';
import { Shell } from './shell.ts';

/** A fresh shell process: inherits only exported variables, like execve(). */
export function spawnShell(parent: Shell): Shell {
  const child = new Shell(parent.kernel, parent.user, parent.kernel.procs.spawn('bash', parent.user.uid, parent.pid).pid);
  for (const [k, v] of Object.entries(parent.env())) child.export(k, v);
  child.job = parent.job;
  return child;
}

/** Executes a script file honoring its shebang (`#!/bin/bash`, `#!/usr/bin/env node`, ...). */
export async function runScriptFile(path: string, name: string, args: string[], shell: Shell, io: IO): Promise<number> {
  const src = shell.vfs.readFile(path);
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(src);
  if (shebang) {
    const interp = shebang[1].endsWith('/env') ? shebang[2] : shebang[1];
    const base = interp?.split('/').pop() ?? '';
    if (base && !['sh', 'bash', 'dash'].includes(base)) return dispatch([base, path, ...args], shell, io);
  }
  return runShellScript(src, name, args, shell, io);
}

export async function runShellScript(src: string, name: string, args: string[], shell: Shell, io: IO): Promise<number> {
  const child = spawnShell(shell);
  child.argv0 = name;
  child.positional = args;
  try {
    return await runSource(child, src, io, { subshell: true });
  } finally {
    shell.kernel.procs.exit(child.pid);
  }
}
