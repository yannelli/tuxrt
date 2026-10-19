import type { VNode } from './types.ts';

export const S_ISUID = 0o4000;
export const S_ISGID = 0o2000;
export const S_ISVTX = 0o1000;

const typeChar: Record<VNode['kind'], string> = { file: '-', dir: 'd', symlink: 'l' };

export function formatMode(kind: VNode['kind'], mode: number, isDevice = false): string {
  const rwx = (bits: number, special: boolean, specialChar: string) => {
    const x = bits & 1;
    const exec = special ? (x ? specialChar : specialChar.toUpperCase()) : x ? 'x' : '-';
    return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${exec}`;
  };
  return (
    (isDevice ? 'c' : typeChar[kind]) +
    rwx((mode >> 6) & 7, (mode & S_ISUID) !== 0, 's') +
    rwx((mode >> 3) & 7, (mode & S_ISGID) !== 0, 's') +
    rwx(mode & 7, (mode & S_ISVTX) !== 0, 't')
  );
}

/** Applies an octal ("755") or symbolic ("u+x,go-w", "a=r") chmod spec. Returns null if invalid. */
export function applyChmod(spec: string, current: number, isDir: boolean): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a';
    let bits = 0;
    for (const p of m[3]) {
      if (p === 'r') bits |= 0o444;
      if (p === 'w') bits |= 0o222;
      if (p === 'x' || (p === 'X' && (isDir || current & 0o111))) bits |= 0o111;
      if (p === 's') bits |= S_ISUID | S_ISGID;
      if (p === 't') bits |= S_ISVTX;
    }
    let mask = 0;
    if (who.includes('u') || who.includes('a')) mask |= 0o4700;
    if (who.includes('g') || who.includes('a')) mask |= 0o2070;
    if (who.includes('o') || who.includes('a')) mask |= 0o1007;
    bits &= mask;
    if (m[2] === '+') mode |= bits;
    else if (m[2] === '-') mode &= ~bits;
    else mode = (mode & ~mask) | bits;
  }
  return mode;
}
