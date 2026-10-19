import { fileURLToPath } from 'node:url';
import { inspect, types } from 'node:util';
import { FsError } from '../../../vfs/errors.ts';

export const NODE_VERSION = 'v22.11.0';

/** Intrinsics of the sandbox realm, so errors and promises pass `instanceof` checks in user code. */
export interface Realm {
  Error: ErrorConstructor;
  TypeError: TypeErrorConstructor;
  Promise: PromiseConstructor;
  Array: ArrayConstructor;
  Object: ObjectConstructor;
  JSON: JSON;
}

/** Thrown by process.exit() to unwind the sandbox stack. */
export class ProcessExit {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

const errnos: Record<string, [number, string]> = {
  ENOENT: [-2, 'no such file or directory'],
  ENOTDIR: [-20, 'not a directory'],
  EISDIR: [-21, 'illegal operation on a directory'],
  EEXIST: [-17, 'file already exists'],
  ENOTEMPTY: [-39, 'directory not empty'],
  EACCES: [-13, 'permission denied'],
  ELOOP: [-40, 'too many symbolic links encountered'],
  EINVAL: [-22, 'invalid argument'],
  EPERM: [-1, 'operation not permitted'],
  EBUSY: [-16, 'resource busy or locked'],
  EAGAIN: [-11, 'resource temporarily unavailable'],
  EBADF: [-9, 'bad file descriptor'],
  ESRCH: [-3, 'no such process'],
};

const hostRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Drops frames from tuxrt itself and Node internals, leaving only sandbox code. */
export function cleanStack(stack: string): string {
  return stack
    .split('\n')
    .filter((l) => !/^\s+at /.test(l) || !(l.includes('node:') || l.includes('file://') || l.includes(hostRoot)))
    .join('\n');
}

export function sysError(realm: Realm, code: string, syscall: string, path?: string, dest?: string): Error {
  const [errno, desc] = errnos[code] ?? [-1, code.toLowerCase()];
  const where = path === undefined ? '' : ` '${path}'${dest === undefined ? '' : ` -> '${dest}'`}`;
  const err = new realm.Error(`${code}: ${desc}, ${syscall}${where}`);
  Object.assign(err, { errno, code, syscall }, path === undefined ? {} : { path }, dest === undefined ? {} : { dest });
  err.stack = cleanStack(err.stack ?? '');
  return err;
}

/** Converts a VFS FsError into Node's fs error shape; anything else passes through. */
export function toNodeError(realm: Realm, e: unknown, syscall: string, path?: string, dest?: string): unknown {
  return e instanceof FsError ? sysError(realm, e.code, syscall, path, dest) : e;
}

export function typeError(realm: Realm, code: string, message: string): Error {
  const err = Object.assign(new realm.TypeError(message), { code });
  err.stack = cleanStack(err.stack ?? '');
  return err;
}

/** Node's "file:line / source / caret" banner for the first sandbox frame. */
function banner(stack: string, sources: Map<string, string>): string {
  for (const m of stack.matchAll(/^\s+at (?:.*\()?(.+?):(\d+):(\d+)\)?$/gm)) {
    const src = sources.get(m[1]);
    if (src === undefined) continue;
    const line = src.split('\n')[Number(m[2]) - 1] ?? '';
    return `${m[1]}:${m[2]}\n${line}\n${' '.repeat(Number(m[3]) - 1)}^\n\n`;
  }
  return '';
}

export function formatUncaught(err: unknown, sources: Map<string, string>): string {
  if (types.isNativeError(err) || (err instanceof Object && typeof (err as Error).stack === 'string')) {
    const e = err as Error;
    const stack = cleanStack(e.stack ?? String(e));
    try {
      e.stack = stack;
    } catch {}
    // Compile errors already carry V8's own "file:line / source / caret" decoration.
    const decorated = /^[^\n]*:\d+\n[^\n]*\n *\^/.test(stack);
    const head = decorated ? '' : banner(stack, sources);
    // inspect() brackets errors whose stack has no frames; Node prints those (and compile errors) bare.
    const framed = !decorated && /\n\s+at /.test(stack);
    const props = Object.fromEntries(Object.keys(e).filter((k) => k !== 'stack').map((k) => [k, (e as unknown as Record<string, unknown>)[k]]));
    const body = framed ? inspect(e) : `${stack}${Object.keys(props).length ? ` ${inspect(props)}` : ''}`;
    return `${head}${body}\n\nNode.js ${NODE_VERSION}\n`;
  }
  const shown = typeof err === 'string' ? err : inspect(err);
  return `${shown}\n(Use \`node --trace-uncaught ...\` to show where the exception was thrown)\n\nNode.js ${NODE_VERSION}\n`;
}
