import { globToRegExp } from '../../../../shell/glob.ts';
import { formatMode } from '../../../../vfs/mode.ts';
import { isoMinute } from '../stamp.ts';
import type { TarEntry } from './ustar.ts';

const TYPE_CHAR: Record<TarEntry['kind'], string> = { file: '-', dir: 'd', symlink: 'l', link: 'h' };

/** GNU safer_name_suffix: drops leading slashes and everything up to the last ".." component. */
export function safeName(name: string): { name: string; removed: string } {
  let cut = 0;
  for (let i = 0; i < name.length; ) {
    const end = name.indexOf('/', i);
    const part = name.slice(i, end === -1 ? name.length : end);
    if (part === '..') cut = end === -1 ? name.length : end + 1;
    if (end === -1) break;
    i = end + 1;
  }
  while (name[cut] === '/') cut++;
  return { name: name.slice(cut) || (cut ? '.' : name), removed: name.slice(0, cut) };
}

/** Like GNU --exclude defaults: unanchored, so a pattern may match any trailing run of path components. */
export function excluder(patterns: string[]): (name: string) => boolean {
  const res = patterns.map((p) => globToRegExp(p.replace(/\/+$/, '')));
  return (name) => {
    const n = name.replace(/\/+$/, '');
    const tails = [n];
    for (let i = n.indexOf('/'); i !== -1; i = n.indexOf('/', i + 1)) tails.push(n.slice(i + 1));
    return res.some((re) => tails.some((t) => re.test(t)));
  };
}

export function selects(member: string, operand: string): boolean {
  const m = member.replace(/\/+$/, '');
  const o = operand.replace(/\/+$/, '');
  return m === o || m.startsWith(`${o}/`);
}

/** `tar -tv` formatting; the owner/size column widens for the rest of the run like GNU's ugswidth. */
export function longLister(): (e: TarEntry, name: string) => string {
  let width = 19;
  return (e, name) => {
    const user = e.uname || String(e.uid);
    const group = e.gname || String(e.gid);
    const size = String(e.data.length);
    const pad = user.length + group.length + size.length + 2;
    width = Math.max(width, pad);
    const target = e.kind === 'symlink' ? ` -> ${e.linkname}` : e.kind === 'link' ? ` link to ${e.linkname}` : '';
    const modes = TYPE_CHAR[e.kind] + formatMode('file', e.mode).slice(1);
    return `${modes} ${user}/${group} ${size.padStart(width - pad + size.length)} ${isoMinute(e.mtime * 1000)} ${name}${target}`;
  };
}
