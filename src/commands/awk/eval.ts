import { isRef, type Expr, type LValue, type Stmt } from './ast.ts';
import { callBuiltin, getline } from './builtins.ts';
import { compile } from './regex.ts';
import { State } from './state.ts';
import { AwkArray, isNumeric, toBool, toNum, UNINIT, type Val } from './value.ts';

export interface Loc {
  get(): Val;
  set(v: Val): void;
}

const MAX_DEPTH = 10000;

/** Tree-walking expression evaluator. Statement execution and main input live in Interp. */
export abstract class Evaluator extends State {
  private depth = 0;

  abstract runFunction(body: Stmt[]): Promise<Val>;
  abstract nextMainRecord(): Promise<string | null>;

  async ev(e: Expr): Promise<Val> {
    switch (e.k) {
      case 'num':
      case 'str':
        return e.v;
      case 'regex':
        return compile(e.src).test(this.record) ? 1 : 0;
      case 'var':
      case 'local':
        return this.getRef(e);
      case 'field':
        return this.getField(this.fieldIndex(await this.ev(e.e)));
      case 'index': {
        const a = this.array(e.arr);
        const key = await this.key(e.subs);
        let v = a.m.get(key);
        if (v === undefined) a.m.set(key, (v = UNINIT));
        return v;
      }
      case 'assign': {
        const loc = await this.loc(e.target);
        const rhs = await this.ev(e.e);
        const v = e.op === '=' ? rhs : this.binary(e.op.slice(0, -1), loc.get(), rhs);
        loc.set(v);
        return v;
      }
      case 'cond':
        return toBool(await this.ev(e.c)) ? this.ev(e.t) : this.ev(e.f);
      case 'and':
        return toBool(await this.ev(e.l)) && toBool(await this.ev(e.r)) ? 1 : 0;
      case 'or':
        return toBool(await this.ev(e.l)) || toBool(await this.ev(e.r)) ? 1 : 0;
      case 'in': {
        const key = await this.key(e.subs);
        return this.array(e.arr).m.has(key) ? 1 : 0;
      }
      case 'match': {
        const s = this.str(await this.ev(e.l));
        return compile(await this.regexSource(e.r)).test(s) !== e.neg ? 1 : 0;
      }
      case 'binary':
        return this.binary(e.op, await this.ev(e.l), await this.ev(e.r));
      case 'unary': {
        const v = await this.ev(e.e);
        return e.op === '!' ? (toBool(v) ? 0 : 1) : e.op === '-' ? -toNum(v) : toNum(v);
      }
      case 'incdec': {
        const loc = await this.loc(e.target);
        const old = toNum(loc.get());
        const v = e.op === '++' ? old + 1 : old - 1;
        loc.set(v);
        return e.pre ? v : old;
      }
      case 'call':
        return this.call(e.name, e.args);
      case 'builtin':
        return callBuiltin(this, e.name, e.args);
      case 'getline':
        return getline(this, e);
    }
  }

  /** A regex operand: literal /re/ is used as is; anything else is a dynamic regex string. */
  async regexSource(e: Expr): Promise<string> {
    return e.k === 'regex' ? e.src : this.str(await this.ev(e));
  }

  async key(subs: Expr[]): Promise<string> {
    if (subs.length === 1) return this.str(await this.ev(subs[0]));
    const parts: string[] = [];
    for (const s of subs) parts.push(this.str(await this.ev(s)));
    return parts.join(this.subsep);
  }

  async loc(t: LValue): Promise<Loc> {
    switch (t.k) {
      case 'var':
      case 'local':
        return { get: () => this.getRef(t), set: (v) => this.setRef(t, v) };
      case 'field': {
        const i = this.fieldIndex(await this.ev(t.e));
        return { get: () => this.getField(i), set: (v) => this.setField(i, v) };
      }
      case 'index': {
        const a = this.array(t.arr);
        const k = await this.key(t.subs);
        return { get: () => a.m.get(k) ?? UNINIT, set: (v) => void a.m.set(k, v) };
      }
    }
  }

  binary(op: string, a: Val, b: Val): Val {
    switch (op) {
      case ' ':
        return this.str(a) + this.str(b);
      case '+':
        return toNum(a) + toNum(b);
      case '-':
        return toNum(a) - toNum(b);
      case '*':
        return toNum(a) * toNum(b);
      case '/':
      case '%': {
        const d = toNum(b);
        if (d === 0) throw this.fatal(op === '/' ? 'division by zero' : 'division by zero in %');
        return op === '/' ? toNum(a) / d : toNum(a) % d;
      }
      case '^':
        return toNum(a) ** toNum(b);
    }
    const c = this.compare(a, b);
    switch (op) {
      case '<': return c < 0 ? 1 : 0;
      case '<=': return c <= 0 ? 1 : 0;
      case '>': return c > 0 ? 1 : 0;
      case '>=': return c >= 0 ? 1 : 0;
      case '==': return c === 0 ? 1 : 0;
      default: return c !== 0 ? 1 : 0;
    }
  }

  /** Numbers and strnums compare numerically with each other; anything else compares as strings. */
  compare(a: Val, b: Val): number {
    if (isNumeric(a) && isNumeric(b)) {
      const x = toNum(a);
      const y = toNum(b);
      return x < y ? -1 : x > y ? 1 : x === y ? 0 : NaN;
    }
    const s = this.str(a);
    const t = this.str(b);
    return s < t ? -1 : s > t ? 1 : 0;
  }

  private async call(name: string, args: Expr[]): Promise<Val> {
    const fn = this.prog.funcs.get(name)!;
    if (args.length > fn.params.length) throw this.fatal(`too many arguments in call to ${name}`);
    if (this.depth >= MAX_DEPTH) throw this.fatal('function call nesting too deep');
    const frame: (Val | AwkArray | undefined)[] = new Array(fn.params.length);
    const pending: [Expr, AwkArray][] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const cur = isRef(a) ? this.peek(a) : null;
      if (cur instanceof AwkArray) frame[i] = cur;
      else if (cur === undefined && !(a.k === 'var' && a.name === 'NF')) {
        const arr = new AwkArray();
        arr.untyped = true;
        frame[i] = arr;
        pending.push([a, arr]);
      } else frame[i] = await this.ev(a);
    }
    const saved = this.frame;
    this.frame = frame;
    this.depth++;
    try {
      return await this.runFunction(fn.body);
    } finally {
      this.frame = saved;
      this.depth--;
      for (const [ref, arr] of pending) {
        if (!arr.untyped && isRef(ref) && this.peek(ref) === undefined) {
          if (ref.k === 'var') this.globals.set(ref.name, arr);
          else this.frame[ref.i] = arr;
        }
      }
    }
  }
}
