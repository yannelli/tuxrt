import { binaryNames, createRegistry } from "./commands/index.ts";
import { ExitSignal, Interrupt } from "./shell/control.ts";
import { runSource } from "./shell/interpreter.ts";
import {
  BrokenPipe,
  BufferWriter,
  CappedWriter,
  EMPTY,
  StringReader,
  type Reader,
  type Writer,
} from "./shell/io.ts";
import { ProcessTable } from "./shell/process.ts";
import { Shell, type Kernel } from "./shell/shell.ts";
import { bootstrap, DEFAULT_USER } from "./vfs/bootstrap.ts";
import { machine } from "./vfs/machine.ts";
import { findUser } from "./vfs/users.ts";
import { mountHost, type HostFs } from "./vfs/hostfs.ts";
import type { VFS } from "./vfs/vfs.ts";
import { AbortController } from "./platform/abort.ts";
import { platform } from "./platform/index.ts";

export interface RuntimeOptions {
  /** Login user (default "ubuntu"). */
  user?: string;
  /** Diagnostics sink for expansions and the terminal device. */
  stderr?: Writer;
  /** Reuse an existing filesystem (e.g. restored from a snapshot). */
  vfs?: VFS;
  /** Source ~/.profile and ~/.bashrc like an interactive login shell. */
  login?: boolean;
}

export interface ExecOptions {
  stdin?: string;
  /** Kills the foreground job after this long; the result then has `timedOut` and code 124, like timeout(1). */
  timeoutMs?: number;
  /** Characters kept per stream. Past it the stream acts as a closed pipe, so producers stop, and `truncated` is set. */
  maxOutput?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut?: boolean;
  truncated?: boolean;
}

export class Runtime {
  readonly kernel: Kernel;
  readonly shell: Shell;
  exited: number | null = null;

  private constructor(kernel: Kernel, shell: Shell) {
    this.kernel = kernel;
    this.shell = shell;
  }

  static async boot(opts: RuntimeOptions = {}): Promise<Runtime> {
    const commands = createRegistry();
    const stderr = opts.stderr ?? new BufferWriter();
    const vfs =
      opts.vfs ?? bootstrap(binaryNames(commands), (d) => stderr.write(d));
    const procs = new ProcessTable(machine.bootTime);
    const kernel: Kernel = {
      vfs,
      procs,
      commands,
      jobs: new Map(),
      history: [],
      stderr,
    };
    const user = findUser(vfs, opts.user ?? DEFAULT_USER.name);
    if (!user) throw new Error(`no such user: ${opts.user}`);
    const shell = new Shell(
      kernel,
      user,
      procs.spawn("-bash", user.uid, 702).pid,
    );
    shell.applyUser(user);
    const env: Record<string, string> = {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
      SHLVL: "1",
      PWD: user.home,
    };
    for (const [k, v] of Object.entries(env)) shell.export(k, v);
    shell.set("HOSTNAME", vfs.readFile("/etc/hostname").trim());
    shell.set("PS2", "> ");
    shell.set("PPID", "702");
    const rt = new Runtime(kernel, shell);
    if (opts.login) {
      shell.interactive = true;
      for (const rc of [".profile", ".bashrc"]) {
        if (vfs.exists(`${user.home}/${rc}`))
          await rt.run(`. ~/${rc}`, { stdin: EMPTY, stdout: stderr, stderr });
      }
    }
    return rt;
  }

  /** Runs a command line with streaming IO. Returns its exit status; sets `exited` on `exit`. */
  async run(
    src: string,
    io: { stdin: Reader; stdout: Writer; stderr: Writer },
  ): Promise<number> {
    this.shell.job = new AbortController();
    try {
      return await runSource(this.shell, src, io);
    } catch (e) {
      if (e instanceof ExitSignal) {
        this.exited = e.code;
        return e.code;
      }
      if (e instanceof Interrupt) return (this.shell.status = e.code);
      if (e instanceof BrokenPipe) return (this.shell.status = 141);
      throw e;
    }
  }

  /** Runs a command line and captures its output. A string argument is stdin. */
  async exec(
    src: string,
    options: string | ExecOptions = {},
  ): Promise<ExecResult> {
    const o = typeof options === "string" ? { stdin: options } : options;
    const stdout = new CappedWriter(o.maxOutput ?? Infinity);
    const stderr = new CappedWriter(o.maxOutput ?? Infinity);
    let timedOut = false;
    const timer = o.timeoutMs
      ? platform.setTimeout(
          () => ((timedOut = true), this.shell.job.abort(9)),
          o.timeoutMs,
        )
      : undefined;
    let code: number;
    try {
      code = await this.run(src, {
        stdin: new StringReader(o.stdin ?? ""),
        stdout,
        stderr,
      });
    } finally {
      platform.clearTimeout(timer);
    }
    const result: ExecResult = {
      stdout: stdout.data,
      stderr: stderr.data,
      code: timedOut ? (this.shell.status = 124) : code,
    };
    if (timedOut) result.timedOut = true;
    if (stdout.truncated || stderr.truncated) result.truncated = true;
    return result;
  }

  /** Shows a host directory (e.g. the agent's workspace) at `at`, owned by the login user. */
  mount(at: string, fs: HostFs): void {
    mountHost(this.kernel.vfs, at, fs, this.shell.user);
  }

  interrupt(): void {
    this.shell.job.abort(2);
  }
}

export { bootstrap };
export {
  AgentShell,
  BASH_INPUT_SCHEMA,
  BASH_TOOL,
  formatResult,
  type AgentShellOptions,
  type BashInput,
  type BashResult,
} from "./harness.ts";
export type { HostFs, HostStat } from "./vfs/hostfs.ts";
export { restore, snapshot } from "./vfs/persist.ts";
export { AbortController, AbortSignal } from "./platform/abort.ts";
export { DnsFailure, type Dns, type DnsRecord } from "./platform/dns.ts";
export {
  HeaderList,
  httpOverFetch,
  NetError,
  type Http,
  type HttpRequest,
  type HttpResponse,
} from "./platform/http.ts";
export {
  configurePlatform,
  portablePlatform,
  type Platform,
  type Probe,
} from "./platform/index.ts";
