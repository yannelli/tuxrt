import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { promisify } from 'node:util';
import { ExitSignal, Interrupt } from '../../../shell/control.ts';
import { runSource } from '../../../shell/interpreter.ts';
import { BrokenPipe, DISCARD, Pipe, type IO, type Writer } from '../../../shell/io.ts';
import { SIGNALS } from '../../../shell/process.ts';
import { spawnShell } from '../../../shell/script.ts';
import { dispatch } from '../../../shell/simple.ts';
import { normalize } from '../../../vfs/path.ts';
import { fromBytes, toBytes } from '../bytes.ts';
import type { NodeRuntime } from './runtime.ts';

interface Opts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  encoding?: string | null;
  stdio?: string | unknown[];
  shell?: boolean | string;
}

type Callback = (err: unknown, stdout?: unknown, stderr?: unknown) => void;

const signalName = (n: unknown) => `SIG${Object.entries(SIGNALS).find(([, v]) => v === Number(n))?.[0] ?? 'TERM'}`;

/** child_process over the emulated shell. Only async forms exist: the shell cannot run synchronously. */
export function createChildProcess(rt: NodeRuntime): Record<string, unknown> {
  const { realm } = rt;

  function start(command: string | string[], opts: Opts, capture: (fd: 1 | 2, s: string) => void) {
    const shell = spawnShell(rt.ctx.shell);
    const controller = new AbortController();
    shell.job = controller;
    const onAbort = () => controller.abort(rt.ctx.signal.reason);
    rt.ctx.signal.addEventListener('abort', onAbort, { once: true });
    for (const name of [...shell.exported]) shell.unset(name);
    for (const [k, v] of Object.entries(opts.env ?? rt.process.env)) if (v !== undefined) shell.export(k, String(v));
    shell.export('PWD', normalize(opts.cwd ?? '.', rt.cwd));

    const inherit = (i: number) => opts.stdio === 'inherit' || (Array.isArray(opts.stdio) && opts.stdio[i] === 'inherit');
    const ignore = (i: number) => opts.stdio === 'ignore' || (Array.isArray(opts.stdio) && opts.stdio[i] === 'ignore');
    const stdinPipe = new Pipe();
    const cp = Object.assign(new EventEmitter(), {
      pid: shell.pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new Writable({
        write(chunk: Buffer, _enc, done) {
          stdinPipe.write(fromBytes(chunk));
          done();
        },
        final(done) {
          stdinPipe.close();
          done();
        },
      }),
      exitCode: null as number | null,
      signalCode: null as string | null,
      killed: false,
      kill(sig: string | number = 'SIGTERM') {
        cp.killed = true;
        controller.abort(typeof sig === 'number' ? sig : (SIGNALS[String(sig).replace(/^SIG/, '')] ?? 15));
        return true;
      },
    });
    const sink = (fd: 1 | 2): Writer => {
      if (inherit(fd)) return { write: (s) => rt.write(fd, s) };
      if (ignore(fd)) return DISCARD;
      const stream = fd === 1 ? cp.stdout : cp.stderr;
      return { write: (s) => (capture(fd, s), stream.write(toBytes(s))) };
    };
    const io: IO = { stdin: inherit(0) ? rt.ctx.stdin : stdinPipe, stdout: sink(1), stderr: sink(2) };

    const handle = {};
    rt.loop.ref(handle);
    const run = async (): Promise<number> => {
      try {
        if (typeof command === 'string') return await runSource(shell, command, io, { subshell: true });
        return await dispatch(command, shell, io);
      } catch (e) {
        if (e instanceof Interrupt || e instanceof ExitSignal) return e.code;
        if (e instanceof BrokenPipe) return 141;
        throw e;
      } finally {
        rt.ctx.signal.removeEventListener('abort', onAbort);
        rt.ctx.shell.kernel.procs.exit(shell.pid);
      }
    };
    run().then(
      (code) => {
        cp.stdout.end();
        cp.stderr.end();
        const signal = controller.signal.aborted ? signalName(controller.signal.reason) : null;
        cp.exitCode = signal ? null : code;
        cp.signalCode = signal;
        setImmediate(() => {
          rt.loop.invoke(() => (cp.emit('exit', cp.exitCode, signal), cp.emit('close', cp.exitCode, signal)), cp, []);
          rt.loop.unref(handle);
        });
      },
      (e) => {
        rt.loop.invoke(() => cp.emit('error', e), cp, []);
        rt.loop.unref(handle);
      },
    );
    return cp;
  }

  function collect(command: string | string[], shown: string, opts: Opts, callback?: Callback) {
    const out = { 1: '', 2: '' };
    const cp = start(command, opts, (fd, s) => (out[fd] += s));
    const fmt = (s: string) => (opts.encoding === 'buffer' || opts.encoding === null ? toBytes(s) : s);
    cp.on('close', (code: number | null) => {
      if (!callback) return;
      const err =
        code === 0
          ? null
          : Object.assign(new realm.Error(`Command failed: ${shown}\n${out[2]}`), {
              code,
              killed: cp.killed,
              signal: cp.signalCode,
              cmd: shown,
            });
      callback(err, fmt(out[1]), fmt(out[2]));
    });
    return cp;
  }

  const args = (rest: unknown[]) => {
    const callback = typeof rest.at(-1) === 'function' ? (rest.pop() as Callback) : undefined;
    const list = Array.isArray(rest[0]) ? (rest.shift() as unknown[]).map(String) : [];
    return { list, opts: (rest[0] ?? {}) as Opts, callback };
  };

  const exec = (command: unknown, ...rest: unknown[]) => {
    const { opts, callback } = args(rest);
    return collect(String(command), String(command), opts, callback);
  };
  const execFile = (file: unknown, ...rest: unknown[]) => {
    const { list, opts, callback } = args(rest);
    const argv = [String(file), ...list];
    return collect(argv, argv.join(' '), opts, callback);
  };
  const promised = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) =>
    new realm.Promise((resolve, reject) => {
      fn(...a, (err: unknown, stdout: unknown, stderr: unknown) =>
        err ? reject(Object.assign(err as object, { stdout, stderr })) : resolve({ stdout, stderr }),
      );
    });
  Object.assign(exec, { [promisify.custom]: promised(exec) });
  Object.assign(execFile, { [promisify.custom]: promised(execFile) });

  const unsupported = (name: string) => () => {
    const msg = `child_process.${name} is not supported in tuxrt: the emulated shell is asynchronous. Use exec, execFile, spawn or util.promisify(exec).`;
    throw Object.assign(new realm.Error(msg), { code: 'ERR_TUXRT_SYNC_CHILD' });
  };

  return {
    exec,
    execFile,
    spawn: (command: unknown, ...rest: unknown[]) => {
      const { list, opts } = args(rest);
      const argv = [String(command), ...list];
      return start(opts.shell ? argv.join(' ') : argv, opts, () => {});
    },
    execSync: unsupported('execSync'),
    execFileSync: unsupported('execFileSync'),
    spawnSync: unsupported('spawnSync'),
    fork: unsupported('fork'),
  };
}
