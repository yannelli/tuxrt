import { Readable, Writable } from 'node:stream';
import { inspect } from 'node:util';
import { fsConstants as constants } from './constants.ts';
import { typeError } from './errors.ts';
import { createFsSync } from './fs.ts';
import { Dirent, Stats } from './fs-types.ts';
import type { NodeRuntime } from './runtime.ts';

type Fn = (...args: unknown[]) => unknown;

const ASYNC = [
  'access', 'appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'lstat', 'mkdir', 'mkdtemp', 'readdir', 'readFile',
  'readlink', 'realpath', 'rename', 'rm', 'rmdir', 'stat', 'symlink', 'truncate', 'unlink', 'utimes', 'writeFile',
];

/** The `fs` module: sync calls on the VFS, plus callback and promise forms layered on top. */
export function createFs(rt: NodeRuntime): Record<string, unknown> {
  const sync = createFsSync(rt) as unknown as Record<string, Fn>;
  const { realm } = rt;
  const fs: Record<string, unknown> = { ...sync, constants, F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, Stats, Dirent };
  const promises: Record<string, unknown> = { constants };

  const later = (fn: Fn, args: unknown[]) => {
    const cb = args.pop();
    if (typeof cb !== 'function') throw typeError(realm, 'ERR_INVALID_ARG_TYPE', `The "cb" argument must be of type function. Received ${inspect(cb)}`);
    rt.loop.schedule('immediate', () => {
      let result: unknown;
      try {
        result = fn(...args);
      } catch (e) {
        return cb(e);
      }
      cb(null, result);
    }, 0, []);
  };

  for (const name of [...ASYNC, 'open', 'close', 'fstat']) {
    const fn = sync[`${name}Sync`];
    fs[name] = (...args: unknown[]) => later(fn, args);
    if (!ASYNC.includes(name)) continue;
    promises[name] = (...args: unknown[]) =>
      new realm.Promise((resolve, reject) => {
        try {
          resolve(fn(...args));
        } catch (e) {
          reject(e);
        }
      });
  }
  (sync.realpathSync as unknown as { native: Fn }).native = sync.realpathSync;
  (fs.realpath as { native: Fn }).native = fs.realpath as Fn;
  fs.exists = (p: unknown, cb: (ok: unknown) => void) => later(() => sync.existsSync(p), [(_e: unknown, ok: unknown) => cb(ok)]);
  fs.read = (fd: number, buf: Uint8Array, ...rest: unknown[]) => {
    const cb = rest.pop() as Fn;
    later(() => sync.readSync(fd, buf, ...rest), [(err: unknown, n: unknown) => cb(err, n, buf)]);
  };
  fs.write = (fd: number, data: unknown, ...rest: unknown[]) => {
    const cb = rest.pop() as Fn;
    later(() => sync.writeSync(fd, data, ...rest), [(err: unknown, n: unknown) => cb(err, n, data)]);
  };

  fs.createReadStream = (p: unknown, o?: unknown) => {
    const encoding = typeof o === 'string' ? o : (o as { encoding?: string } | undefined)?.encoding;
    try {
      const stream = Readable.from([sync.readFileSync(p) as Buffer], { objectMode: false });
      if (encoding) stream.setEncoding(encoding as BufferEncoding);
      return Object.assign(stream, { path: p });
    } catch (e) {
      const stream = new Readable({ read() {} });
      process.nextTick(() => stream.destroy(e as Error));
      return stream;
    }
  };

  fs.createWriteStream = (p: unknown, o?: unknown) => {
    const flags = String((o as { flags?: string } | undefined)?.flags ?? 'w');
    let opened: unknown = null;
    try {
      if (!flags.startsWith('a')) sync.writeFileSync(p, '');
    } catch (e) {
      opened = e;
    }
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        try {
          sync.appendFileSync(p, chunk);
          stream.bytesWritten += chunk.length;
          done();
        } catch (e) {
          done(e as Error);
        }
      },
    }) as Writable & { bytesWritten: number; path: unknown };
    Object.assign(stream, { bytesWritten: 0, path: p });
    if (opened) process.nextTick(() => stream.destroy(opened as Error));
    return stream;
  };

  fs.promises = promises;
  return fs;
}
