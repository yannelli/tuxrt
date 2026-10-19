import type { Reader, Writer } from '../shell/io.ts';
import type { Shell } from '../shell/shell.ts';
import type { VFS } from '../vfs/vfs.ts';
import type { AbortSignal } from '../platform/abort.ts';

export interface Ctx {
  name: string;
  args: string[];
  stdin: Reader;
  stdout: Writer;
  stderr: Writer;
  shell: Shell;
  vfs: VFS;
  signal: AbortSignal;
  env: Record<string, string>;
}

export type CommandFn = (ctx: Ctx) => Promise<number> | number;

export interface CommandDef {
  fn: CommandFn;
  /** Shell builtins run inside the current shell and get no /usr/bin stub. */
  builtin?: boolean;
  /** Builtins that Ubuntu also ships as /usr/bin binaries (echo, test, kill...). */
  stub?: boolean;
  desc: string;
}

export type CommandTable = Record<string, CommandDef>;
