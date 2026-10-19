export type Repl = string | { group: number } | { caseOp: 'U' | 'L' | 'u' | 'l' | 'E' };

/** Parses an s/// replacement: & and \0-\9 groups, \n \t, and GNU \U \L \u \l \E case operators. */
export function parseRepl(s: string): Repl[] {
  const out: Repl[] = [];
  let lit = '';
  const flush = () => {
    if (lit) out.push(lit);
    lit = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      flush();
      out.push({ group: 0 });
    } else if (c === '\\' && i + 1 < s.length) {
      const n = s[++i];
      if (/\d/.test(n)) {
        flush();
        out.push({ group: Number(n) });
      } else if ('ULulE'.includes(n)) {
        flush();
        out.push({ caseOp: n as 'U' });
      } else lit += n === 'n' ? '\n' : n === 't' ? '\t' : n;
    } else lit += c;
  }
  flush();
  return out;
}

export function expandRepl(parts: Repl[], m: RegExpExecArray): string {
  let out = '';
  let mode: 'U' | 'L' | '' = '';
  let once: 'u' | 'l' | '' = '';
  for (const p of parts) {
    if (typeof p !== 'string' && 'caseOp' in p) {
      if (p.caseOp === 'u' || p.caseOp === 'l') once = p.caseOp;
      else mode = p.caseOp === 'E' ? '' : p.caseOp;
      continue;
    }
    let s = typeof p === 'string' ? p : m[p.group] ?? '';
    if (mode) s = mode === 'U' ? s.toUpperCase() : s.toLowerCase();
    if (once && s) {
      s = (once === 'u' ? s[0].toUpperCase() : s[0].toLowerCase()) + s.slice(1);
      once = '';
    }
    out += s;
  }
  return out;
}
