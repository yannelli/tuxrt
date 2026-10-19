import type { Ctx } from '../types.ts';
import type { Program, Ref } from './ast.ts';
import { toStr } from './format.ts';
import { splitFields } from './records.ts';
import { AwkError, Streams } from './streams.ts';
import { AwkArray, strnum, toNum, UNINIT, type Val } from './value.ts';

type Slot = Val | AwkArray | undefined;

/** Variables, the current record and its fields, and cached copies of the special variables. */
export class State {
  readonly ctx: Ctx;
  readonly prog: Program;
  readonly streams: Streams;
  readonly globals = new Map<string, Val | AwkArray>();
  frame: Slot[] = [];
  convfmt = '%.6g';
  ofmt = '%.6g';
  subsep = '\x1c';
  fs = ' ';
  ofs = ' ';
  ors = '\n';
  rs = '\n';
  record = '';
  private fields: string[] = [''];
  private nf = 0;
  private splitDone = true;
  private recordFS = ' ';
  private seed = 0;
  private rng = 0;

  constructor(ctx: Ctx, prog: Program) {
    this.ctx = ctx;
    this.prog = prog;
    this.streams = new Streams(ctx);
    const vars: Record<string, Val> = {
      FS: ' ', OFS: ' ', ORS: '\n', RS: '\n', NR: 0, FNR: 0, SUBSEP: '\x1c', CONVFMT: '%.6g', OFMT: '%.6g',
      RSTART: 0, RLENGTH: -1, FILENAME: '',
    };
    for (const [k, v] of Object.entries(vars)) this.globals.set(k, v);
    const env = new AwkArray();
    for (const [k, v] of Object.entries(ctx.env)) env.m.set(k, strnum(v));
    this.globals.set('ENVIRON', env);
    this.srand(Date.now() % 1e9);
  }

  fatal(msg: string): AwkError {
    return new AwkError(msg);
  }

  str(v: Val): string {
    return toStr(v, this.convfmt);
  }

  getVar(name: string): Val {
    if (name === 'NF') return this.getNF();
    const v = this.globals.get(name);
    if (v === undefined) return UNINIT;
    if (v instanceof AwkArray) throw this.fatal(`can't use array ${name} in scalar context`);
    return v;
  }

  setVar(name: string, v: Val): void {
    if (name === 'NF') return this.setNF(toNum(v));
    if (this.globals.get(name) instanceof AwkArray) throw this.fatal(`can't assign to ${name}; it's an array name.`);
    this.globals.set(name, v);
    switch (name) {
      case 'CONVFMT': this.convfmt = toStr(v, '%.6g'); break;
      case 'OFMT': this.ofmt = toStr(v, '%.6g'); break;
      case 'SUBSEP': this.subsep = this.str(v); break;
      case 'FS': this.fs = this.str(v); break;
      case 'OFS': this.ofs = this.str(v); break;
      case 'ORS': this.ors = this.str(v); break;
      case 'RS': this.rs = this.str(v); break;
    }
  }

  /** Raw slot contents, without scalar/array checks. */
  peek(ref: Ref): Slot {
    return ref.k === 'var' ? this.globals.get(ref.name) : this.frame[ref.i];
  }

  getRef(ref: Ref): Val {
    if (ref.k === 'var') return this.getVar(ref.name);
    const v = this.frame[ref.i];
    if (v === undefined) return UNINIT;
    if (v instanceof AwkArray) {
      if (v.untyped) return UNINIT;
      throw this.fatal(`can't use array ${ref.name} in scalar context`);
    }
    return v;
  }

  setRef(ref: Ref, v: Val): void {
    if (ref.k === 'var') return this.setVar(ref.name, v);
    const cur = this.frame[ref.i];
    if (cur instanceof AwkArray && !cur.untyped) throw this.fatal(`can't assign to ${ref.name}; it's an array name.`);
    this.frame[ref.i] = v;
  }

  array(ref: Ref): AwkArray {
    const cur = this.peek(ref);
    if (cur instanceof AwkArray) {
      cur.untyped = false;
      return cur;
    }
    if (cur !== undefined || (ref.k === 'var' && ref.name === 'NF')) throw this.fatal(`can't use scalar ${ref.name} as array`);
    const a = new AwkArray();
    if (ref.k === 'var') this.globals.set(ref.name, a);
    else this.frame[ref.i] = a;
    return a;
  }

  incr(name: string): void {
    this.setVar(name, toNum(this.getVar(name)) + 1);
  }

  setRecord(s: string): void {
    this.record = s;
    this.splitDone = false;
    this.recordFS = this.fs;
  }

  private split(): void {
    if (this.splitDone) return;
    const f = splitFields(this.record, this.recordFS, this.rs === '');
    this.fields = ['', ...f];
    this.nf = f.length;
    this.splitDone = true;
  }

  fieldIndex(v: Val): number {
    const n = Math.trunc(toNum(v));
    if (n < 0 || Number.isNaN(n)) throw this.fatal(`negative field index $${n}`);
    return n;
  }

  getField(i: number): Val {
    if (i === 0) return strnum(this.record);
    this.split();
    return i <= this.nf ? strnum(this.fields[i]) : UNINIT;
  }

  setField(i: number, v: Val): void {
    if (i === 0) return this.setRecord(this.str(v));
    this.split();
    while (this.nf < i) this.fields[++this.nf] = '';
    this.fields[i] = this.str(v);
    this.rebuild();
  }

  private getNF(): number {
    this.split();
    return this.nf;
  }

  private setNF(n: number): void {
    this.split();
    const want = Math.trunc(n);
    if (want < 0 || Number.isNaN(want)) throw this.fatal(`NF set to negative value`);
    while (this.nf < want) this.fields[++this.nf] = '';
    this.fields.length = want + 1;
    this.nf = want;
    this.rebuild();
  }

  private rebuild(): void {
    this.record = this.fields.slice(1, this.nf + 1).join(this.ofs);
  }

  rand(): number {
    let t = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  srand(seed = Math.floor(Date.now() / 1000)): number {
    const prev = this.seed;
    this.seed = seed;
    this.rng = Math.trunc(seed) | 0;
    return prev;
  }
}
