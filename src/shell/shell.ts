import type { CommandDef } from '../commands/types.ts';
import { normalize } from '../vfs/path.ts';
import type { User } from '../vfs/users.ts';
import type { VFS } from '../vfs/vfs.ts';
import type { Node } from './ast.ts';
import type { Writer } from './io.ts';
import type { ProcessTable } from './process.ts';

export interface Job {
  id: number;
  pid: number;
  cmd: string;
  done: boolean;
  code: number;
  promise: Promise<number>;
  controller: AbortController;
}

/** State shared by every shell instance (subshells included): the machine itself. */
export interface Kernel {
  vfs: VFS;
  procs: ProcessTable;
  commands: Map<string, CommandDef>;
  jobs: Map<number, Job>;
  history: string[];
  /** Where diagnostics from expansions (e.g. command substitution) go. */
  stderr: Writer;
}

export interface ShellOptions {
  errexit: boolean;
  nounset: boolean;
  xtrace: boolean;
  noglob: boolean;
  pipefail: boolean;
}

export class Shell {
  readonly kernel: Kernel;
  vars = new Map<string, string>();
  exported = new Set<string>();
  functions = new Map<string, Node>();
  aliases = new Map<string, string>();
  locals: Map<string, string | undefined>[] = [];
  options: ShellOptions = { errexit: false, nounset: false, xtrace: false, noglob: false, pipefail: false };
  positional: string[] = [];
  argv0 = 'bash';
  status = 0;
  /** Exit status of the last command substitution in the current command, if any ran. */
  lastSubst: number | null = null;
  lastBg = 0;
  /** Process entry of a background job, adopted by its first command so `cmd &` is one process, as in bash. */
  jobProc: number | null = null;
  pid: number;
  user: User;
  interactive = false;
  /** Users stacked by `su`/`sudo -i`; `exit` pops back to the previous login. */
  logins: { user: User; cwd: string; vars: Map<string, string> }[] = [];
  /** Controller of the job this shell belongs to; aborting it delivers a signal. */
  job = new AbortController();
  readonly startTime = Date.now();

  constructor(kernel: Kernel, user: User, pid: number) {
    this.kernel = kernel;
    this.user = user;
    this.pid = pid;
  }

  get signal(): AbortSignal {
    return this.job.signal;
  }

  private fs: VFS | null = null;

  /** This shell's view of the filesystem, carrying its own credentials. */
  get vfs(): VFS {
    return (this.fs ??= this.kernel.vfs.view({ uid: this.user.uid, gid: this.user.gid, groups: this.user.groups }));
  }

  get cwd(): string {
    return this.vars.get('PWD') ?? '/';
  }

  set cwd(path: string) {
    this.vars.set('OLDPWD', this.cwd);
    this.vars.set('PWD', path);
  }

  abs(path: string): string {
    return normalize(path, this.cwd);
  }

  get(name: string): string | undefined {
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    if (name === 'SECONDS') return String(Math.floor((Date.now() - this.startTime) / 1000));
    return this.vars.get(name);
  }

  set(name: string, value: string): void {
    this.vars.set(name, value);
  }

  unset(name: string): void {
    this.vars.delete(name);
    this.exported.delete(name);
  }

  export(name: string, value?: string): void {
    if (value !== undefined) this.vars.set(name, value);
    this.exported.add(name);
  }

  env(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of this.exported) {
      const v = this.vars.get(name);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }

  applyUser(user: User): void {
    this.user = user;
    this.vfs.cred = { uid: user.uid, gid: user.gid, groups: user.groups };
    this.export('USER', user.name);
    this.export('LOGNAME', user.name);
    this.export('HOME', user.home);
    this.export('SHELL', user.shell);
    this.vars.set('UID', String(user.uid));
    this.vars.set('EUID', String(user.uid));
    this.vars.set('PS1', user.uid === 0 ? '\\u@\\h:\\w# ' : '\\u@\\h:\\w\\$ ');
  }

  /** A forked copy for subshells, pipeline stages and command substitution. */
  fork(): Shell {
    const s = new Shell(this.kernel, this.user, this.pid);
    s.vars = new Map(this.vars);
    s.exported = new Set(this.exported);
    s.functions = new Map(this.functions);
    s.aliases = new Map(this.aliases);
    s.options = { ...this.options };
    s.positional = [...this.positional];
    s.argv0 = this.argv0;
    s.status = this.status;
    s.lastBg = this.lastBg;
    s.job = this.job;
    s.fs = this.vfs.view(this.vfs.cred);
    return s;
  }
}
