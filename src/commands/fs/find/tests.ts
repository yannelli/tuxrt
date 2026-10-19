import { globToRegExp } from '../../../shell/glob.ts';
import { applyChmod } from '../../../vfs/mode.ts';
import type { Stat } from '../../../vfs/types.ts';
import { findGroup, findUser } from '../../../vfs/users.ts';
import type { Ctx } from '../../types.ts';
import { DEVICES, msgOf, q } from '../common.ts';

export interface Visit {
  /** Path as find prints it ("./a/b"). */
  path: string;
  abs: string;
  name: string;
  st: Stat;
  depth: number;
}

export type Pred = (v: Visit) => boolean | Promise<boolean>;

export class FindError extends Error {}

const DAY = 86_400_000;
const SIZE_UNITS: Record<string, number> = { b: 512, c: 1, w: 2, k: 1024, M: 1024 ** 2, G: 1024 ** 3 };

/** "+N" (more than), "-N" (less than) or "N" (exactly). */
function compare(arg: string, test: string): (n: number) => boolean {
  const m = /^([+-]?)(\d+)$/.exec(arg);
  if (!m) throw new FindError(`invalid argument ${q(arg)} to ${q(test)}`);
  const n = Number(m[2]);
  return m[1] === '+' ? (x) => x > n : m[1] === '-' ? (x) => x < n : (x) => x === n;
}

function typeChar(v: Visit): string {
  if (DEVICES[v.abs]) return 'c';
  return v.st.kind === 'dir' ? 'd' : v.st.kind === 'symlink' ? 'l' : 'f';
}

function age(field: 'mtime' | 'ctime', unit: number) {
  return (arg: string, _ctx: Ctx, test: string): Pred => {
    const cmp = compare(arg, test);
    const now = Date.now();
    return (v) => cmp(Math.floor((now - Math.max(v.st[field], v.st.mtime)) / unit));
  };
}

function numeric(get: (st: Stat) => number) {
  return (arg: string, _ctx: Ctx, test: string): Pred => {
    const cmp = compare(arg, test);
    return (v) => cmp(get(v.st));
  };
}

function owner(kind: 'user' | 'group') {
  return (arg: string, ctx: Ctx): Pred => {
    const id = /^\d+$/.test(arg) ? Number(arg) : kind === 'user' ? findUser(ctx.vfs, arg)?.uid : findGroup(ctx.vfs, arg)?.gid;
    if (id === undefined) {
      throw new FindError(`${q(arg)} is not the name of ${kind === 'user' ? 'a known user' : 'an existing group'}`);
    }
    return (v) => (kind === 'user' ? v.st.uid : v.st.gid) === id;
  };
}

function glob(on: 'name' | 'path', flags = '') {
  return (arg: string): Pred => {
    const re = globToRegExp(arg, flags);
    return (v) => re.test(v[on]);
  };
}

function regex(flags = '') {
  return (arg: string): Pred => {
    const re = new RegExp(`^(?:${arg})$`, flags);
    return (v) => re.test(v.path);
  };
}

/** Tests that take one argument. */
export const VALUE_TESTS: Record<string, (arg: string, ctx: Ctx, test: string) => Pred> = {
  '-name': glob('name'),
  '-iname': glob('name', 'i'),
  '-path': glob('path'),
  '-wholename': glob('path'),
  '-ipath': glob('path', 'i'),
  '-iwholename': glob('path', 'i'),
  '-regex': regex(),
  '-iregex': regex('i'),
  '-type': (arg) => {
    const types = arg.split(',');
    const bad = types.find((t) => !/^[fdlcbps]$/.test(t));
    if (bad !== undefined) throw new FindError(`Unknown argument to -type: ${bad}`);
    return (v) => types.includes(typeChar(v));
  },
  '-size': (arg, _ctx, test) => {
    const m = /^([+-]?\d+)([bcwkMG]?)$/.exec(arg);
    if (!m) throw new FindError(`invalid argument ${q(arg)} to ${q(test)}`);
    const unit = SIZE_UNITS[m[2] || 'b'];
    const cmp = compare(m[1], test);
    return (v) => cmp(Math.ceil(v.st.size / unit));
  },
  '-perm': (arg) => {
    const m = /^([-/]?)(.+)$/.exec(arg)!;
    const want = applyChmod(m[2], 0, false);
    if (want === null) throw new FindError(`invalid mode ${q(arg)}`);
    const match = { '': (p: number) => p === want, '-': (p: number) => (p & want) === want, '/': (p: number) => !want || (p & want) !== 0 };
    return (v) => match[m[1] as '' | '-' | '/'](v.st.mode & 0o7777);
  },
  '-newer': (arg, ctx) => {
    let ref: number;
    try {
      ref = ctx.vfs.stat(ctx.shell.abs(arg)).mtime;
    } catch (e) {
      throw new FindError(`${q(arg)}: ${msgOf(e)}`);
    }
    return (v) => v.st.mtime > ref;
  },
  '-user': owner('user'),
  '-group': owner('group'),
  '-uid': numeric((st) => st.uid),
  '-gid': numeric((st) => st.gid),
  '-links': numeric((st) => st.nlink),
  '-mtime': age('mtime', DAY),
  '-atime': age('mtime', DAY),
  '-ctime': age('ctime', DAY),
  '-mmin': age('mtime', 60_000),
  '-amin': age('mtime', 60_000),
  '-cmin': age('ctime', 60_000),
};

/** Tests without arguments. */
export const FLAG_TESTS: Record<string, (ctx: Ctx) => Pred> = {
  '-true': () => () => true,
  '-false': () => () => false,
  '-empty': (ctx) => (v) => {
    if (v.st.kind === 'file') return v.st.size === 0 && !DEVICES[v.abs];
    if (v.st.kind !== 'dir') return false;
    try {
      return ctx.vfs.readdir(v.abs).length === 0;
    } catch {
      return false;
    }
  },
  '-readable': (ctx) => (v) => ctx.vfs.access(v.abs, 'r'),
  '-writable': (ctx) => (v) => ctx.vfs.access(v.abs, 'w'),
  '-executable': (ctx) => (v) => ctx.vfs.access(v.abs, 'x'),
};
