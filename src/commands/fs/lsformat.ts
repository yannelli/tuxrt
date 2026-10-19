import { shellQuote } from '../../shell/quote.ts';
import { formatMode } from '../../vfs/mode.ts';
import type { Stat } from '../../vfs/types.ts';
import { groupName, userName } from '../../vfs/users.ts';
import type { VFS } from '../../vfs/vfs.ts';
import { DEVICES, human, lsDate, tryStat } from './common.ts';

export interface Entry {
  name: string;
  path: string;
  st: Stat;
  /** Symlink target text, its absolute path, and its stat (null when dangling). */
  link?: { text: string; path: string; st: Stat | null };
}

export interface LsOpts {
  long: boolean;
  human: boolean;
  inode: boolean;
  numeric: boolean;
  classify: boolean;
  color: boolean;
  quote: boolean;
}

interface Cell {
  text: string;
  width: number;
}

const ARCHIVE = /\.(tar|tgz|taz|gz|bz2|xz|zst|lz|lzma|zip|7z|rar|deb|rpm|jar|war|z)$/i;
const MEDIA = /\.(jpe?g|png|gif|bmp|svg|webp|tiff?|ico|mp4|mkv|webm|avi|mov|mpe?g)$/i;
const AUDIO = /\.(mp3|flac|ogg|wav|m4a|aac|opus|mid|midi)$/i;

export function makeEntry(vfs: VFS, name: string, path: string, st: Stat): Entry {
  if (st.kind !== 'symlink') return { name, path, st };
  const text = vfs.readlink(path);
  let target = text;
  try {
    target = vfs.realpath(path);
  } catch {}
  return { name, path, st, link: { text, path: target, st: tryStat(vfs, path) } };
}

/** Ubuntu's default LS_COLORS. */
function colorOf(name: string, path: string, st: Stat | null): string {
  if (!st) return '';
  if (st.kind === 'symlink') return '01;36';
  if (st.kind === 'dir') {
    const other = st.mode & 0o002;
    const sticky = st.mode & 0o1000;
    return other && sticky ? '30;42' : other ? '34;42' : sticky ? '37;44' : '01;34';
  }
  if (DEVICES[path]) return '40;33;01';
  if (st.mode & 0o4000) return '37;41';
  if (st.mode & 0o2000) return '30;43';
  if (st.mode & 0o111) return '01;32';
  if (ARCHIVE.test(name)) return '01;31';
  if (MEDIA.test(name)) return '01;35';
  return AUDIO.test(name) ? '00;36' : '';
}

function indicator(path: string, st: Stat | null): string {
  if (!st) return '';
  if (st.kind === 'dir') return '/';
  if (st.kind === 'symlink') return '@';
  return !DEVICES[path] && st.mode & 0o111 ? '*' : '';
}

function paint(text: string, code: string, o: LsOpts): string {
  return o.color && code ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** `align` mirrors GNU: once any name is quoted, unquoted names get a leading space so they line up. */
function nameCell(e: Entry, o: LsOpts, align: boolean): Cell {
  const quoted = o.quote ? shellQuote(e.name) : e.name;
  const shown = align && quoted === e.name ? ` ${quoted}` : quoted;
  const dangling = e.link && !e.link.st;
  const code = dangling ? '40;31;01' : colorOf(e.name, e.path, e.st);
  const ind = o.classify && !(o.long && e.link) ? indicator(e.path, e.st) : '';
  let text = paint(shown, code, o) + ind;
  let width = shown.length + ind.length;
  if (o.long && e.link) {
    const { text: target, path, st } = e.link;
    const tind = o.classify ? indicator(path, st) : '';
    text += ` -> ${paint(target, colorOf(target, path, st), o)}${tind}`;
    width += 4 + target.length + tind.length;
  }
  return { text, width };
}

function longLines(entries: Entry[], o: LsOpts, vfs: VFS, align: boolean): string {
  const users = new Map<number, string>();
  const groups = new Map<number, string>();
  const owner = (id: number, map: Map<number, string>, lookup: (vfs: VFS, id: number) => string) => {
    if (o.numeric) return String(id);
    if (!map.has(id)) map.set(id, lookup(vfs, id));
    return map.get(id)!;
  };
  const rows = entries.map((e) => {
    const dev = DEVICES[e.path];
    return {
      ino: String(e.st.ino),
      mode: formatMode(e.st.kind, e.st.mode, !!dev),
      links: String(e.st.nlink),
      user: owner(e.st.uid, users, userName),
      group: owner(e.st.gid, groups, groupName),
      size: dev ? `${dev[0]}, ${dev[1]}` : o.human ? human(e.st.size) : String(e.st.size),
      date: lsDate(e.st.mtime),
      name: nameCell(e, o, align).text,
    };
  });
  const w = (key: 'ino' | 'links' | 'user' | 'group' | 'size') => Math.max(0, ...rows.map((r) => r[key].length));
  const [wi, wl, wu, wg, ws] = [w('ino'), w('links'), w('user'), w('group'), w('size')];
  return rows
    .map((r) => {
      const ino = o.inode ? `${r.ino.padStart(wi)} ` : '';
      return `${ino}${r.mode} ${r.links.padStart(wl)} ${r.user.padEnd(wu)} ${r.group.padEnd(wg)} ${r.size.padStart(ws)} ${r.date} ${r.name}\n`;
    })
    .join('');
}

function cells(entries: Entry[], o: LsOpts, align: boolean): Cell[] {
  const wi = o.inode ? Math.max(...entries.map((e) => String(e.st.ino).length)) : 0;
  return entries.map((e) => {
    const c = nameCell(e, o, align);
    if (!o.inode) return c;
    const ino = `${String(e.st.ino).padStart(wi)} `;
    return { text: ino + c.text, width: ino.length + c.width };
  });
}

/** GNU ls -C: the most columns (filled top to bottom) whose total width stays under the line width. */
function grid(items: Cell[], width: number): string {
  const n = items.length;
  let cols = Math.max(1, Math.min(n, Math.floor(width / 3)));
  let widths: number[] = [];
  for (; cols >= 1; cols--) {
    const rows = Math.ceil(n / cols);
    widths = new Array<number>(cols).fill(3);
    items.forEach((c, i) => {
      const col = Math.floor(i / rows);
      widths[col] = Math.max(widths[col], c.width + (col === cols - 1 ? 0 : 2));
    });
    if (cols === 1 || widths.reduce((a, b) => a + b, 0) < width) break;
  }
  const rows = Math.ceil(n / cols);
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let i = r, c = 0; i < n; i += rows, c++) {
      out += items[i].text;
      if (i + rows < n) out += ' '.repeat(widths[c] - items[i].width);
    }
    out += '\n';
  }
  return out;
}

/** Renders entries in long, column (width > 0), or one-per-line format. */
export function render(entries: Entry[], o: LsOpts, vfs: VFS, width: number): string {
  if (!entries.length) return '';
  const align = o.quote && (o.long || width > 0) && entries.some((e) => shellQuote(e.name) !== e.name);
  if (o.long) return longLines(entries, o, vfs, align);
  const items = cells(entries, o, align);
  return width > 0 ? grid(items, width) : items.map((c) => `${c.text}\n`).join('');
}
