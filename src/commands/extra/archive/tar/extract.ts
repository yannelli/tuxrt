import { checkpoint } from '../../../../shell/interpreter.ts';
import { errMessage, FsError } from '../../../../vfs/errors.ts';
import { formatMode } from '../../../../vfs/mode.ts';
import { dirname, normalize } from '../../../../vfs/path.ts';
import { findGroup, findUser } from '../../../../vfs/users.ts';
import type { Ctx } from '../../../types.ts';
import { concatBytes, fromBytes } from '../../../../vfs/bytes.ts';
import type { TarArgs } from './args.ts';
import { excluder, longLister, safeName, selects } from './names.ts';
import type { TarStatus } from './status.ts';
import type { TarEntry } from './ustar.ts';

interface Extraction {
  ctx: Ctx;
  a: TarArgs;
  status: TarStatus;
  /** Directory metadata is applied last, so read-only directories can still be filled. */
  dirs: [string, string, TarEntry][];
}

function attempt(x: Extraction, name: string, what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    x.status.error(`${name}: ${what}: ${errMessage(e)}`);
  }
}

function setMeta(x: Extraction, path: string, name: string, e: TarEntry): void {
  const { vfs } = x.ctx;
  if (vfs.cred.uid === 0) {
    const uid = (e.uname ? findUser(vfs, e.uname)?.uid : undefined) ?? e.uid;
    const gid = (e.gname ? findGroup(vfs, e.gname)?.gid : undefined) ?? e.gid;
    attempt(x, name, `Cannot change ownership to uid ${uid}, gid ${gid}`, () => vfs.chown(path, uid, gid, false));
  }
  if (e.kind === 'symlink') return;
  const mode = vfs.cred.uid === 0 || x.a.preserve ? e.mode : e.mode & 0o777 & ~vfs.umask;
  attempt(x, name, `Cannot change mode to ${formatMode('file', mode).slice(1)}`, () => vfs.chmod(path, mode));
  attempt(x, name, 'Cannot utime', () => vfs.touch(path, e.mtime * 1000));
}

function extractOne(x: Extraction, e: TarEntry, name: string): void {
  const { vfs } = x.ctx;
  const path = normalize(name, x.a.dir);
  if (path === x.a.dir) {
    if (e.kind === 'dir') x.dirs.push([path, name, e]);
    return;
  }
  try {
    vfs.mkdir(dirname(path), true);
  } catch (err) {
    return x.status.error(`${name}: Cannot mkdir: ${errMessage(err)}`);
  }
  const existing = vfs.tryLookup(path, false);
  const linkTarget = e.kind === 'link' ? normalize(safeName(e.linkname).name, x.a.dir) : '';
  const verb = e.kind === 'dir' ? 'Cannot mkdir' : e.kind === 'link' ? `Cannot hard link to '${e.linkname}'` : 'Cannot open';
  try {
    if (e.kind === 'dir') {
      if (existing?.kind !== 'dir') {
        if (existing) vfs.unlink(path);
        vfs.mkdir(path, false, 0o700);
      }
      x.dirs.push([path, name, e]);
      return;
    }
    if (existing?.kind === 'dir') throw new FsError('EISDIR', path);
    if (existing) vfs.unlink(path);
    if (e.kind === 'symlink') vfs.symlink(e.linkname, path);
    else if (e.kind === 'link') vfs.link(linkTarget, path);
    else vfs.writeFile(path, fromBytes(e.data));
  } catch (err) {
    return x.status.error(`${name}: ${verb}: ${errMessage(err)}`);
  }
  if (e.kind !== 'link') setMeta(x, path, name, e);
}

/** Handles -t and -x over parsed members, including operand selection and --exclude. */
export async function listOrExtract(ctx: Ctx, a: TarArgs, status: TarStatus, entries: TarEntry[]): Promise<void> {
  const x: Extraction = { ctx, a, status, dirs: [] };
  const excluded = excluder(a.excludes);
  const wanted = a.operands.map((o) => o.name);
  const found = new Set<string>();
  const lister = longLister();
  const log = a.toStdout ? ctx.stderr : ctx.stdout;
  const long = a.verbose > 1 || (a.mode === 't' && a.verbose > 0);
  const piped: Uint8Array[] = [];
  for (const e of entries) {
    await checkpoint(ctx.shell);
    const safe = safeName(e.name);
    if (safe.removed) status.once(`Removing leading \`${safe.removed}' from member names`);
    const name = safe.name;
    if (excluded(name)) continue;
    const hits = wanted.filter((w) => selects(name, w));
    if (wanted.length && !hits.length) continue;
    for (const h of hits) found.add(h);
    if (a.mode === 't' || a.verbose) log.write(`${long ? lister(e, name) : name}\n`);
    if (a.mode !== 'x') continue;
    if (!a.toStdout) extractOne(x, e, name);
    else if (e.kind === 'file') piped.push(e.data);
  }
  if (piped.length) ctx.stdout.write(fromBytes(concatBytes(piped)));
  for (const [path, name, e] of x.dirs.reverse()) setMeta(x, path, name, e);
  for (const w of wanted) if (!found.has(w)) status.error(`${w}: Not found in archive`);
}
