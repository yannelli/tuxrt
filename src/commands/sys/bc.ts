import { lineReader } from '../../shell/io.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { MATH_FUNCTIONS, mathLib } from './bcmath.ts';
import { add, BcError, cmp, div, format, mod, mul, neg, num, ONE, parseNum, power, rescale, sqrt, sub, truthy, wrap, ZERO, type Num } from './bcnum.ts';
import { BcSyntaxError, lex, Parser, type Expr, type Stmt } from './bcparse.ts';
import { platform } from '../../platform/index.ts';

const BREAK = Symbol('break');
const CONTINUE = Symbol('continue');
const QUIT = Symbol('quit');
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', a: '\x07', b: '\b', f: '\f', r: '\r', q: '"', '\\': '\\' };

class Calculator {
  private vars = new Map<string, Num>();
  private scale: number;
  private ibase = 10;
  private obase = 10;
  private last = ZERO;
  private ticks = 0;
  private readonly math: boolean;
  private readonly ctx: Ctx;

  constructor(ctx: Ctx, math: boolean) {
    this.ctx = ctx;
    this.math = math;
    this.scale = math ? 20 : 0;
  }

  private get(name: string): Num {
    const special: Record<string, () => Num> = { scale: () => num(this.scale), ibase: () => num(this.ibase), obase: () => num(this.obase), last: () => this.last };
    return special[name]?.() ?? this.vars.get(name) ?? ZERO;
  }

  private set(name: string, v: Num): void {
    const n = Number(rescale(v, 0).v);
    if (name === 'scale') this.scale = Math.max(0, n);
    else if (name === 'ibase') this.ibase = Math.min(16, Math.max(2, n));
    else if (name === 'obase') this.obase = Math.max(2, n);
    else if (name === 'last') this.last = v;
    else this.vars.set(name, v);
  }

  private binary(op: string, a: Num, b: Num): Num {
    const s = this.scale;
    const ops: Record<string, () => Num> = {
      '+': () => add(a, b), '-': () => sub(a, b), '*': () => mul(a, b, s), '/': () => div(a, b, s), '%': () => mod(a, b, s), '^': () => power(a, b, s),
      '==': () => (cmp(a, b) === 0 ? ONE : ZERO), '!=': () => (cmp(a, b) !== 0 ? ONE : ZERO), '<': () => (cmp(a, b) < 0 ? ONE : ZERO),
      '<=': () => (cmp(a, b) <= 0 ? ONE : ZERO), '>': () => (cmp(a, b) > 0 ? ONE : ZERO), '>=': () => (cmp(a, b) >= 0 ? ONE : ZERO),
    };
    return ops[op]();
  }

  private call(name: string, args: Num[]): Num {
    const builtin = name === 'sqrt' || name === 'length' || name === 'scale' || (this.math && MATH_FUNCTIONS.has(name));
    if (!builtin) throw new BcError(`Function ${name} not defined.`);
    if (args.length !== 1) throw new BcError('Parameter number mismatch');
    const [x] = args;
    if (name === 'sqrt') return sqrt(x, this.scale);
    if (name === 'scale') return num(x.s);
    if (name === 'length') return num(x.v === 0n ? Math.max(1, x.s) : Math.max(String(x.v < 0n ? -x.v : x.v).length, x.s));
    return mathLib(name, x, this.scale);
  }

  private eval(e: Expr): Num {
    switch (e.t) {
      case 'num': return parseNum(e.text, this.ibase);
      case 'var': return this.get(e.name);
      case 'neg': return neg(this.eval(e.e));
      case 'not': return truthy(this.eval(e.e)) ? ZERO : ONE;
      case 'call': return this.call(e.name, e.args.map((a) => this.eval(a)));
      case 'assign': {
        const value = this.eval(e.value);
        this.set(e.name, e.op === '=' ? value : this.binary(e.op.slice(0, -1), this.get(e.name), value));
        return this.get(e.name);
      }
      case 'step': {
        const old = this.get(e.name);
        this.set(e.name, add(old, num(e.delta)));
        return e.prefix ? this.get(e.name) : old;
      }
      case 'bin':
        if (e.op === '&&') return truthy(this.eval(e.l)) && truthy(this.eval(e.r)) ? ONE : ZERO;
        if (e.op === '||') return truthy(this.eval(e.l)) || truthy(this.eval(e.r)) ? ONE : ZERO;
        return this.binary(e.op, this.eval(e.l), this.eval(e.r));
    }
  }

  private async loop(cond: () => boolean, body: Stmt, step?: () => void): Promise<void> {
    while (cond()) {
      if (++this.ticks % 1000 === 0) await platform.yield();
      if (this.ctx.signal.aborted) throw QUIT;
      try {
        await this.exec(body);
      } catch (e) {
        if (e === BREAK) break;
        if (e !== CONTINUE) throw e;
      }
      step?.();
    }
  }

  async exec(s: Stmt): Promise<void> {
    const out = (text: string) => this.ctx.stdout.write(text);
    switch (s.t) {
      case 'expr': {
        const v = this.eval(s.e);
        if (s.e.t !== 'assign') out(`${wrap(format((this.last = v), this.obase))}\n`);
        return;
      }
      case 'str': return out(s.s);
      case 'print':
        for (const item of s.items) out(typeof item === 'string' ? item.replace(/\\(.)/g, (m, c: string) => ESCAPES[c] ?? m) : wrap(format(this.eval(item), this.obase)));
        return;
      case 'block':
        for (const b of s.body) await this.exec(b);
        return;
      case 'if':
        if (truthy(this.eval(s.cond))) await this.exec(s.then);
        else if (s.otherwise) await this.exec(s.otherwise);
        return;
      case 'while': return this.loop(() => truthy(this.eval(s.cond)), s.body);
      case 'for':
        if (s.init) this.eval(s.init);
        return this.loop(() => !s.cond || truthy(this.eval(s.cond)), s.body, () => s.step && this.eval(s.step));
      case 'break': throw BREAK;
      case 'continue': throw CONTINUE;
      case 'quit': case 'halt': throw QUIT;
    }
  }

  /** Runs a complete chunk of source. Returns false once `quit` was seen. */
  async run(src: string, line: number): Promise<boolean> {
    const parser = new Parser(lex(src, line).toks);
    while (!parser.done) {
      let stmt: Stmt | null;
      try {
        stmt = parser.next();
      } catch (e) {
        if (!(e instanceof BcSyntaxError)) throw e;
        this.ctx.stderr.write(`(standard_in) ${e.line}: syntax error\n`);
        parser.recover();
        continue;
      }
      if (!stmt) continue;
      try {
        await this.exec(stmt);
      } catch (e) {
        if (e === QUIT) return false;
        if (e === BREAK || e === CONTINUE) continue;
        if (!(e instanceof BcError)) throw e;
        this.ctx.stderr.write(`Runtime error (func=(main), adr=0): ${e.message}\n`);
      }
    }
    return true;
  }
}

async function bc(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'lqswiv', long: { mathlib: 'l', quiet: 'q', standard: 's', warn: 'w', interactive: 'i', version: 'v' } });
  if (opts.v) return (ctx.stdout.write('bc 1.07.1\nCopyright 1991-1994, 1997, 1998, 2000, 2004, 2006, 2008, 2012-2017 Free Software Foundation, Inc.\n'), 0);
  const calc = new Calculator(ctx, !!opts.l);
  let line = 1;
  for (const file of operands) {
    let src: string;
    try {
      src = ctx.vfs.readFile(ctx.shell.abs(file));
    } catch {
      return (ctx.stderr.write(`File ${file} is unavailable.\n`), 1);
    }
    if (!(await calc.run(src, line))) return 0;
    line += src.split('\n').length - 1;
  }
  // Statements run as soon as their braces balance, so bc works interactively.
  const input = lineReader(ctx.stdin);
  let pending = '';
  for (let l = await input.next(); l !== null; l = await input.next()) {
    pending += l;
    if (lex(pending).open || pending.endsWith('\\\n')) continue;
    if (!(await calc.run(pending, line))) return 0;
    line += pending.split('\n').length - 1;
    pending = '';
  }
  if (pending) await calc.run(pending, line);
  return 0;
}

export const bcCommands: CommandTable = {
  bc: { fn: command(bc), desc: 'An arbitrary precision calculator language' },
};
