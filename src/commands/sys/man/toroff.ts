import type { Item, Page } from './types.ts';

const DEFAULT_MANUAL: Record<string, string> = {
  '1': 'User Commands', '5': 'File Formats Manual', '6': 'Games Manual', '7': 'Miscellaneous Information Manual', '8': 'System Administration',
};
const TOKEN = /(-{1,2}[^\s[\]|{}=,<>]+)|([\w~/.][\w.~/:-]*)/g;
const REF = /^([\w.+:-]+)\((\w+)\)$/;

const escape = (s: string) => s.replace(/\\/g, '\\e');
const textLine = (s: string) => (/^[.']/.test(s) ? `\\&${s}` : s);
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** Bolds flags and underlines metavariables; with `boldFirst` the leading word (command name) is bold too. */
export function styleTag(s: string, boldFirst: boolean): string {
  let out = '';
  let rest = s;
  if (boldFirst) {
    const first = /^\s*\S+/.exec(s)![0];
    out = `\\fB${escape(first)}\\fR`;
    rest = s.slice(first.length);
  }
  let last = 0;
  for (const m of rest.matchAll(TOKEN)) {
    out += escape(rest.slice(last, m.index));
    const word = escape(m[0]);
    out += m[1] ? `\\fB${word}\\fR` : /[A-Za-z]/.test(word) ? `\\fI${word}\\fR` : word;
    last = m.index + m[0].length;
  }
  return out + escape(rest.slice(last));
}

const paragraphText = (s: string) => s.split('\n').map((l) => textLine(escape(l))).join('\n.br\n');

function item(it: Item, tagged: (tag: string) => string): string[] {
  if (typeof it === 'string') return ['.PP', paragraphText(it)];
  if ('code' in it) return ['.PP', '.RS 4', '.nf', ...it.code.split('\n').map((l) => textLine(escape(l))), '.fi', '.RE'];
  const [first, ...more] = it[1].split('\n\n');
  return ['.TP', textLine(tagged(it[0])), paragraphText(first), ...more.flatMap((p) => ['.IP', paragraphText(p)])];
}

function section(title: string, items: Item[], tagged: (tag: string) => string): string[] {
  return items.length ? [`.SH ${quote(title)}`, ...items.flatMap((it) => item(it, tagged))] : [];
}

/** Converts a structured page into the roff source man would read from /usr/share/man. */
export function toRoff(page: Page): string {
  const { name, section: sec, footer } = page;
  const synopsis = page.synopsis.map((s) => styleTag(s, true));
  const asSynopsis = (t: string) => styleTag(t, true);
  const refs = (page.seeAlso ?? []).filter((r) => REF.test(r));
  const notes = (page.seeAlso ?? []).filter((r) => !REF.test(r));
  const lines = [
    `.TH ${name.toUpperCase()} ${sec} ${quote(footer[1])} ${quote(footer[0])} ${quote(page.manual ?? DEFAULT_MANUAL[sec] ?? '')}`,
    '.SH NAME',
    textLine(`${[name, ...(page.aliases ?? [])].map(escape).join(', ')} \\- ${escape(page.summary)}`),
    ...(synopsis.length ? ['.SH SYNOPSIS', synopsis.join('\n.br\n')] : []),
    ...section('DESCRIPTION', page.description, asSynopsis),
  ];
  if (page.options?.length) lines.push(...section('OPTIONS', page.options, (t) => styleTag(t, false)));
  for (const [title, items] of page.sections ?? []) lines.push(...section(title, items, asSynopsis));
  if (page.examples?.length) {
    lines.push('.SH EXAMPLES', ...page.examples.flatMap(([cmd, text]) => ['.TP', `\\fB${escape(cmd)}\\fR`, paragraphText(text)]));
  }
  if (refs.length || notes.length) {
    const joined = refs.map((r) => r.replace(REF, (_, n: string, s: string) => `\\fB${escape(n)}\\fR(${s})`)).join(', ');
    lines.push('.SH "SEE ALSO"', ...(joined ? [joined] : []), ...notes.flatMap((n) => ['.PP', paragraphText(n)]));
  }
  return `${lines.join('\n')}\n`;
}
