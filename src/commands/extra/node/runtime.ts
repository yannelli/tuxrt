import { Console } from 'node:console';
import vm from 'node:vm';
import { BrokenPipe, readAll } from '../../../shell/io.ts';
import type { Cred } from '../../../vfs/types.ts';
import type { Ctx } from '../../types.ts';
import { formatUncaught, ProcessExit, type Realm } from './errors.ts';
import { createGlobals } from './globals.ts';
import { attach, detach } from './hooks.ts';
import { EventLoop } from './loop.ts';
import { ModuleSystem } from './modules.ts';
import { createProcess, type SandboxProcess } from './process.ts';
import { describeUncaught, repl } from './repl.ts';

export type Main = { preload: string[] } & (
  | { kind: 'file'; path: string; check: boolean }
  | { kind: 'eval'; code: string; filename: string; print: boolean }
  | { kind: 'repl' }
);

// readFileSync(0) must be synchronous, so stdin is slurped up front only when the program asks for it.
const READS_STDIN_SYNC = /(?:readFileSync|readSync)\(\s*(?:0\s*[,)]|['"]\/dev\/stdin['"]|process\.stdin\.fd)/;

/** Runs the main script from a fresh macrotask so nextTicks drain before promise jobs, as in Node. */
function macrotask<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setImmediate(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }),
  );
}

function findPid(ctx: Ctx): number {
  const mine = [...ctx.shell.kernel.procs.procs.values()].filter((p) => p.ppid === ctx.shell.pid && p.cmd.split(' ')[0] === ctx.name);
  return mine.at(-1)?.pid ?? ctx.shell.pid;
}

/** One `node` process: a fresh vm context whose world is the emulated machine. */
export class NodeRuntime {
  readonly ctx: Ctx;
  readonly cred: Cred;
  readonly pid: number;
  readonly loop: EventLoop;
  readonly sources = new Map<string, string>();
  readonly process: SandboxProcess;
  readonly console: Console;
  readonly globals: Record<string, unknown>;
  readonly context: vm.Context;
  readonly realm: Realm;
  readonly modules: ModuleSystem;
  cwd: string;
  stdinText?: string;
  private exitCode: number | null = null;
  private exiting = false;
  private brokenPipe = false;
  private printValue?: { value: unknown };
  private replMode = false;

  constructor(ctx: Ctx, argv: string[]) {
    this.ctx = ctx;
    this.cred = { ...ctx.vfs.cred, groups: [...ctx.vfs.cred.groups] };
    this.cwd = ctx.shell.cwd;
    this.pid = findPid(ctx);
    this.loop = new EventLoop((e) => this.uncaught(e));
    this.process = createProcess(this, argv);
    const stream = (s: object) => s as unknown as NodeJS.WritableStream;
    this.console = new Console({ stdout: stream(this.process.stdout), stderr: stream(this.process.stderr), ignoreErrors: false });
    this.globals = createGlobals(this);
    this.context = vm.createContext(this.globals, { name: 'node' });
    this.realm = vm.runInContext('({ Error, TypeError, Promise, Array, Object, JSON })', this.context);
    this.globals.global = vm.runInContext('globalThis', this.context);
    this.modules = new ModuleSystem(this);
  }

  /** Runs VFS calls with the credentials `node` was started with. */
  asUser<T>(fn: () => T): T {
    const { vfs } = this.ctx;
    const saved = vfs.cred;
    vfs.cred = this.cred;
    try {
      return fn();
    } finally {
      vfs.cred = saved;
    }
  }

  write(fd: 1 | 2, data: string): void {
    if (this.exitCode !== null || !data) return;
    try {
      (fd === 1 ? this.ctx.stdout : this.ctx.stderr).write(data);
    } catch (e) {
      if (!(e instanceof BrokenPipe)) throw e;
      this.brokenPipe = true;
      this.exit(141);
    }
  }

  exit(code: number): never {
    this.terminate(code);
    throw new ProcessExit(code);
  }

  owns(err: unknown, promise?: Promise<unknown>): boolean {
    if (promise) return promise instanceof this.realm.Promise;
    return err instanceof ProcessExit || err instanceof this.realm.Error;
  }

  uncaught(err: unknown, promise?: Promise<unknown>): void {
    if (err instanceof ProcessExit || this.exitCode !== null) return;
    const event = promise ? 'unhandledRejection' : 'uncaughtException';
    if (this.process.listenerCount(event)) {
      try {
        this.process.emit(event, err, promise ?? event);
        return;
      } catch (e) {
        if (e instanceof ProcessExit) return;
        err = e;
      }
    }
    try {
      if (this.replMode) return this.write(1, describeUncaught(err));
      this.write(2, formatUncaught(err, this.sources));
    } catch {}
    this.terminate(1);
  }

  async run(main: Main): Promise<number> {
    attach(this);
    const onAbort = () => this.kill(128 + (Number(this.ctx.signal.reason) || 2));
    this.ctx.signal.addEventListener('abort', onAbort);
    try {
      if (this.ctx.signal.aborted) onAbort();
      await this.start(main);
      if (this.exitCode === null) {
        try {
          this.process.emit('beforeExit', Number(this.process.exitCode ?? 0));
        } catch (e) {
          this.uncaught(e);
        }
        await this.loop.run();
      }
      this.terminate(Number(this.process.exitCode ?? 0) | 0);
    } finally {
      this.ctx.signal.removeEventListener('abort', onAbort);
      detach(this);
    }
    if (this.brokenPipe) throw new BrokenPipe();
    return this.exitCode ?? 0;
  }

  private async slurpStdin(source: string): Promise<void> {
    if (READS_STDIN_SYNC.test(source)) this.stdinText = await readAll(this.ctx.stdin);
  }

  private async start(main: Main): Promise<void> {
    let result: { value: unknown; async: boolean };
    try {
      for (const id of main.preload) this.modules.load(id, this.modules.evalModule('[preload]'));
      if (main.kind === 'repl') {
        this.replMode = true;
        await repl(this);
        return this.loop.run();
      }
      if (main.kind === 'file') {
        const filename = this.modules.resolve(main.path, null);
        this.process.argv[1] = filename;
        const source = this.asUser(() => this.ctx.vfs.access(filename, 'r') && this.ctx.vfs.readFile(filename));
        if (main.check) return void this.modules.compile(source || this.ctx.vfs.readFile(filename), filename, true);
        if (source) await this.slurpStdin(source);
        result = await macrotask(() => this.modules.runMain(filename));
      } else {
        await this.slurpStdin(main.code);
        const mod = this.modules.evalModule(main.filename);
        Object.assign(this.globals, { require: mod.require, module: mod, exports: mod.exports, __filename: main.filename, __dirname: '.' });
        const { script, async } = this.modules.compileEval(main.code, main.filename, main.print);
        result = await macrotask(() => ({ value: script.runInContext(this.context, { displayErrors: false }), async }));
      }
    } catch (e) {
      this.uncaught(e);
      return;
    }
    const print = main.kind === 'eval' && main.print;
    if (!result.async) {
      if (print) this.printValue = { value: result.value };
      return this.loop.run();
    }
    let settled = false;
    const done = Promise.resolve(result.value).then(
      (value) => {
        settled = true;
        if (print) this.printValue = { value };
      },
      (e) => {
        settled = true;
        this.uncaught(e);
      },
    );
    const idle = this.loop.run();
    await Promise.race([done, idle]);
    if (settled) return idle;
    if (this.exitCode !== null) return;
    this.write(2, 'Warning: Detected unsettled top-level await\n');
    this.terminate(13);
  }

  /** Ends the process: prints a pending -p result, emits 'exit', stops all timers. */
  private terminate(code: number): void {
    if (this.exiting) {
      if (this.exitCode === null) this.process.exitCode = code;
      return;
    }
    this.exiting = true;
    this.process.exitCode = code;
    try {
      if (this.printValue) this.console.log(this.printValue.value);
      this.process.emit('exit', code);
    } catch (e) {
      if (!(e instanceof ProcessExit)) this.ctx.stderr.write(formatUncaught(e, this.sources));
    }
    this.exitCode = Number(this.process.exitCode ?? code) | 0;
    this.loop.stop();
  }

  /** Signal delivery: no 'exit' event, like a real process killed by SIGINT/SIGTERM. */
  private kill(code: number): void {
    if (this.exitCode !== null) return;
    this.exiting = true;
    this.exitCode = code;
    this.loop.stop();
  }
}
