import { checkpoint } from '../../../../shell/interpreter.ts';
import type { Writer } from '../../../../shell/io.ts';
import { errMessage } from '../../../../vfs/errors.ts';
import { normalize } from '../../../../vfs/path.ts';
import type { Stat } from '../../../../vfs/types.ts';
import { groupName, userName } from '../../../../vfs/users.ts';
import type { Ctx } from '../../../types.ts';
import { toBytes } from '../../../../vfs/bytes.ts';
import type { TarArgs } from './args.ts';
import { excluder, longLister, safeName } from './names.ts';
import type { TarStatus } from './status.ts';
import { encodeEntry, TarError, type TarEntry } from './ustar.ts';

interface Walk {
  ctx: Ctx;
  status: TarStatus;
  out: Uint8Array[];
  archive: string | null;
  excluded: (name: string) => boolean;
  log: ((e: TarEntry) => void) | null;
}

function entryOf(w: Walk, name: string, st: Stat, path: string): TarEntry | null {
  const { vfs } = w.ctx;
  const base = {
    mode: st.mode, uid: st.uid, gid: st.gid, uname: userName(vfs, st.uid), gname: groupName(vfs, st.gid),
    mtime: Math.floor(st.mtime / 1000), linkname: '', data: new Uint8Array(0),
  };
  try {
    if (st.kind === 'dir') return { ...base, kind: 'dir', name: name.endsWith('/') ? name : `${name}/` };
    if (st.kind === 'symlink') return { ...base, kind: 'symlink', name, linkname: vfs.readlink(path) };
    return { ...base, kind: 'file', name, data: toBytes(vfs.readFile(path)) };
  } catch (e) {
    w.status.error(`${name}: Cannot open: ${errMessage(e)}`);
    return null;
  }
}

async function add(w: Walk, path: string, name: string): Promise<void> {
  await checkpoint(w.ctx.shell);
  const { vfs } = w.ctx;
  if (w.excluded(name)) return;
  let st: Stat;
  try {
    st = vfs.stat(path, false);
  } catch (e) {
    w.status.error(`${name}: Cannot stat: ${errMessage(e)}`);
    return;
  }
  if (path === w.archive) {
    w.ctx.stderr.write(`tar: ${name}: file is the archive; not dumped\n`);
    return;
  }
  const entry = entryOf(w, name, st, path);
  if (!entry) return;
  try {
    w.out.push(encodeEntry(entry));
    w.log?.(entry);
  } catch (e) {
    if (!(e instanceof TarError)) throw e;
    w.status.error(`${name}: ${e.message}`);
  }
  if (st.kind !== 'dir') return;
  let children: string[];
  try {
    children = vfs.readdir(path);
  } catch (e) {
    w.status.error(`${name}: Cannot open: ${errMessage(e)}`);
    return;
  }
  for (const child of children) await add(w, `${path === '/' ? '' : path}/${child}`, `${entry.name}${child}`);
}

/** Returns the encoded member blocks for every operand, reporting problems through `status`. */
export async function createEntries(ctx: Ctx, a: TarArgs, status: TarStatus, archive: string | null, verbose: Writer): Promise<Uint8Array[]> {
  const lister = longLister();
  const w: Walk = {
    ctx, status, out: [], archive, excluded: excluder(a.excludes),
    log: !a.verbose ? null : (e) => verbose.write(`${a.verbose > 1 ? lister(e, e.name) : e.name}\n`),
  };
  for (const op of a.operands) {
    const trimmed = op.name.length > 1 ? op.name.replace(/\/+$/, '') : op.name;
    const safe = safeName(trimmed);
    if (safe.removed) status.once(`Removing leading \`${safe.removed}' from member names`);
    await add(w, normalize(trimmed, op.dir), safe.name);
  }
  return w.out;
}
