import { errMessage } from '../../vfs/errors.ts';
import type { Rule, Stmt } from './ast.ts';
import { Evaluator } from './eval.ts';
import { numToStr, sprintf } from './format.ts';
import { unescape } from './lexer.ts';
import { RecordSource } from './records.ts';
import { RegexError } from './regex.ts';
import { AwkError, stdinSource } from './streams.ts';
import { AwkArray, strnum, toBool, toNum, UNINIT, type Val } from './value.ts';

const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
type Flow = 0 | typeof BREAK | typeof CONTINUE | typeof RETURN;

const NEXT = Symbol('next');
const NEXTFILE = Symbol('nextfile');
const EXIT = Symbol('exit');
const ABORT = Symbol('abort');
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

export class Interp extends Evaluator {
  private exitCode = 0;
  private retval: Val = UNINIT;
  private ticks = 0;
  private main: RecordSource | null = null;
  private argIndex = 1;
  private openedInput = false;

  /** Sets ARGV/ARGC and applies -v assignments (before BEGIN, as POSIX requires). */
  init(operands: string[], assigns: string[]): void {
    const argv = new AwkArray();
    argv.m.set('0', this.ctx.name);
    operands.forEach((a, i) => argv.m.set(String(i + 1), strnum(a)));
    this.globals.set('ARGV', argv);
    this.globals.set('ARGC', operands.length + 1);
    for (const a of assigns) {
      const m = ASSIGNMENT.exec(a)!;
      this.assignVar(m[1], m[2]);
    }
  }

  private assignVar(name: string, raw: string): void {
    this.setVar(name, strnum(unescape(raw)));
  }

  async run(): Promise<number> {
    try {
      try {
        for (const b of this.prog.begin) await this.execBlock(b);
        if (this.prog.rules.length || this.prog.end.length) await this.mainLoop();
      } catch (e) {
        if (e !== EXIT) throw e;
      }
      try {
        for (const b of this.prog.end) await this.execBlock(b);
      } catch (e) {
        if (e !== EXIT) throw e;
      }
      return this.exitCode;
    } catch (e) {
      return this.failure(e);
    } finally {
      await this.streams.closeAll();
    }
  }

  private failure(e: unknown): number {
    if (e === ABORT) return 128 + (Number(this.ctx.signal.reason) || 2);
    if (e === NEXT || e === NEXTFILE) e = new AwkError('improper use of next');
    if (e instanceof RegexError) e = new AwkError(`regular expression compile failed (${e.message})`);
    if (!(e instanceof AwkError)) throw e;
    const where = `\tFILENAME="${this.str(this.getVar('FILENAME'))}" FNR=${this.str(this.getVar('FNR'))} NR=${this.str(this.getVar('NR'))}\n`;
    this.ctx.stderr.write(e.runtime ? `${this.ctx.name}: run time error: ${e.message}\n${where}` : `${this.ctx.name}: ${e.message}\n`);
    return 2;
  }

  private async tick(): Promise<void> {
    if (++this.ticks % 1000 === 0) await new Promise((r) => setImmediate(r));
    if (this.ctx.signal.aborted) throw ABORT;
  }

  private async mainLoop(): Promise<void> {
    for (let rec = await this.nextMainRecord(); rec !== null; rec = await this.nextMainRecord()) {
      this.incr('NR');
      this.incr('FNR');
      this.setRecord(rec);
      try {
        for (const rule of this.prog.rules) {
          if (!(await this.matches(rule))) continue;
          if (rule.body) await this.execBlock(rule.body);
          else this.ctx.stdout.write(this.record + this.ors);
        }
      } catch (e) {
        if (e === NEXTFILE) this.main = null;
        else if (e !== NEXT) throw e;
      }
      await this.tick();
    }
  }

  private async matches(r: Rule): Promise<boolean> {
    if (!r.pattern) return true;
    if (!r.end) return toBool(await this.ev(r.pattern));
    if (!r.inRange) {
      if (!toBool(await this.ev(r.pattern))) return false;
      r.inRange = true;
    }
    if (toBool(await this.ev(r.end))) r.inRange = false;
    return true;
  }

  async nextMainRecord(): Promise<string | null> {
    for (;;) {
      if (this.main) {
        const rec = await this.main.next(this.rs);
        if (rec !== null) return rec;
        this.main = null;
      }
      if (!this.openNextInput()) return null;
    }
  }

  /** Walks ARGV from where it left off: assignments apply when reached, files become the input. */
  private openNextInput(): boolean {
    const argv = this.globals.get('ARGV');
    const argc = toNum(this.getVar('ARGC'));
    while (this.argIndex < argc) {
      const v = argv instanceof AwkArray ? argv.m.get(String(this.argIndex)) : undefined;
      this.argIndex++;
      const arg = v === undefined ? '' : this.str(v);
      const m = ASSIGNMENT.exec(arg);
      if (m) this.assignVar(m[1], m[2]);
      else if (arg !== '') return this.openInput(arg);
    }
    return !this.openedInput && this.openInput('-', true);
  }

  /** With no file operands stdin is read and FILENAME stays empty. */
  private openInput(name: string, implicit = false): boolean {
    this.openedInput = true;
    if (!implicit) this.setVar('FILENAME', name);
    this.setVar('FNR', 0);
    if (name === '-' || name === '/dev/stdin') this.main = stdinSource(this.ctx);
    else {
      try {
        this.main = RecordSource.ofText(this.ctx.vfs.readFile(this.ctx.shell.abs(name)));
      } catch (e) {
        throw new AwkError(`cannot open ${name} (${errMessage(e)})`, false);
      }
    }
    return true;
  }

  async runFunction(body: Stmt[]): Promise<Val> {
    this.retval = UNINIT;
    return (await this.execBlock(body)) === RETURN ? this.retval : UNINIT;
  }

  private async execBlock(body: Stmt[]): Promise<Flow> {
    for (const s of body) {
      const f = await this.exec(s);
      if (f) return f;
    }
    return 0;
  }

  /** Runs one loop body; CONTINUE just ends the iteration. */
  private async iterate(body: Stmt): Promise<Flow> {
    const f = await this.exec(body);
    await this.tick();
    return f === CONTINUE ? 0 : f;
  }

  private async exec(s: Stmt): Promise<Flow> {
    switch (s.k) {
      case 'expr':
        await this.ev(s.e);
        return 0;
      case 'print':
      case 'printf':
        return this.print(s);
      case 'if':
        if (toBool(await this.ev(s.c))) return this.exec(s.t);
        return s.f ? this.exec(s.f) : 0;
      case 'while':
        while (toBool(await this.ev(s.c))) {
          const f = await this.iterate(s.body);
          if (f) return f === BREAK ? 0 : f;
        }
        return 0;
      case 'do':
        do {
          const f = await this.iterate(s.body);
          if (f) return f === BREAK ? 0 : f;
        } while (toBool(await this.ev(s.c)));
        return 0;
      case 'for':
        if (s.init) await this.ev(s.init);
        while (!s.c || toBool(await this.ev(s.c))) {
          const f = await this.iterate(s.body);
          if (f) return f === BREAK ? 0 : f;
          if (s.step) await this.ev(s.step);
        }
        return 0;
      case 'forin': {
        const arr = this.array(s.arr);
        for (const k of [...arr.m.keys()]) {
          if (!arr.m.has(k)) continue;
          this.setRef(s.v, strnum(k));
          const f = await this.iterate(s.body);
          if (f) return f === BREAK ? 0 : f;
        }
        return 0;
      }
      case 'block':
        return this.execBlock(s.body);
      case 'jump':
        if (s.op === 'break') return BREAK;
        if (s.op === 'continue') return CONTINUE;
        throw s.op === 'next' ? NEXT : NEXTFILE;
      case 'exit':
        if (s.e) this.exitCode = toNum(await this.ev(s.e)) & 255;
        throw EXIT;
      case 'return':
        this.retval = s.e ? await this.ev(s.e) : UNINIT;
        return RETURN;
      case 'delete': {
        const arr = this.array(s.arr);
        if (s.subs) arr.m.delete(await this.key(s.subs));
        else arr.m.clear();
        return 0;
      }
    }
  }

  private async print(s: Extract<Stmt, { k: 'print' | 'printf' }>): Promise<Flow> {
    const vals: Val[] = [];
    for (const a of s.args) vals.push(await this.ev(a));
    let out: string;
    if (s.k === 'printf') out = sprintf(this.str(vals[0]), vals.slice(1), this.convfmt);
    else if (!vals.length) out = this.record + this.ors;
    else out = vals.map((v) => (typeof v === 'number' ? numToStr(v, this.ofmt) : this.str(v))).join(this.ofs) + this.ors;
    if (s.redir) this.streams.write(s.redir.op, this.str(await this.ev(s.redir.e)), out);
    else this.ctx.stdout.write(out);
    return 0;
  }
}
