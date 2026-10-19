import { createRequire } from 'node:module';
import { posix, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChildProcess } from './child.ts';
import { createFs } from './fs-module.ts';
import { createOs } from './os.ts';
import type { NodeRuntime } from './runtime.ts';

type Mod = Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;

const hostRequire = createRequire(import.meta.url);

// Pure host modules with no access to the host filesystem, processes or network.
const PASSTHROUGH = [
  'assert', 'assert/strict', 'buffer', 'events', 'perf_hooks', 'querystring', 'stream', 'stream/promises',
  'stream/web', 'string_decoder', 'util', 'util/types',
];
const UNAVAILABLE = [
  'async_hooks', 'cluster', 'dgram', 'dns', 'dns/promises', 'http', 'http2', 'https', 'inspector', 'net', 'repl',
  'tls', 'v8', 'vm', 'wasi', 'worker_threads',
];
const OWN = [
  'child_process', 'console', 'crypto', 'fs', 'fs/promises', 'module', 'os', 'path', 'path/posix', 'process',
  'readline', 'readline/promises', 'timers', 'timers/promises', 'tty', 'url', 'zlib',
];
export const builtinNames = [...PASSTHROUGH, ...UNAVAILABLE, ...OWN].sort();

const CRYPTO_ASYNC = ['randomBytes', 'randomFill', 'randomInt', 'pbkdf2', 'scrypt', 'generateKeyPair', 'generateKey', 'hkdf', 'generatePrime', 'checkPrime'];
const ZLIB_ASYNC = ['deflate', 'deflateRaw', 'gzip', 'gunzip', 'inflate', 'inflateRaw', 'unzip', 'brotliCompress', 'brotliDecompress'];

/** Host APIs that finish on the thread pool must keep the sandbox's loop alive until their callback. */
function trackCallbacks(rt: NodeRuntime, mod: Mod, names: string[]): Mod {
  const out: Mod = { ...mod };
  for (const name of names) {
    const fn = mod[name] as Fn | undefined;
    if (typeof fn !== 'function') continue;
    out[name] = (...args: unknown[]) => {
      const cb = args.at(-1);
      if (typeof cb !== 'function') return fn(...args);
      const handle = {};
      rt.loop.ref(handle);
      args[args.length - 1] = (...result: unknown[]) => {
        rt.loop.unref(handle);
        rt.loop.invoke(cb as Fn, undefined, result);
      };
      return fn(...args);
    };
  }
  return out;
}

function createPath(rt: NodeRuntime): Mod {
  const resolve = (...parts: unknown[]) => posix.resolve(rt.cwd, ...parts.map(String));
  const path: Mod = { ...posix, resolve, relative: (from: unknown, to: unknown) => posix.relative(resolve(from), resolve(to)) };
  return Object.assign(path, { posix: path, win32 });
}

// The sandbox is Linux whatever the host is, so file URLs always use POSIX rules.
const toPath = (u: unknown) => fileURLToPath(u as string, { windows: false });

function timersPromises(rt: NodeRuntime): Mod {
  const after = (kind: 'timeout' | 'immediate', ms: unknown, value: unknown) =>
    new rt.realm.Promise((resolve) => rt.loop.schedule(kind, () => resolve(value), ms, []));
  return {
    setTimeout: (ms: unknown, value: unknown) => after('timeout', ms, value),
    setImmediate: (value: unknown) => after('immediate', 0, value),
    scheduler: { wait: (ms: unknown) => after('timeout', ms, undefined), yield: () => after('immediate', 0, undefined) },
  };
}

export function createBuiltin(rt: NodeRuntime, name: string): unknown {
  if (PASSTHROUGH.includes(name)) return hostRequire(`node:${name}`);
  const g = rt.globals;
  switch (name) {
    case 'fs':
      return createFs(rt);
    case 'fs/promises':
      return (rt.modules.builtin('fs') as Mod).promises;
    case 'path':
    case 'path/posix':
      return createPath(rt);
    case 'os':
      return createOs(rt);
    case 'child_process':
      return createChildProcess(rt);
    case 'process':
      return rt.process;
    case 'console':
      return rt.console;
    case 'crypto': {
      const crypto = hostRequire('node:crypto') as Mod;
      return { ...trackCallbacks(rt, crypto, CRYPTO_ASYNC), webcrypto: g.crypto, subtle: (g.crypto as Mod).subtle };
    }
    case 'zlib':
      return trackCallbacks(rt, hostRequire('node:zlib') as Mod, ZLIB_ASYNC);
    case 'readline':
    case 'readline/promises': {
      // The tuxrt terminal already echoes and edits lines, so readline must not act as a TTY itself.
      const rl = hostRequire(`node:${name}`) as Mod & { createInterface: Fn };
      const createInterface = (o: unknown, ...rest: unknown[]) =>
        rl.createInterface(o && typeof o === 'object' && !('terminal' in o) ? { ...o, terminal: false } : o, ...rest);
      return { ...rl, createInterface };
    }
    case 'timers':
      return {
        setTimeout: g.setTimeout, setInterval: g.setInterval, setImmediate: g.setImmediate,
        clearTimeout: g.clearTimeout, clearInterval: g.clearInterval, clearImmediate: g.clearImmediate,
      };
    case 'timers/promises':
      return timersPromises(rt);
    case 'tty': {
      const tty = [rt.ctx.stdin.isTTY, rt.ctx.stdout.isTTY, rt.ctx.stderr.isTTY];
      return { isatty: (fd: number) => !!tty[fd] };
    }
    case 'url': {
      const url = hostRequire('node:url') as Mod;
      return {
        ...url,
        fileURLToPath: toPath,
        pathToFileURL: (p: unknown) => pathToFileURL(posix.resolve(rt.cwd, String(p)), { windows: false }),
      };
    }
    case 'module':
      return {
        builtinModules: builtinNames,
        isBuiltin: (n: string) => !!rt.modules.builtinName(String(n)),
        createRequire: (f: unknown) => {
          const file = String(f).startsWith('file:') ? toPath(String(f)) : String(f);
          return rt.modules.newModule(file, null).require;
        },
      };
  }
  const err = new rt.realm.Error(`Cannot load 'node:${name}': this module is not available in the tuxrt sandbox`);
  throw Object.assign(err, { code: 'ERR_TUXRT_UNSUPPORTED_MODULE' });
}
