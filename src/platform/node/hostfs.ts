import * as fs from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { HostFs } from '../../vfs/hostfs.ts';

/** A HostFs over a real directory. Every path is checked to stay inside `root`, even through host symlinks. */
export function nodeHostFs(root: string): HostFs {
  const base = fs.realpathSync(resolve(root));
  const inside = (p: string) => {
    const rel = relative(base, p);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
  };
  const real = (path: string) => {
    const p = join(base, ...path.split('/').filter(Boolean));
    if (!inside(p)) throw Object.assign(new Error('outside the mount'), { code: 'EACCES' });
    if (p !== base && !inside(fs.realpathSync(join(p, '..')))) throw Object.assign(new Error('outside the mount'), { code: 'EACCES' });
    return p;
  };
  /** Reads and writes follow a final host symlink, so its resolved target must stay inside too. */
  const resolved = (path: string) => {
    const p = real(path);
    if (fs.existsSync(p) && !inside(fs.realpathSync(p))) throw Object.assign(new Error('outside the mount'), { code: 'EACCES' });
    return p;
  };
  const posix = process.platform !== 'win32';
  return {
    lstat(path) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(real(path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
      const kind = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'file';
      return { kind, size: st.size, mtime: st.mtimeMs, mode: posix ? st.mode & 0o7777 : undefined };
    },
    readdir: (path) => fs.readdirSync(real(path)),
    readFile: (path) => fs.readFileSync(resolved(path)),
    writeFile: (path, data) => fs.writeFileSync(resolved(path), data),
    mkdir: (path) => fs.mkdirSync(real(path)),
    unlink: (path) => fs.unlinkSync(real(path)),
    rmdir: (path) => fs.rmdirSync(real(path)),
    rename: (from, to) => fs.renameSync(real(from), real(to)),
    readlink: (path) => fs.readlinkSync(real(path)),
    symlink: (target, path) => fs.symlinkSync(target, real(path)),
    chmod: (path, mode) => posix && fs.chmodSync(real(path), mode),
    utimes: (path, mtime) => fs.utimesSync(real(path), new Date(), new Date(mtime)),
  };
}
