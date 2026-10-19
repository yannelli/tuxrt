/** Perl's Text::Wrap at `columns`: lines hold at most columns - 1 chars and oversized words are split. */
export function wrap(text: string, columns: number): string[] {
  const max = columns - 1;
  const out: string[] = [];
  let cur = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (cur) out.push(cur);
      out.push(word.slice(0, max));
      word = word.slice(max);
      cur = '';
    }
    if (cur && cur.length + 1 + word.length > max) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  out.push(cur);
  return out;
}

export function expandTabs(line: string): string {
  let out = '';
  for (const c of line) out += c === '\t' ? ' '.repeat(8 - (out.length % 8)) : c;
  return out;
}

function edges(i: number, count: number, think: boolean): [string, string] {
  if (think) return ['(', ')'];
  if (count === 1) return ['<', '>'];
  if (i === 0) return ['/', '\\'];
  return i === count - 1 ? ['\\', '/'] : ['|', '|'];
}

export function balloon(msg: string[], think: boolean): string {
  const width = Math.max(0, ...msg.map((l) => l.length));
  const body = msg.map((l, i) => {
    const [left, right] = edges(i, msg.length, think);
    return `${left} ${l.padEnd(width)} ${right}\n`;
  });
  return ` ${'_'.repeat(width + 2)}\n${body.join('')} ${'-'.repeat(width + 2)}\n`;
}
