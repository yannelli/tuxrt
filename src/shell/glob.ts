import type { VFS } from '../vfs/vfs.ts';

const CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z',
  space: '\\s', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9a-fA-F', blank: ' \\t',
};

/** Converts a shell glob (backslash escapes literals) to a regex body. */
export function globSource(pattern: string): string {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) re += escapeRe(pattern[++i]);
    else if (c === '*') re += '[\\s\\S]*';
    else if (c === '?') re += '[\\s\\S]';
    else if (c === '[') {
      const end = classEnd(pattern, i);
      if (end === -1) re += '\\[';
      else {
        let body = pattern.slice(i + 1, end);
        const negate = body[0] === '!' || body[0] === '^';
        if (negate) body = body.slice(1);
        body = body.replace(/\[:(\w+):\]/g, (_, n: string) => CLASSES[n] ?? '').replace(/\\(?!.)|[\]^]/g, '\\$&');
        re += `[${negate ? '^' : ''}${body}]`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  return re;
}

function classEnd(p: string, start: number): number {
  let i = start + 1;
  if (p[i] === '!' || p[i] === '^') i++;
  if (p[i] === ']') i++;
  for (; i < p.length; i++) {
    if (p[i] === '[' && p[i + 1] === ':') {
      const close = p.indexOf(':]', i + 2);
      if (close !== -1) i = close + 1;
    } else if (p[i] === ']') return i;
  }
  return -1;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function globToRegExp(pattern: string, flags = ''): RegExp {
  return new RegExp(`^${globSource(pattern)}$`, flags);
}

export function hasGlob(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') i++;
    else if (pattern[i] === '*' || pattern[i] === '?') return true;
    else if (pattern[i] === '[' && classEnd(pattern, i) !== -1) return true;
  }
  return false;
}

export function unescapeGlob(pattern: string): string {
  return pattern.replace(/\\([\s\S])/g, '$1');
}

/** Expands a glob against the VFS. Returns [] when nothing matches. */
export function expandGlob(pattern: string, vfs: VFS, cwd: string): string[] {
  const absolute = pattern.startsWith('/');
  const segments = pattern.split('/').filter((s, i) => s !== '' || i === 0);
  let matches: string[] = [absolute ? '/' : ''];
  for (const seg of segments.slice(absolute ? 1 : 0)) {
    const next: string[] = [];
    for (const base of matches) {
      const dir = base === '' ? cwd : base.startsWith('/') ? base : `${cwd}/${base}`;
      if (!hasGlob(seg)) {
        const candidate = joinGlob(base, unescapeGlob(seg));
        if (vfs.tryLookup(candidate.startsWith('/') ? candidate : `${cwd}/${candidate}`, true)) next.push(candidate);
        continue;
      }
      let entries: string[];
      try {
        entries = vfs.readdir(dir);
      } catch {
        continue;
      }
      const re = globToRegExp(seg);
      const showHidden = seg.startsWith('.') || seg.startsWith('\\.');
      for (const e of entries) if ((showHidden || !e.startsWith('.')) && re.test(e)) next.push(joinGlob(base, e));
    }
    matches = next;
    if (!matches.length) return [];
  }
  return pattern.endsWith('/') ? matches.filter((m) => vfs.isDir(m.startsWith('/') ? m : `${cwd}/${m}`)).map((m) => `${m}/`) : matches;
}

function joinGlob(base: string, name: string): string {
  if (base === '') return name;
  return base.endsWith('/') ? base + name : `${base}/${name}`;
}
