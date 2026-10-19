export type Font = 'R' | 'B' | 'I';
export interface Run {
  text: string;
  font: Font;
}
export interface Word {
  runs: Run[];
  width: number;
  /** Ends a sentence at the end of an input line, so groff puts two spaces after it. */
  eos?: boolean;
}
export interface FontState {
  font: Font;
  prev: Font;
}

const NBSP = '\u00a0';
const GLYPHS: Record<string, string> = {
  em: '\u2014', en: '\u2013', bu: '\u2022', hy: '-', mi: '-', aq: "'", dq: '"', lq: '\u201c', rq: '\u201d',
  oq: '\u2018', cq: '\u2019', ga: '`', ti: '~', ha: '^', ba: '|', rs: '\\', sl: '/', pl: '+', eq: '=',
  co: '\u00a9', rg: '\u00ae', tm: '\u2122', mu: '\u00d7', de: '\u00b0', '>=': '\u2265', '<=': '\u2264',
  '->': '\u2192', '<-': '\u2190', Fo: '\u00ab', Fc: '\u00bb', lB: '[', rB: ']', lC: '{', rC: '}', la: '<', ra: '>',
};
const STRINGS: Record<string, string> = { lq: '\u201c', rq: '\u201d', R: '\u00ae', Tm: '\u2122', Aq: "'" };
const FONTS: Record<string, Font> = { B: 'B', '3': 'B', BI: 'B', CB: 'B', I: 'I', '2': 'I', R: 'R', '1': 'R', CR: 'R', CW: 'R' };

/** Reads an escape name at i: "x", "(xx" or "[name]". Returns [name, characters consumed]. */
function escName(s: string, i: number): [string, number] {
  if (s[i] === '(') return [s.slice(i + 1, i + 3), 3];
  if (s[i] === '[') {
    const end = s.indexOf(']', i);
    return end < 0 ? [s.slice(i + 1), s.length - i] : [s.slice(i + 1, end), end - i + 1];
  }
  return [s[i] ?? '', 1];
}

function quotedArgLength(s: string, i: number): number {
  const q = s[i];
  const end = s.indexOf(q, i + 1);
  return end < 0 ? s.length - i : end - i + 1;
}

export function setFont(st: FontState, name: string): void {
  const next = name === 'P' || name === '' ? st.prev : (FONTS[name] ?? 'R');
  st.prev = st.font;
  st.font = next;
}

/** Expands roff escapes in a text line into font runs. Breakable spaces stay as ' ', escaped ones become NBSP. */
export function expand(text: string, st: FontState): Run[] {
  const runs: Run[] = [];
  const push = (s: string) => {
    const last = runs.at(-1);
    if (last && last.font === st.font) last.text += s;
    else if (s) runs.push({ text: s, font: st.font });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\t') push(' ');
    else if (c !== '\\') push(c);
    else {
      const n = text[++i];
      if (n === 'f') {
        const [name, len] = escName(text, i + 1);
        setFont(st, name);
        i += len;
      } else if (n === '(' || n === '[') {
        const [name, len] = escName(text, i);
        push(GLYPHS[name] ?? '');
        i += len - 1;
      } else if (n === '*' || n === 'n') {
        const [name, len] = escName(text, i + 1);
        if (n === '*') push(STRINGS[name] ?? '');
        i += len;
      } else if (n === 's') {
        i += /^[+-]?(\d|\(\d\d|\[\d+\])/.exec(text.slice(i + 1))?.[0].length ?? 0;
      } else if ('hvwbloxDLNZ'.includes(n)) {
        i += quotedArgLength(text, i + 1);
      } else if (n === 'e' || n === '\\') push('\\');
      else if (n === ' ' || n === '0' || n === '~') push(NBSP);
      else if (n !== undefined && !'&|^,/)c%:"'.includes(n)) push(n);
      else if (n === '"') break;
    }
  }
  return runs;
}

/** Splits font runs into words at breakable spaces. */
export function toWords(runs: Run[]): Word[] {
  const words: Word[] = [];
  let cur: Run[] = [];
  const end = () => {
    if (cur.length) words.push({ runs: cur, width: cur.reduce((n, r) => n + r.text.length, 0) });
    cur = [];
  };
  for (const run of runs) {
    run.text.split(/ +/).forEach((part, i) => {
      if (i > 0) end();
      if (part) cur.push({ text: part, font: run.font });
    });
  }
  end();
  return words;
}

export function plain(runs: Run[]): string {
  return runs.map((r) => r.text).join('').replaceAll(NBSP, ' ');
}

export function styled(runs: Run[], tty: boolean): string {
  return runs
    .map(({ text, font }) => {
      const t = text.replaceAll(NBSP, ' ');
      return !tty || font === 'R' ? t : `\x1b[${font === 'B' ? 1 : 4}m${t}\x1b[0m`;
    })
    .join('');
}
