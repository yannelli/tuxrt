import { compile } from './regex.ts';

/** Reads RS-separated records from a lazily pulled stream of chunks. */
export class RecordSource {
  private buf = '';
  private pos = 0;
  private eof = false;
  private readonly pull: () => Promise<string | null>;

  constructor(pull: () => Promise<string | null>) {
    this.pull = pull;
  }

  static ofText(text: string): RecordSource {
    let done = false;
    return new RecordSource(async () => (done ? null : ((done = true), text)));
  }

  async next(rs: string): Promise<string | null> {
    for (;;) {
      const rec = this.scan(rs);
      if (rec !== undefined) return rec;
      if (this.eof) return this.rest(rs);
      const chunk = await this.pull();
      if (chunk === null) this.eof = true;
      else {
        this.buf = this.buf.slice(this.pos) + chunk;
        this.pos = 0;
      }
    }
  }

  private take(end: number, next: number): string {
    const rec = this.buf.slice(this.pos, end);
    this.pos = next;
    return rec;
  }

  private scan(rs: string): string | undefined {
    if (rs.length === 1) {
      const i = this.buf.indexOf(rs, this.pos);
      return i < 0 ? undefined : this.take(i, i + 1);
    }
    if (rs === '') {
      while (this.buf[this.pos] === '\n') this.pos++;
      const blank = /\n\n+/g;
      blank.lastIndex = this.pos;
      const m = blank.exec(this.buf);
      return m ? this.take(m.index, m.index + m[0].length) : undefined;
    }
    const re = compile(rs, true);
    for (re.lastIndex = this.pos; ; ) {
      const m = re.exec(this.buf);
      if (!m) return undefined;
      const end = m.index + m[0].length;
      if (m[0] === '') {
        if (re.lastIndex >= this.buf.length) return undefined;
        re.lastIndex++;
        continue;
      }
      // A match touching the end of the buffer might grow once more input arrives.
      if (end === this.buf.length && !this.eof) return undefined;
      return this.take(m.index, end);
    }
  }

  private rest(rs: string): string | null {
    let rec = this.take(this.buf.length, this.buf.length);
    if (rs === '') rec = rec.replace(/\n+$/, '');
    return rec === '' ? null : rec;
  }
}

function splitOn(s: string, re: RegExp): string[] {
  const out: string[] = [];
  let pos = 0;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    out.push(s.slice(pos, m.index));
    pos = m.index + m[0].length;
  }
  out.push(s.slice(pos));
  return out;
}

export function splitRegex(s: string, ere: string): string[] {
  return s === '' ? [] : splitOn(s, compile(ere, true));
}

/** Splits like FS: " " means runs of blanks (trimmed), one other char is literal, longer is a regex. */
export function splitFields(s: string, fs: string, paragraph = false): string[] {
  if (s === '') return [];
  if (fs === ' ') {
    const t = s.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
    return t === '' ? [] : t.split(/[ \t\n]+/);
  }
  if (fs === '') return [...s];
  if (fs.length === 1) return paragraph ? s.split(fs).flatMap((p) => p.split('\n')) : s.split(fs);
  return splitOn(s, compile(paragraph ? `(${fs})|\n` : fs, true));
}
