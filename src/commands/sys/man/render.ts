import { expand, plain, setFont, styled, toWords, type Font, type FontState, type Run, type Word } from './inline.ts';

export const MANUALS: Record<string, string> = {
  '1': 'General Commands Manual', '2': 'System Calls Manual', '3': 'Library Functions Manual', '4': 'Kernel Interfaces Manual',
  '5': 'File Formats Manual', '6': 'Games Manual', '7': 'Miscellaneous Information Manual', '8': "System Manager's Manual",
};

const IN = 7;
const ALTERNATING = new Set(['BR', 'RB', 'BI', 'IB', 'IR', 'RI']);
const SKIP_BLOCK = new Set(['de', 'de1', 'am', 'ig']);

/** man-db asks groff for 39/40 of the terminal width, leaving groff's 78 default alone at 80 columns. */
export function lineLength(columns: number): number {
  const cols = Math.max(columns, 20);
  return cols === 80 ? 78 : Math.min(Math.floor((cols * 39) / 40), cols - 2);
}

/** Splits request arguments, honoring double quotes ("" inside quotes is a literal quote). */
function requestArgs(s: string): string[] {
  const args: string[] = [];
  const re = /"((?:[^"]|"")*)"?|(\S+)/g;
  for (let m; (m = re.exec(s)); ) args.push(m[1] !== undefined ? m[1].replaceAll('""', '"') : m[2]);
  return args;
}

function indentArg(arg: string | undefined, fallback: number): number {
  const n = Number.parseFloat(arg ?? '');
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** "left   center   right" laid out like groff's .tl over the line length. */
export function titleLine(left: string, center: string, right: string, ll: number): string {
  const start = Math.ceil((ll - center.length) / 2);
  const head = left.length < start ? left.padEnd(start) + center : `${left} ${center}`;
  return head.length < ll - right.length ? head.padEnd(ll - right.length) + right : `${head} ${right}`;
}

/** A small nroff for the man macros: fills and justifies text, lays out tagged paragraphs and indents. */
class Formatter {
  readonly out: string[] = [];
  th = { title: '', section: '', date: '', source: '', manual: '' };
  private readonly ll: number;
  private readonly tty: boolean;
  private margin = IN;
  private indent = IN;
  private pi = IN;
  private stack: { margin: number; pi: number }[] = [];
  private fill = true;
  private adjust = true;
  private noSpace = true;
  private reverse = false;
  private pending: Word[] = [];
  private tag: { words: Word[]; at: number } | null = null;
  private tagNext = false;
  private headingNext: 'SH' | 'SS' | null = null;
  private nextFont: Font | null = null;
  private skipping = false;
  private readonly font: FontState = { font: 'R', prev: 'R' };

  constructor(ll: number, tty: boolean) {
    this.ll = ll;
    this.tty = tty;
  }

  line(src: string): void {
    if (this.skipping) {
      this.skipping = !/^\.\.\s*$/.test(src);
      return;
    }
    const req = /^[.']\s*([^\s\\]*)\s*(.*)$/.exec(src);
    if (!req) return this.text(src);
    if (src.startsWith('.\\"') || src.startsWith('\'\\"') || src.startsWith('.\\#')) return;
    this.request(req[1], requestArgs(req[2]), req[2]);
  }

  private request(name: string, args: string[], rest: string): void {
    if (name === 'TH') {
      const [title = '', section = '', date = '', source = '', manual = MANUALS[section[0]] ?? ''] = args;
      this.th = { title, section, date, source, manual };
    } else if (name === 'SH' || name === 'SS') {
      this.flush();
      Object.assign(this, { margin: IN, indent: IN, pi: IN, stack: [], tagNext: false });
      if (args.length) this.heading(name, rest);
      else this.headingNext = name;
    } else if (name === 'PP' || name === 'LP' || name === 'P' || name === 'HP') this.paragraph(IN);
    else if (name === 'TP') {
      this.paragraph(indentArg(args[0], this.pi));
      this.tagNext = true;
    } else if (name === 'IP') {
      this.paragraph(indentArg(args[1], this.pi));
      this.indent = this.margin + this.pi;
      if (args[0]) this.tag = { words: this.words(args[0]), at: this.margin };
    } else if (name === 'RS') {
      this.flush();
      this.stack.push({ margin: this.margin, pi: this.pi });
      this.margin = this.indent = this.margin + indentArg(args[0], this.pi);
      this.pi = IN;
    } else if (name === 'RE') {
      this.flush();
      const top = this.stack.pop();
      if (top) Object.assign(this, { margin: top.margin, indent: top.margin, pi: top.pi });
    } else if (name === 'B' || name === 'I' || name === 'SB') {
      const font = name === 'I' ? 'I' : 'B';
      if (!args.length) this.nextFont = font;
      else this.addWords(this.words(`\\f${font}${args.join(' ')}\\fR`));
    } else if (name === 'SM') {
      if (args.length) this.addWords(this.words(args.join(' ')));
    } else if (ALTERNATING.has(name)) {
      this.addWords(this.words(args.map((a, i) => `\\f${name[i % 2]}${a}`).join('') + '\\fR'));
    } else if (name === 'nf' || name === 'EX') {
      this.flush();
      this.fill = false;
    } else if (name === 'fi' || name === 'EE') {
      this.flush();
      this.fill = true;
    } else if (name === 'br') this.flush();
    else if (name === 'sp') {
      this.flush();
      for (let i = 0; i < Math.max(1, indentArg(args[0], 1)); i++) this.space();
    } else if (name === 'ad') this.adjust = args[0] !== 'l';
    else if (name === 'na') this.adjust = false;
    else if (name === 'ft') setFont(this.font, args[0] ?? 'P');
    else if (SKIP_BLOCK.has(name)) this.skipping = true;
  }

  private heading(kind: 'SH' | 'SS', text: string): void {
    this.space();
    const title = plain(expand(requestArgs(text).join(' '), { font: 'B', prev: 'R' }));
    this.emit(' '.repeat(kind === 'SH' ? 0 : 3) + styled([{ text: title, font: 'B' }], this.tty));
    this.noSpace = true;
  }

  private paragraph(pi: number): void {
    this.flush();
    this.space();
    this.pi = pi;
    this.indent = this.margin;
  }

  private text(src: string): void {
    if (this.headingNext) {
      const kind = this.headingNext;
      this.headingNext = null;
      return this.heading(kind, src);
    }
    if (this.tagNext) return this.addWords(this.words(src));
    if (!this.fill) {
      this.flush();
      return this.emit(' '.repeat(this.indent) + styled(this.runs(expandTabs(src)), this.tty));
    }
    if (src.trim() === '') {
      this.flush();
      return this.space();
    }
    if (src.startsWith(' ')) this.flush();
    this.addWords(this.words(src));
  }

  private runs(src: string): Run[] {
    const font = this.nextFont;
    this.nextFont = null;
    if (font) setFont(this.font, font);
    const runs = expand(src, this.font);
    if (font) setFont(this.font, 'R');
    return runs;
  }

  private words(src: string): Word[] {
    const words = toWords(this.runs(src));
    const last = words.at(-1);
    if (last && /[.?!]["')\]*]*$/.test(plain(last.runs))) last.eos = true;
    return words;
  }

  private addWords(words: Word[]): void {
    if (this.tagNext) {
      this.tag = { words, at: this.margin };
      this.tagNext = false;
      this.indent = this.margin + this.pi;
    } else if (!this.fill) this.emit(' '.repeat(this.indent) + words.map((w) => styled(w.runs, this.tty)).join(' '));
    else this.pending.push(...words);
  }

  private space(): void {
    if (!this.noSpace) this.out.push('');
  }

  private emit(line: string): void {
    this.out.push(line.trimEnd());
    this.noSpace = false;
  }

  flush(): void {
    const words = this.pending;
    this.pending = [];
    let prefix = ' '.repeat(this.indent);
    if (this.tag) {
      const { words: tagWords, at } = this.tag;
      this.tag = null;
      const width = tagWords.reduce((n, w) => n + w.width, 0) + Math.max(0, tagWords.length - 1);
      if (width < this.indent - at) {
        prefix = ' '.repeat(at) + this.justify(tagWords, 0) + ' '.repeat(this.indent - at - width);
        if (!words.length) this.emit(prefix);
      } else this.fillLines(tagWords, ' '.repeat(at), at);
    }
    this.fillLines(words, prefix, this.indent);
  }

  /** Greedy fill: every line but the last is justified to the line length. */
  private fillLines(words: Word[], prefix: string, indent: number): void {
    const cap = this.ll - indent;
    let line: Word[] = [];
    let used = 0;
    for (const word of words) {
      const gap = line.length ? (line.at(-1)!.eos ? 2 : 1) : 0;
      if (line.length && used + gap + word.width > cap) {
        this.emit(prefix + this.justify(line, cap - used));
        prefix = ' '.repeat(indent);
        line = [];
        used = 0;
      }
      used += (line.length ? gap : 0) + word.width;
      line.push(word);
    }
    if (line.length) this.emit(prefix + this.justify(line, 0));
  }

  /** Joins a line's words, spreading `extra` spaces over the gaps from alternating ends like groff. */
  private justify(line: Word[], extra: number): string {
    const gaps = line.slice(0, -1).map((w) => (w.eos ? 2 : 1));
    if (this.adjust && extra > 0 && gaps.length) {
      const each = Math.floor(extra / gaps.length);
      const rest = extra % gaps.length;
      this.reverse = !this.reverse;
      gaps.forEach((_, i) => (gaps[i] += each + ((this.reverse ? gaps.length - 1 - i : i) < rest ? 1 : 0)));
    }
    return line.map((w, i) => styled(w.runs, this.tty) + ' '.repeat(gaps[i] ?? 0)).join('');
  }
}

function expandTabs(s: string): string {
  let out = '';
  for (const c of s) out += c === '\t' ? ' '.repeat(8 - (out.length % 8)) : c;
  return out;
}

/** Formats roff man source for a terminal of `columns` width; styles only when `tty`. */
export function render(src: string, columns: number, tty: boolean): string {
  const ll = lineLength(columns);
  const f = new Formatter(ll, tty);
  for (const line of src.split('\n')) f.line(line);
  f.flush();
  while (f.out.at(-1) === '') f.out.pop();
  const { title, section, date, source, manual } = f.th;
  const ref = title ? `${title}(${section})` : '';
  return [titleLine(ref, manual, ref, ll), '', ...f.out, '', titleLine(source, date, ref, ll), ''].join('\n');
}
