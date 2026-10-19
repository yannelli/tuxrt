/** Bash brace expansion: a{b,c}d -> abd acd, {1..5}, {a..e}, {01..10..2}. Quoted braces are left alone. */
export function expandBraces(word: string): string[] {
  const span = findBrace(word);
  if (!span) return [word];
  const [open, close, commas] = span;
  const pre = word.slice(0, open);
  const post = word.slice(close + 1);
  const inner = word.slice(open + 1, close);
  let alternatives: string[] | null = null;
  if (commas.length) {
    const cuts = [open, ...commas, close];
    alternatives = cuts.slice(1).map((c, i) => word.slice(cuts[i] + 1, c));
  } else alternatives = sequence(inner);
  if (!alternatives) {
    return expandBraces(post).map((p) => `${pre}{${inner}}${p}`);
  }
  return alternatives.flatMap((alt) => expandBraces(pre + alt + post));
}

function findBrace(word: string): [number, number, number[]] | null {
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '\\') i++;
    else if (c === "'") i = word.indexOf("'", i + 1);
    else if (c === '"') i = skipDouble(word, i);
    else if (c === '$' && word[i + 1] === '{') i = matchClose(word, i + 1) ?? word.length;
    else if (c === '{') {
      const close = matchClose(word, i);
      if (close === null) return null;
      const commas = topLevelCommas(word, i, close);
      if (commas.length || /^(-?\d+\.\.-?\d+(\.\.-?\d+)?|[a-zA-Z]\.\.[a-zA-Z])$/.test(word.slice(i + 1, close))) {
        return [i, close, commas];
      }
    }
    if (i === -1) return null;
  }
  return null;
}

function skipDouble(word: string, i: number): number {
  for (i++; i < word.length && word[i] !== '"'; i++) if (word[i] === '\\') i++;
  return i;
}

function matchClose(word: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < word.length; i++) {
    if (word[i] === '\\') i++;
    else if (word[i] === "'") i = word.indexOf("'", i + 1);
    else if (word[i] === '"') i = skipDouble(word, i);
    else if (word[i] === '{') depth++;
    else if (word[i] === '}' && --depth === 0) return i;
    if (i === -1) return null;
  }
  return null;
}

function topLevelCommas(word: string, open: number, close: number): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    if (word[i] === '\\') i++;
    else if (word[i] === "'") i = word.indexOf("'", i + 1);
    else if (word[i] === '"') i = skipDouble(word, i);
    else if (word[i] === '{') depth++;
    else if (word[i] === '}') depth--;
    else if (word[i] === ',' && depth === 0) out.push(i);
  }
  return out;
}

function sequence(inner: string): string[] | null {
  const parts = inner.split('..');
  if (parts.length < 2 || parts.length > 3) return null;
  const [a, b] = parts;
  const step = Math.abs(Number(parts[2] ?? 1)) || 1;
  if (/^[a-zA-Z]$/.test(a) && /^[a-zA-Z]$/.test(b)) {
    return range(a.charCodeAt(0), b.charCodeAt(0), step).map((n) => String.fromCharCode(n));
  }
  const width = /^-?0\d/.test(a) || /^-?0\d/.test(b) ? Math.max(a.length, b.length) : 0;
  return range(Number(a), Number(b), step).map((n) => (n < 0 ? `-${String(-n).padStart(width - 1, '0')}` : String(n).padStart(width, '0')));
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  if (from <= to) for (let n = from; n <= to; n += step) out.push(n);
  else for (let n = from; n >= to; n -= step) out.push(n);
  return out;
}
