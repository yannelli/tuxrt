import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { SIGNALS } from '../../../shell/process.ts';
import type { Writer } from '../../../shell/io.ts';
import { normalize } from '../../../vfs/path.ts';
import { fromBytes, toBytes } from '../../../vfs/bytes.ts';
import { NODE_VERSION, sysError } from './errors.ts';
import type { NodeRuntime } from './runtime.ts';

const versions = {
  node: NODE_VERSION.slice(1),
  acorn: '8.12.1',
  ada: '2.9.0',
  ares: '1.34.2',
  brotli: '1.1.0',
  icu: '75.1',
  llhttp: '9.2.1',
  modules: '127',
  napi: '9',
  nghttp2: '1.63.0',
  openssl: '3.0.13+quic',
  unicode: '15.1',
  uv: '1.48.0',
  v8: '12.4.254.21-node.21',
  zlib: '1.3.0.1-motley-71660e1',
};

type Callback = (...args: unknown[]) => unknown;

function writeStream(rt: NodeRuntime, fd: 1 | 2, writer: Writer) {
  const tty = !!writer.isTTY;
  const stream = Object.assign(new EventEmitter(), {
    fd,
    isTTY: tty,
    writable: true,
    write(chunk: unknown, enc?: unknown, cb?: unknown): boolean {
      const callback = typeof enc === 'function' ? enc : cb;
      const text =
        typeof chunk === 'string'
          ? typeof enc === 'string' && !/^utf-?8$/i.test(enc) ? fromBytes(Buffer.from(chunk, enc as BufferEncoding)) : chunk
          : fromBytes(chunk as Uint8Array);
      rt.write(fd, text);
      if (typeof callback === 'function') process.nextTick(() => rt.loop.invoke(callback as Callback, stream, []));
      return true;
    },
    end(chunk?: unknown) {
      if (chunk != null && typeof chunk !== 'function') stream.write(chunk);
      return stream;
    },
    cork() {},
    uncork() {},
    getColorDepth: () => (tty ? 8 : 1),
    hasColors: (n = 16) => tty && n <= 256,
    getWindowSize: () => [80, 24],
  });
  return tty ? Object.assign(stream, { columns: 80, rows: 24 }) : stream;
}

/** process.stdin as a real Readable, so readline, async iteration and 'data' events all work. */
function stdinStream(rt: NodeRuntime) {
  const handle = {};
  let pending = false;
  const stream: Readable = new Readable({
    read() {
      if (rt.stdinText !== undefined) {
        const text = rt.stdinText;
        rt.stdinText = '';
        if (text) stream.push(toBytes(text));
        stream.push(null);
        return;
      }
      pending = true;
      rt.loop.ref(handle);
      rt.ctx.stdin.read().then(
        (chunk) => {
          pending = false;
          rt.loop.unref(handle);
          stream.push(chunk === null ? null : toBytes(chunk));
        },
        (e) => stream.destroy(e),
      );
    },
  });
  stream.on('pause', () => rt.loop.unref(handle));
  stream.on('resume', () => pending && rt.loop.ref(handle));
  return Object.assign(stream, { fd: 0, isTTY: !!rt.ctx.stdin.isTTY, setRawMode: () => stream });
}

export function createProcess(rt: NodeRuntime, argv: string[]) {
  const { ctx } = rt;
  const started = performance.now();
  const env = new Proxy({ ...ctx.env } as Record<string, string>, {
    set: (target, key, value) => Reflect.set(target, key, String(value)),
  });
  const stdout = writeStream(rt, 1, ctx.stdout);
  const stderr = writeStream(rt, 2, ctx.stderr);
  const proc = Object.assign(new EventEmitter(), {
    title: 'node',
    version: NODE_VERSION,
    versions,
    arch: 'x64',
    platform: 'linux',
    release: { name: 'node', lts: 'Jod', sourceUrl: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}.tar.gz` },
    argv,
    argv0: 'node',
    execArgv: [] as string[],
    execPath: '/usr/bin/node',
    env,
    pid: rt.pid,
    ppid: ctx.shell.pid,
    exitCode: undefined as number | string | undefined,
    config: { variables: {} },
    features: {},
    stdout,
    stderr,
    stdin: stdinStream(rt),
    cwd: () => rt.cwd,
    chdir(dir: unknown) {
      const target = normalize(String(dir), rt.cwd);
      if (!rt.asUser(() => ctx.vfs.isDir(target))) {
        const code = rt.asUser(() => ctx.vfs.exists(target)) ? 'ENOTDIR' : 'ENOENT';
        throw sysError(rt.realm, code, 'chdir', rt.cwd, String(dir));
      }
      rt.cwd = target;
    },
    exit: (code?: unknown): never => rt.exit(code === undefined ? Number(proc.exitCode ?? 0) : Number(code) | 0),
    abort: (): never => rt.exit(134),
    kill(pid: number, sig: string | number = 'SIGTERM') {
      const num = typeof sig === 'number' ? sig : (SIGNALS[String(sig).replace(/^SIG/, '')] ?? 15);
      if (!ctx.shell.kernel.procs.kill(Number(pid), num)) throw sysError(rt.realm, 'ESRCH', 'kill');
      return true;
    },
    hrtime: process.hrtime,
    memoryUsage: process.memoryUsage,
    cpuUsage: process.cpuUsage,
    resourceUsage: process.resourceUsage,
    uptime: () => (performance.now() - started) / 1000,
    nextTick(fn: unknown, ...args: unknown[]) {
      if (typeof fn !== 'function') throw new rt.realm.TypeError('The "callback" argument must be of type function');
      process.nextTick(() => rt.loop.invoke(fn as Callback, undefined, args));
    },
    umask: () => ctx.vfs.umask,
    getuid: () => rt.cred.uid,
    geteuid: () => rt.cred.uid,
    getgid: () => rt.cred.gid,
    getegid: () => rt.cred.gid,
    getgroups: () => [...rt.cred.groups],
    emitWarning(warning: unknown, type?: unknown) {
      const name = warning instanceof Error ? warning.name : typeof type === 'string' ? type : 'Warning';
      const message = warning instanceof Error ? warning.message : String(warning);
      rt.write(2, `(node:${rt.pid}) ${name}: ${message}\n(Use \`node --trace-warnings ...\` to show where the warning was created)\n`);
    },
  });
  return proc;
}

export type SandboxProcess = ReturnType<typeof createProcess>;
