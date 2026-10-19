import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { FsError } from '../../../vfs/errors.ts';
import { dirname, normalize } from '../../../vfs/path.ts';
import { fromBytes, toBytes } from '../../../vfs/bytes.ts';
import { fsConstants as constants } from './constants.ts';
import { sysError, toNodeError, typeError } from './errors.ts';
import { Dirent, Stats } from './fs-types.ts';
import type { NodeRuntime } from './runtime.ts';

type Opts = { [k: string]: unknown } | string | number | null | undefined;

const STDIO: Record<string, number> = { '/dev/stdin': 0, '/dev/stdout': 1, '/dev/stderr': 2 };
const isUtf8Name = (enc: string | null) => !enc || enc === 'utf8' || enc === 'utf-8';
const optsOf = (o: Opts) => (typeof o === 'object' && o ? o : {});
const encodingOf = (o: Opts) => (typeof o === 'string' ? o : typeof optsOf(o).encoding === 'string' ? (optsOf(o).encoding as string) : null);
const modeOf = (m: unknown, fallback: number) => (typeof m === 'number' ? m : typeof m === 'string' ? parseInt(m, 8) : fallback);
const timeOf = (t: unknown) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t * 1000 : Date.parse(String(t)));

/** Synchronous `fs` API over the VFS, with Node's error shapes. */
export function createFsSync(rt: NodeRuntime) {
  const { vfs } = rt.ctx;
  const { realm } = rt;
  const fds = new Map<number, { path: string; pos: number }>();
  let nextFd = 20;

  function pathArg(p: unknown, name = 'path'): string {
    if (typeof p === 'string') return p;
    if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength).toString();
    if (p instanceof URL) return fileURLToPath(p, { windows: false });
    throw typeError(realm, 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be of type string or an instance of Buffer or URL. Received ${inspect(p)}`);
  }
  const abs = (p: unknown, name?: string) => normalize(pathArg(p, name), rt.cwd);

  function op<T>(syscall: string, p: unknown, fn: (path: string) => T, dest?: unknown): T {
    const path = pathArg(p);
    try {
      return rt.asUser(() => fn(normalize(path, rt.cwd)));
    } catch (e) {
      throw toNodeError(realm, e, syscall, path, dest === undefined ? undefined : pathArg(dest, 'dest'));
    }
  }

  function decode(text: string, enc: string | null): string | Buffer {
    if (!enc || enc === 'buffer') return toBytes(text);
    return isUtf8Name(enc) ? text : toBytes(text).toString(enc as BufferEncoding);
  }

  function encode(data: unknown, enc: string | null): string {
    if (typeof data === 'string') return isUtf8Name(enc) ? data : fromBytes(Buffer.from(data, enc as BufferEncoding));
    if (ArrayBuffer.isView(data)) return fromBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const kinds = 'string or an instance of Buffer, TypedArray, or DataView';
    throw typeError(realm, 'ERR_INVALID_ARG_TYPE', `The "data" argument must be of type ${kinds}. Received ${inspect(data)}`);
  }

  const fdOf = (p: unknown) => (typeof p === 'number' ? p : typeof p === 'string' ? STDIO[normalize(p, rt.cwd)] : undefined);
  function fdEntry(fd: number) {
    const entry = fds.get(fd);
    if (!entry) throw sysError(realm, 'EBADF', 'read');
    return entry;
  }

  function readFd(fd: number): string {
    if (fd !== 0) return readFileSync(fdEntry(fd).path, 'utf8') as string;
    if (rt.stdinText === undefined) throw sysError(realm, 'EAGAIN', 'read');
    const text = rt.stdinText;
    rt.stdinText = '';
    return text;
  }

  function writeFd(fd: number, text: string): void {
    if (fd === 1 || fd === 2) return rt.write(fd, text);
    op('write', fdEntry(fd).path, (a) => vfs.writeFile(a, text, true));
  }

  function readFileSync(p: unknown, o?: Opts) {
    const fd = fdOf(p);
    if (fd !== undefined) return decode(readFd(fd), encodingOf(o));
    try {
      return decode(op('open', p, (a) => vfs.readFile(a)), encodingOf(o));
    } catch (e) {
      throw (e as { code?: string }).code === 'EISDIR' ? sysError(realm, 'EISDIR', 'read') : e;
    }
  }

  function writeFileSync(p: unknown, data: unknown, o?: Opts, append = false): void {
    const { flag, mode } = optsOf(o);
    const text = encode(data, encodingOf(o));
    const fd = fdOf(p);
    if (fd !== undefined) return writeFd(fd, text);
    op('open', p, (a) => {
      const existed = vfs.exists(a);
      if (String(flag ?? '').includes('x') && existed) throw new FsError('EEXIST', a);
      vfs.writeFile(a, text, append || String(flag ?? '').startsWith('a'));
      if (!existed && mode !== undefined) vfs.chmod(a, modeOf(mode, 0o666) & ~vfs.umask);
    });
  }

  function readdirSync(p: unknown, o?: Opts) {
    const { withFileTypes, recursive } = optsOf(o);
    return op('scandir', p, (root) => {
      const out: (string | Dirent)[] = [];
      const walk = (dir: string, rel: string) => {
        for (const name of vfs.readdir(dir)) {
          const full = `${dir === '/' ? '' : dir}/${name}`;
          const kind = vfs.stat(full, false).kind;
          const relName = rel ? `${rel}/${name}` : name;
          out.push(withFileTypes ? new Dirent(name, dir, kind) : relName);
          if (recursive && kind === 'dir') walk(full, relName);
        }
      };
      walk(root, '');
      return realm.Array.from(out);
    });
  }

  function mkdirSync(p: unknown, o?: Opts): string | undefined {
    const opts = typeof o === 'number' || typeof o === 'string' ? { mode: o } : optsOf(o);
    const mode = modeOf(opts.mode, 0o777) & ~vfs.umask;
    return op('mkdir', p, (a) => {
      if (!opts.recursive) return void vfs.mkdir(a, false, mode);
      let first: string | undefined;
      for (let cur = a; !vfs.exists(cur); cur = dirname(cur)) first = cur;
      vfs.mkdir(a, true, mode);
      return first;
    });
  }

  function statSync(p: unknown, o?: Opts, follow = true): Stats | undefined {
    try {
      return new Stats(op(follow ? 'stat' : 'lstat', p, (a) => vfs.stat(a, follow)));
    } catch (e) {
      if (optsOf(o).throwIfNoEntry === false && (e as { code?: string }).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  const removeTree = (a: string): void => {
    if (vfs.stat(a, false).kind !== 'dir') return vfs.unlink(a);
    for (const name of vfs.readdir(a)) removeTree(`${a}/${name}`);
    vfs.rmdir(a);
  };

  function rmSync(p: unknown, o?: Opts): void {
    const { recursive, force } = optsOf(o);
    const path = pathArg(p);
    const node = rt.asUser(() => vfs.tryLookup(normalize(path, rt.cwd), false));
    if (!node) {
      if (force) return;
      throw sysError(realm, 'ENOENT', 'lstat', path);
    }
    if (node.kind === 'dir' && !recursive) {
      const msg = `Path is a directory: rm returned EISDIR (is a directory) ${path}`;
      throw Object.assign(new realm.Error(msg), { code: 'ERR_FS_EISDIR', errno: 21, syscall: 'rm', path });
    }
    op('rm', p, removeTree);
  }

  const copyTree = (s: string, d: string): void => {
    const st = vfs.stat(s, false);
    if (st.kind === 'symlink') return vfs.symlink(vfs.readlink(s), d);
    if (st.kind === 'file') {
      vfs.writeFile(d, vfs.readFile(s));
      return vfs.chmod(d, st.mode);
    }
    if (!vfs.isDir(d)) vfs.mkdir(d, false, st.mode);
    for (const name of vfs.readdir(s)) copyTree(`${s}/${name}`, `${d}/${name}`);
  };

  function cpSync(src: unknown, dst: unknown, o?: Opts): void {
    op('cp', src, (s) => {
      if (vfs.isDir(s) && !optsOf(o).recursive) {
        const msg = `Recursive option is required to copy a directory: cp returned EISDIR (${pathArg(src)} is a directory (not copied))`;
        throw Object.assign(new realm.Error(msg), { code: 'ERR_FS_EISDIR', errno: 21, syscall: 'cp', path: pathArg(src) });
      }
      copyTree(s, abs(dst, 'dest'));
    }, dst);
  }

  function openSync(p: unknown, flags: unknown = 'r', mode?: unknown): number {
    const f = String(flags);
    const path = op('open', p, (a) => {
      const existed = vfs.exists(a);
      if (f.includes('x') && existed) throw new FsError('EEXIST', a);
      if (f.startsWith('w') || (!existed && f.startsWith('a'))) vfs.writeFile(a, '');
      else vfs.readFile(a);
      if (!existed && f !== 'r') vfs.chmod(a, modeOf(mode, 0o666) & ~vfs.umask);
      return a;
    });
    fds.set(nextFd, { path, pos: 0 });
    return nextFd++;
  }

  function readSync(fd: number, buf: Uint8Array, offset: unknown = 0, length?: unknown, position?: unknown): number {
    const off = typeof offset === 'object' && offset ? Number((offset as { offset?: number }).offset ?? 0) : Number(offset);
    const len = typeof length === 'number' ? length : buf.byteLength - off;
    const entry = fd === 0 ? { path: '', pos: 0 } : fdEntry(fd);
    const bytes = toBytes(fd === 0 ? readFd(0) : (readFileSync(entry.path, 'utf8') as string));
    const pos = typeof position === 'number' ? position : entry.pos;
    const n = Math.max(0, Math.min(len, bytes.length - pos));
    buf.set(bytes.subarray(pos, pos + n), off);
    if (typeof position !== 'number') entry.pos += n;
    return n;
  }

  return {
    readFileSync,
    writeFileSync: (p: unknown, data: unknown, o?: Opts) => writeFileSync(p, data, o),
    appendFileSync: (p: unknown, data: unknown, o?: Opts) => writeFileSync(p, data, o, true),
    existsSync: (p: unknown) => {
      try {
        return fdOf(p) !== undefined || rt.asUser(() => vfs.exists(abs(p)));
      } catch {
        return false;
      }
    },
    readdirSync,
    mkdirSync,
    statSync: (p: unknown, o?: Opts) => statSync(p, o),
    lstatSync: (p: unknown, o?: Opts) => statSync(p, o, false),
    unlinkSync: (p: unknown) => op('unlink', p, (a) => vfs.unlink(a)),
    rmdirSync: (p: unknown, o?: Opts) => (optsOf(o).recursive ? rmSync(p, o) : op('rmdir', p, (a) => vfs.rmdir(a))),
    rmSync,
    renameSync: (from: unknown, to: unknown) => op('rename', from, (a) => vfs.rename(a, abs(to, 'newPath')), to),
    copyFileSync: (src: unknown, dst: unknown, mode = 0) =>
      op('copyfile', src, (s) => {
        const d = abs(dst, 'dest');
        const existed = vfs.exists(d);
        if (mode & constants.COPYFILE_EXCL && existed) throw new FsError('EEXIST', d);
        vfs.writeFile(d, vfs.readFile(s));
        if (!existed) vfs.chmod(d, vfs.stat(s).mode);
      }, dst),
    cpSync,
    symlinkSync: (target: unknown, p: unknown) => op('symlink', target, () => vfs.symlink(pathArg(target, 'target'), abs(p)), p),
    readlinkSync: (p: unknown) => op('readlink', p, (a) => vfs.readlink(a)),
    realpathSync: (p: unknown) => op('lstat', p, (a) => vfs.realpath(a)),
    chmodSync: (p: unknown, mode: unknown) => op('chmod', p, (a) => vfs.chmod(a, modeOf(mode, 0))),
    chownSync: (p: unknown, uid: number, gid: number) => op('chown', p, (a) => vfs.chown(a, uid, gid)),
    accessSync: (p: unknown, mode = 0) =>
      op('access', p, (a) => {
        if (mode && !vfs.can(vfs.lookup(a), mode)) throw new FsError('EACCES', a);
      }),
    mkdtempSync: (prefix: unknown) => {
      const path = `${pathArg(prefix, 'prefix')}${randomBytes(6).toString('base64url').slice(0, 6)}`;
      op('mkdtemp', path, (a) => vfs.mkdir(a, false, 0o700));
      return path;
    },
    utimesSync: (p: unknown, _atime: unknown, mtime: unknown) => op('utime', p, (a) => vfs.touch(a, timeOf(mtime))),
    truncateSync: (p: unknown, len = 0) =>
      op('open', p, (a) => {
        const bytes = toBytes(vfs.readFile(a));
        const out = Buffer.alloc(len);
        bytes.copy(out, 0, 0, len);
        vfs.writeFile(a, fromBytes(out));
      }),
    openSync,
    closeSync: (fd: number) => {
      if (!fds.delete(fd)) throw sysError(realm, 'EBADF', 'close');
    },
    readSync,
    writeSync: (fd: number, data: unknown, ...rest: unknown[]) => {
      const text = encode(data, typeof rest[1] === 'string' ? rest[1] : null);
      writeFd(fd, text);
      return Buffer.byteLength(text);
    },
    fstatSync: (fd: number) => statSync(fdEntry(fd).path),
  };
}

export type FsSync = ReturnType<typeof createFsSync>;
