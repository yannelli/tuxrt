/** GNU sort key extraction and comparison (C locale). */
export interface Key {
  sword: number;
  schar: number;
  eword: number;
  echar: number;
  sblank: boolean;
  eblank: boolean;
  opts: string;
}

const blank = (c: string | undefined) => c === ' ' || c === '\t';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ORDERING = /[dfghiMnRV]/;

export function parseKey(spec: string, global: string): Key | string {
  const m = /^(\d+)(?:\.(\d+))?([bdfghiMnRrV]*)(?:,(\d+)(?:\.(\d+))?([bdfghiMnRrV]*))?$/.exec(spec);
  if (!m) return `invalid field specification '${spec}'`;
  if (Number(m[1]) === 0 || m[4] === '0') return `field number is zero: invalid field specification '${spec}'`;
  if (m[2] !== undefined && Number(m[2]) === 0) return `character offset is zero: invalid field specification '${spec}'`;
  const own = (m[3] ?? '') + (m[6] ?? '');
  const inherit = own === '';
  return {
    sword: Number(m[1]) - 1,
    schar: m[2] ? Number(m[2]) - 1 : 0,
    eword: m[4] === undefined ? Infinity : Number(m[4]) - 1,
    echar: m[5] ? Number(m[5]) : 0,
    sblank: inherit ? global.includes('b') : m[3].includes('b'),
    eblank: inherit ? global.includes('b') : (m[6] ?? '').includes('b'),
    opts: inherit ? global : own,
  };
}

export function wholeLineKey(global: string): Key | null {
  if (!ORDERING.test(global) && !global.includes('b')) return null;
  return { sword: 0, schar: 0, eword: Infinity, echar: 0, sblank: global.includes('b'), eblank: false, opts: global };
}

function skipFields(s: string, n: number, tab: string | undefined, keepSep: boolean): number {
  let p = 0;
  while (p < s.length && n-- > 0) {
    if (tab !== undefined) {
      while (p < s.length && s[p] !== tab) p++;
      if (p < s.length && (n > 0 || keepSep)) p++;
    } else {
      while (p < s.length && blank(s[p])) p++;
      while (p < s.length && !blank(s[p])) p++;
    }
  }
  return p;
}

/** Ports begfield/limfield from GNU sort. */
export function keyText(line: string, k: Key, tab: string | undefined): string {
  let beg = skipFields(line, k.sword, tab, true);
  if (k.sblank) while (beg < line.length && blank(line[beg])) beg++;
  beg = Math.min(line.length, beg + k.schar);
  let lim = line.length;
  if (k.eword !== Infinity) {
    lim = skipFields(line, k.echar === 0 ? k.eword + 1 : k.eword, tab, k.echar !== 0);
    if (k.echar !== 0) {
      if (k.eblank) while (lim < line.length && blank(line[lim])) lim++;
      lim = Math.min(line.length, lim + k.echar);
    }
  }
  return lim > beg ? line.slice(beg, lim) : '';
}

function num(s: string): number {
  const m = /^\s*(-?\d*(?:\.\d*)?)/.exec(s);
  const n = Number(m?.[1] ?? '');
  return m?.[1] && !Number.isNaN(n) ? n : 0;
}

function human(s: string): [number, number] {
  const m = /^\s*(-?)(\d*(?:\.\d*)?)([KMGTPEZYRQk]?)/.exec(s);
  const n = Number(m?.[2] || 0) || 0;
  const sign = m?.[1] ? -1 : 1;
  const suffix = (m?.[3] ?? '').toUpperCase();
  const unit = suffix ? 'KMGTPEZYRQ'.indexOf(suffix) + 1 : 0;
  return [sign * (n === 0 ? 0 : unit + 1), sign * n];
}

function general(s: string): number {
  const n = parseFloat(s.trim());
  return Number.isNaN(n) ? -Infinity : n;
}

function month(s: string): number {
  return MONTHS.indexOf(s.trimStart().slice(0, 3).toUpperCase()) + 1;
}

function order(s: string, i: number): number {
  const c = s[i];
  if (c === undefined || /\d/.test(c)) return 0;
  if (/[a-zA-Z]/.test(c)) return c.charCodeAt(0);
  return c === '~' ? -1 : c.charCodeAt(0) + 256;
}

/** Debian-style version comparison used by `sort -V` and `ls -v`. */
export function versionCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  while (i < a.length || j < b.length) {
    while ((i < a.length && !digit(a[i])) || (j < b.length && !digit(b[j]))) {
      const d = order(a, i) - order(b, j);
      if (d) return d;
      i++;
      j++;
    }
    while (a[i] === '0') i++;
    while (b[j] === '0') j++;
    let first = 0;
    while (digit(a[i]) && digit(b[j])) {
      first ||= a.charCodeAt(i++) - b.charCodeAt(j++);
    }
    if (digit(a[i])) return 1;
    if (digit(b[j])) return -1;
    if (first) return first;
  }
  return 0;
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hash(s: string, salt: number): number {
  let h = salt ^ 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const salt = (Math.random() * 2 ** 32) >>> 0;

export function compareKey(a: string, b: string, opts: string): number {
  let d: number;
  if (opts.includes('n')) d = num(a) - num(b);
  else if (opts.includes('h')) {
    const [x, y] = [human(a), human(b)];
    d = x[0] - y[0] || x[1] - y[1];
  } else if (opts.includes('g')) {
    const [x, y] = [general(a), general(b)];
    d = x === y ? 0 : x < y ? -1 : 1;
  } else if (opts.includes('M')) d = month(a) - month(b);
  else if (opts.includes('V')) d = versionCompare(a, b) || cmpStr(a, b);
  else if (opts.includes('R')) d = hash(a, salt) - hash(b, salt);
  else {
    if (opts.includes('d')) [a, b] = [a.replace(/[^ \t0-9A-Za-z]/g, ''), b.replace(/[^ \t0-9A-Za-z]/g, '')];
    if (opts.includes('i')) [a, b] = [a.replace(/[^\x20-\x7e]/g, ''), b.replace(/[^\x20-\x7e]/g, '')];
    if (opts.includes('f')) [a, b] = [a.toUpperCase(), b.toUpperCase()];
    d = cmpStr(a, b);
  }
  return opts.includes('r') ? -Math.sign(d) : Math.sign(d);
}
