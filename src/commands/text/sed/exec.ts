import type { Ctx } from '../../types.ts';
import { abs } from '../../util.ts';
import { toBytes } from '../stream.ts';
import { SedError, type Addr, type Cmd } from './parse.ts';
import { expandRepl } from './repl.ts';
import type { SedInput } from './input.ts';

type Outcome = 'end' | 'delete' | 'restart' | 'silent';

const L_ESC: Record<string, string> = { '\\': '\\\\', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v' };

/** The `l` command: escape, wrap at `width` with "\", end with "$". */
function listing(s: string, width: number): string {
  const tokens: string[] = [];
  for (const ch of s) {
    if (L_ESC[ch]) tokens.push(L_ESC[ch]);
    else if (ch >= ' ' && ch <= '~') tokens.push(ch);
    else for (const b of toBytes(ch)) tokens.push(`\\${b.toString(8).padStart(3, '0')}`);
  }
  let out = '';
  let col = 0;
  for (const t of tokens) {
    if (width > 1 && col + t.length > width - 1) {
      out += '\\\n';
      col = 0;
    }
    out += t;
    col += t.length;
  }
  return `${out}$\n`;
}

/** Executes a parsed sed program over one input stream (all files, or one file with -s/-i). */
export class SedRun {
  ps = '';
  hs = '';
  line = 0;
  quit: number | null = null;
  lastRe: RegExp | null = null;
  input!: SedInput;
  out: (s: string) => void = () => {};
  private readonly prog: Cmd[];
  private readonly ctx: Ctx;
  private readonly quiet: boolean;
  private readonly width: number;
  private appendQ: string[] = [];
  private tflag = false;
  private noEol = false;
  private pendingNL = false;
  private readonly globals = new Map<RegExp, RegExp>();
  private readonly rfiles = new Map<string, string[]>();

  constructor(prog: Cmd[], ctx: Ctx, quiet: boolean, width: number) {
    this.prog = prog;
    this.ctx = ctx;
    this.quiet = quiet;
    this.width = width;
  }

  /** Processes the current input until EOF or q/Q. */
  async run(): Promise<void> {
    this.line = 0;
    this.pendingNL = false;
    for (const c of this.prog) c.active = c.a1?.type === 'zero';
    while (this.quit === null) {
      const raw = await this.input.next();
      if (raw === null) break;
      this.load(raw);
      this.tflag = false;
      let outcome: Outcome;
      while ((outcome = await this.cycle()) === 'restart') this.flushAppends();
      if (outcome === 'silent') break;
      if (outcome === 'end' && !this.quiet) this.printPS();
      this.flushAppends();
    }
  }

  private load(raw: string): void {
    this.noEol = !raw.endsWith('\n');
    this.ps = this.noEol ? raw : raw.slice(0, -1);
    this.line++;
  }

  private emit(s: string): void {
    if (this.pendingNL) this.out('\n');
    this.pendingNL = false;
    this.out(s);
  }

  private printPS(): void {
    this.emit(this.noEol ? this.ps : `${this.ps}\n`);
    if (this.noEol) this.pendingNL = true;
  }

  private flushAppends(): void {
    for (const a of this.appendQ.splice(0)) this.emit(a);
  }

  private write(file: string, data: string): void {
    if (file === '/dev/stdout') this.emit(data);
    else if (file === '/dev/stderr') this.ctx.stderr.write(data);
    else this.ctx.vfs.writeFile(abs(this.ctx, file), data, true);
  }

  private test(re: RegExp | null | undefined): boolean {
    const r = re ?? this.lastRe;
    if (!r) throw new SedError('no previous regular expression');
    this.lastRe = r;
    return r.test(this.ps);
  }

  private async match(a: Addr): Promise<boolean> {
    switch (a.type) {
      case 'line': return this.line === a.n;
      case 'last': return this.input.isLast();
      case 're': return this.test(a.re);
      case 'step': return a.step <= 0 ? this.line === a.first : this.line >= a.first && (this.line - a.first) % a.step === 0;
      default: return false;
    }
  }

  private async selected(c: Cmd): Promise<boolean> {
    if (!c.a1) return !c.neg;
    if (!c.a2) return (await this.match(c.a1)) !== c.neg;
    const a2 = c.a2;
    if (c.active) {
      let done: boolean;
      if (a2.type === 'line') done = this.line >= a2.n;
      else if (a2.type === 'plus' || a2.type === 'mult') done = this.line >= c.rangeEnd!;
      else if (a2.type === 'last') done = await this.input.isLast();
      else done = a2.type === 're' && this.test(a2.re);
      if (done) c.active = false;
      return !c.neg;
    }
    if (!(await this.match(c.a1))) return c.neg;
    if (a2.type === 'line') c.active = a2.n > this.line;
    else if (a2.type === 'plus' || a2.type === 'mult') {
      c.rangeEnd = a2.type === 'plus' ? this.line + a2.n : a2.n > 0 ? Math.ceil(this.line / a2.n) * a2.n : this.line;
      c.active = c.rangeEnd > this.line;
    } else if (a2.type === 'last') c.active = !(await this.input.isLast());
    else c.active = true;
    return !c.neg;
  }

  private subst(c: Cmd): boolean {
    this.test(c.re);
    const base = this.lastRe!;
    let re = this.globals.get(base);
    if (!re) this.globals.set(base, (re = new RegExp(base.source, `${base.flags}g`)));
    const ps = this.ps;
    const nth = c.nth ?? 1;
    let out = '';
    let pos = 0;
    let count = 0;
    let prevEnd = -1;
    let did = false;
    while (pos <= ps.length) {
      re.lastIndex = pos;
      const m = re.exec(ps);
      if (!m) break;
      const s = m.index;
      const e = s + m[0].length;
      out += ps.slice(pos, s);
      if (e === s && s === prevEnd) {
        out += ps.slice(s, s + 1);
        pos = s + 1;
        continue;
      }
      if (++count >= nth) {
        out += expandRepl(c.repl!, m);
        did = true;
      } else out += m[0];
      prevEnd = e;
      if (e === s) out += ps.slice(s, s + 1);
      pos = e === s ? s + 1 : e;
      if (did && !c.global) break;
    }
    if (!did) return false;
    this.ps = out + ps.slice(pos);
    this.tflag = true;
    if (c.print) this.printPS();
    if (c.file) this.write(c.file, `${this.ps}\n`);
    return true;
  }

  private readR(file: string): string | undefined {
    let lines = this.rfiles.get(file);
    if (!lines) {
      let text = '';
      try {
        text = this.ctx.vfs.readFile(abs(this.ctx, file));
      } catch {}
      this.rfiles.set(file, (lines = text.split(/(?<=\n)/).filter(Boolean)));
    }
    const l = lines.shift();
    return l === undefined ? undefined : l.endsWith('\n') ? l : `${l}\n`;
  }

  private async cycle(): Promise<Outcome> {
    const prog = this.prog;
    for (let pc = 0; pc < prog.length; pc++) {
      const c = prog[pc];
      if (!(await this.selected(c))) {
        if (c.name === '{') pc = c.end!;
        continue;
      }
      switch (c.name) {
        case '=': this.emit(`${this.line}\n`); break;
        case 'a': this.appendQ.push(`${c.text}\n`); break;
        case 'i': this.emit(`${c.text}\n`); break;
        case 'c':
          if (!c.a2 || c.neg || !c.active) this.emit(`${c.text}\n`);
          return 'delete';
        case 'd': return 'delete';
        case 'D': {
          const nl = this.ps.indexOf('\n');
          if (nl === -1) return 'delete';
          this.ps = this.ps.slice(nl + 1);
          return 'restart';
        }
        case 'p': this.printPS(); break;
        case 'P': this.emit(`${this.ps.split('\n')[0]}\n`); break;
        case 'n':
          if (await this.input.isLast()) return 'end';
          if (!this.quiet) this.printPS();
          this.flushAppends();
          this.load((await this.input.next())!);
          break;
        case 'N': {
          if (await this.input.isLast()) return 'end';
          this.flushAppends();
          const keep = this.ps;
          this.load((await this.input.next())!);
          this.ps = `${keep}\n${this.ps}`;
          break;
        }
        case 'g': this.ps = this.hs; break;
        case 'G': this.ps += `\n${this.hs}`; break;
        case 'h': this.hs = this.ps; break;
        case 'H': this.hs += `\n${this.ps}`; break;
        case 'x': [this.ps, this.hs] = [this.hs, this.ps]; break;
        case 'l': this.emit(listing(this.ps, c.int ?? this.width)); break;
        case 'q': this.quit = c.int ?? 0; return 'end';
        case 'Q': this.quit = c.int ?? 0; return 'silent';
        case 'r': {
          try {
            const text = this.ctx.vfs.readFile(abs(this.ctx, c.file!));
            if (text) this.appendQ.push(text.endsWith('\n') ? text : `${text}\n`);
          } catch {}
          break;
        }
        case 'R': {
          const l = this.readR(c.file!);
          if (l !== undefined) this.appendQ.push(l);
          break;
        }
        case 'w': this.write(c.file!, `${this.ps}\n`); break;
        case 'W': this.write(c.file!, `${this.ps.split('\n')[0]}\n`); break;
        case 's': this.subst(c); break;
        case 'y': this.ps = [...this.ps].map((ch) => c.map!.get(ch) ?? ch).join(''); break;
        case 'z': this.ps = ''; break;
        case 'F': this.emit(`${this.input.name}\n`); break;
        case 'b': pc = c.target ?? prog.length; continue;
        case 't':
        case 'T':
          if (this.tflag === (c.name === 't')) {
            this.tflag = false;
            pc = c.target ?? prog.length;
            continue;
          }
          if (c.name === 'T') this.tflag = false;
          break;
      }
    }
    return 'end';
  }
}
