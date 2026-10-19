import type { Writer } from '../../../shell/io.ts';
import type { LineSource } from '../stream.ts';
import type { GrepOpts } from './options.ts';

/** State shared across files: whether anything was printed (for "--" separators) and early exit. */
export interface GrepState {
  printed: boolean;
  done: boolean;
}

export interface SearchResult {
  selected: number;
  binaryMatch: boolean;
}

const sgr = (on: boolean, code: string, s: string) => (on ? `\x1b[${code}m\x1b[K${s}\x1b[m\x1b[K` : s);

/** Leftmost-longest non-empty matches across all patterns. */
export function findAll(line: string, finders: RegExp[]): [number, number][] {
  const out: [number, number][] = [];
  for (let pos = 0; pos <= line.length; ) {
    let best: [number, number] | null = null;
    for (const re of finders) {
      re.lastIndex = pos;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (m[0] !== '') {
          if (!best || m.index < best[0] || (m.index === best[0] && m.index + m[0].length > best[1])) best = [m.index, m.index + m[0].length];
          break;
        }
        re.lastIndex = m.index + 1;
      }
    }
    if (!best) break;
    out.push(best);
    pos = best[1];
  }
  return out;
}

export async function search(src: LineSource, name: string, showName: boolean, binary: boolean, o: GrepOpts, out: Writer, state: GrepState): Promise<SearchResult> {
  const c = o.color;
  const sep = (ch: string) => sgr(c, '36', ch);
  const prefix = (n: number, offset: number, ch: string) =>
    (showName ? sgr(c, '35', name) + (o.nul ? '\0' : sep(ch)) : '') +
    (o.lineNumber ? sgr(c, '32', String(n)) + sep(ch) : '') +
    (o.byteOffset ? sgr(c, '32', String(offset)) + sep(ch) : '');
  const listing = o.count || o.filesWith || o.filesWithout || o.quiet;
  const printing = !listing && !binary;
  const contextual = printing && !o.only && (o.before > 0 || o.after > 0);
  const before: [number, number, string][] = [];
  let lastPrinted = 0;
  let after = 0;
  let selected = 0;
  let offset = 0;
  const emitLine = (n: number, off: number, line: string, ch: string) => {
    if (contextual && state.printed && (lastPrinted === 0 || n > lastPrinted + 1)) out.write(`${sep('--')}\n`);
    state.printed = true;
    lastPrinted = n;
    if (ch === '-' || o.invert || !c) return out.write(`${prefix(n, off, ch)}${line}\n`);
    let body = '';
    let pos = 0;
    for (const [s, e] of findAll(line, o.finders)) {
      body += line.slice(pos, s) + sgr(true, '01;31', line.slice(s, e));
      pos = e;
    }
    out.write(`${prefix(n, off, ch)}${body}${line.slice(pos)}\n`);
  };
  if (o.max === 0) return { selected: 0, binaryMatch: false };
  for (let n = 1; ; n++) {
    const raw = await src.next();
    if (raw === null) break;
    const line = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    const off = offset;
    offset += Buffer.byteLength(raw);
    const hit = o.tests.some((re) => re.test(line)) !== o.invert;
    if (selected >= o.max) {
      if (after > 0 && !hit) {
        emitLine(n, off, line, '-');
        after--;
        continue;
      }
      break;
    }
    if (hit) {
      selected++;
      if (o.quiet) {
        state.done = true;
        break;
      }
      if (o.filesWith || o.filesWithout) break;
      if (!printing) continue;
      if (o.only) {
        if (!o.invert) for (const [s, e] of findAll(line, o.finders)) out.write(`${prefix(n, off + Buffer.byteLength(line.slice(0, s)), ':')}${sgr(c, '01;31', line.slice(s, e))}\n`);
        continue;
      }
      for (const [bn, boff, bl] of before.splice(0)) emitLine(bn, boff, bl, '-');
      emitLine(n, off, line, ':');
      after = o.after;
    } else if (contextual && after > 0) {
      emitLine(n, off, line, '-');
      after--;
    } else if (contextual && o.before > 0) {
      before.push([n, off, line]);
      if (before.length > o.before) before.shift();
    }
  }
  if (o.count) out.write(`${showName ? sgr(c, '35', name) + (o.nul ? '\0' : sep(':')) : ''}${selected}\n`);
  if ((o.filesWith && selected) || (o.filesWithout && !selected)) out.write(`${sgr(c, '35', name)}${o.nul ? '\0' : '\n'}`);
  return { selected, binaryMatch: binary && selected > 0 && !listing };
}
