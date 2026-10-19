import { binaryNames, createRegistry } from './commands/index.ts';
import { Runtime, type ExecResult } from './runtime.ts';
import type { HostFs } from './vfs/hostfs.ts';
import { restore, snapshot } from './vfs/persist.ts';

/** JSON Schema for the bash tool's input; wrap it in whatever tool format your model API expects. */
export const BASH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The bash command line to run.' },
    timeout: { type: 'number', description: 'Seconds before the command is killed. Default 120, maximum 600.' },
    restart: { type: 'boolean', description: 'Start a fresh shell session first. Files are kept; cwd, variables and functions are reset.' },
  },
  required: ['command'],
} as const;

/** The bash tool in Anthropic's tool-definition shape (`input_schema`); for OpenAI use it as `parameters`. */
export const BASH_TOOL = {
  name: 'bash',
  description:
    'Run a command in a persistent bash shell on an Ubuntu 24.04 machine. The working directory, environment, ' +
    'functions and files carry over between calls. Standard Linux tools are available (coreutils, grep, sed, awk, ' +
    'find, jq, tar, gzip, zip, curl, wget). Output is truncated when very long; pipe through head or grep ' +
    'to narrow it. Long-running commands are killed at the timeout.',
  input_schema: BASH_INPUT_SCHEMA,
} as const;

export interface BashInput {
  command: string;
  timeout?: number;
  restart?: boolean;
}

export interface BashResult extends ExecResult {
  /** stdout, stderr and status notes combined, ready to return to the model as the tool result. */
  output: string;
}

export interface AgentShellOptions {
  /** Login user (default "ubuntu"). */
  user?: string;
  /** Host directories to show inside the machine, e.g. { '/home/ubuntu/workspace': hostFs }. */
  mounts?: Record<string, HostFs>;
  /** Starting directory; defaults to the first mount, else the home directory. */
  cwd?: string;
  /** A filesystem saved with snapshot(), to resume a previous session. */
  state?: string;
  /** Per-command timeout when the call gives none (default 120 s). */
  timeoutMs?: number;
  /** Upper bound on any requested timeout (default 600 s). */
  maxTimeoutMs?: number;
  /** Characters of stdout and of stderr kept per call (default 30000 each). */
  maxOutput?: number;
}

export function formatResult(r: ExecResult, timeoutMs: number, maxOutput: number): string {
  const parts = [r.stdout, r.stderr && (r.stdout && !r.stdout.endsWith('\n') ? `\n${r.stderr}` : r.stderr)].filter(Boolean);
  const notes: string[] = [];
  if (r.truncated) notes.push(`[output truncated after ${maxOutput} characters]`);
  if (r.timedOut) notes.push(`[killed: timed out after ${timeoutMs / 1000}s]`);
  // 141 after truncation is the cap closing the pipe, not the command failing.
  else if (r.code !== 0 && !(r.truncated && r.code === 141)) notes.push(`[exit code ${r.code}]`);
  const body = parts.join('');
  if (!body && !notes.length) return '(no output)';
  return [body.replace(/\n$/, ''), ...notes].filter(Boolean).join('\n');
}

/** One agent's machine: a persistent shell session behind the bash tool. */
export class AgentShell {
  runtime: Runtime;
  private readonly opts: AgentShellOptions;

  private constructor(runtime: Runtime, opts: AgentShellOptions) {
    this.runtime = runtime;
    this.opts = opts;
  }

  static async create(opts: AgentShellOptions = {}): Promise<AgentShell> {
    const vfs = opts.state === undefined ? undefined : restore(opts.state, binaryNames(createRegistry()));
    const runtime = await Runtime.boot({ user: opts.user, vfs });
    for (const [at, fs] of Object.entries(opts.mounts ?? {})) runtime.mount(at, fs);
    const shell = new AgentShell(runtime, opts);
    await shell.enter();
    return shell;
  }

  private async enter(): Promise<void> {
    const dir = this.opts.cwd ?? Object.keys(this.opts.mounts ?? {})[0];
    if (dir) await this.runtime.exec(`cd -- '${dir.replace(/'/g, `'\\''`)}'`);
  }

  /** Runs one bash tool call. Invalid input comes back as an error result rather than throwing. */
  async run(input: BashInput): Promise<BashResult> {
    const timeoutMs = Math.min(input.timeout ? input.timeout * 1000 : (this.opts.timeoutMs ?? 120_000), this.opts.maxTimeoutMs ?? 600_000);
    const maxOutput = this.opts.maxOutput ?? 30_000;
    if (typeof input.command !== 'string' || (!input.command.trim() && !input.restart)) {
      const r = { stdout: '', stderr: 'bash tool: `command` must be a non-empty string\n', code: 2 };
      return { ...r, output: formatResult(r, timeoutMs, maxOutput) };
    }
    if (input.restart) await this.restart();
    const r = input.command.trim() ? await this.runtime.exec(input.command, { timeoutMs, maxOutput }) : { stdout: 'shell restarted\n', stderr: '', code: 0 };
    if (this.runtime.exited !== null) await this.restart();
    return { ...r, output: formatResult(r, timeoutMs, maxOutput) };
  }

  /** A fresh shell on the same filesystem (and mounts), as after `exit` or the tool's `restart`. */
  async restart(): Promise<void> {
    this.runtime = await Runtime.boot({ user: this.opts.user, vfs: this.runtime.kernel.vfs });
    await this.enter();
  }

  /** The machine's filesystem as JSON for `state`; mounted host directories are not included. */
  snapshot(): string {
    return snapshot(this.runtime.kernel.vfs);
  }
}
