export interface ArithVars {
  get(name: string): string;
  set(name: string, value: string): void;
}

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const OPS = [
  '<<=', '>>=', '**', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', '(', ')', ',',
];

const BINARY: [string[], number][] = [
  [['||'], 1], [['&&'], 2], [['|'], 3], [['^'], 4], [['&'], 5], [['==', '!='], 6],
  [['<', '>', '<=', '>='], 7], [['<<', '>>'], 8], [['+', '-'], 9], [['*', '/', '%'], 10],
];
const PREC = new Map(BINARY.flatMap(([ops, p]) => ops.map((o) => [o, p] as const)));

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) i++;
    else if (/\d/.test(src[i])) {
      const m = /^(0[xX][0-9a-fA-F]+|\d+#[0-9a-zA-Z]+|\d+)/.exec(src.slice(i))![0];
      i += m.length;
      out.push({ k: 'num', v: parseNum(m) });
    } else if (/[A-Za-z_$]/.test(src[i])) {
      const m = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      i += m.length;
      out.push({ k: 'id', v: m.replace(/^\$/, '') });
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new Error(`syntax error: invalid arithmetic operator (error token is "${src.slice(i)}")`);
      i += op.length;
      out.push({ k: 'op', v: op });
    }
  }
  return out;
}

function parseNum(s: string): number {
  if (/^0[xX]/.test(s)) return parseInt(s, 16);
  if (s.includes('#')) {
    const [base, digits] = s.split('#');
    return parseInt(digits, Number(base));
  }
  return s.length > 1 && s.startsWith('0') ? parseInt(s, 8) : Number(s);
}

const int = (n: number) => (Number.isFinite(n) ? Math.trunc(n) : 0);

export function evaluate(src: string, vars: ArithVars, depth = 0): number {
  if (depth > 32) throw new Error('expression recursion level exceeded');
  const toks = lex(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`syntax error in expression (error token is "${src}")`);
    pos++;
  };
  const read = (name: string): number => {
    const raw = vars.get(name).trim();
    if (raw === '') return 0;
    return /^-?\d+$/.test(raw) ? Number(raw) : evaluate(raw, vars, depth + 1);
  };
  const write = (name: string, v: number) => (vars.set(name, String(int(v))), int(v));

  // `live` false means we are in a short-circuited branch: parse but skip side effects.
  const assignment = (live: boolean): number => {
    const t = peek();
    const next = toks[pos + 1];
    if (t?.k === 'id' && next?.k === 'op' && /^([-+*/%&|^]|<<|>>)?=$/.test(next.v)) {
      pos += 2;
      const rhs = assignment(live);
      if (!live) return 0;
      const op = next.v.slice(0, -1);
      return write(t.v, op ? binary(op, read(t.v), rhs) : rhs);
    }
    return ternary(live);
  };
  const ternary = (live: boolean): number => {
    const cond = binop(0, live);
    if (!isOp('?')) return cond;
    pos++;
    const a = assignment(live && cond !== 0);
    expect(':');
    const b = assignment(live && cond === 0);
    return cond ? a : b;
  };
  const binop = (minPrec: number, live: boolean): number => {
    let left = unary(live);
    for (;;) {
      const t = peek();
      if (t?.k !== 'op') return left;
      const prec = PREC.get(t.v);
      if (prec === undefined || prec <= minPrec) return left;
      pos++;
      if (t.v === '&&' || t.v === '||') {
        const rightLive = live && (t.v === '&&' ? left !== 0 : left === 0);
        const right = binop(prec, rightLive);
        left = t.v === '&&' ? Number(left !== 0 && right !== 0) : Number(left !== 0 || right !== 0);
      } else left = binary(t.v, left, binop(prec, live));
    }
  };
  const unary = (live: boolean): number => {
    const t = peek();
    if (t?.k === 'op' && (t.v === '++' || t.v === '--') && toks[pos + 1]?.k === 'id') {
      pos++;
      const name = (toks[pos++] as { v: string }).v;
      return live ? write(name, read(name) + (t.v === '++' ? 1 : -1)) : 0;
    }
    if (t?.k === 'op' && ['-', '+', '!', '~'].includes(t.v)) {
      pos++;
      const v = unary(live);
      return t.v === '-' ? -v : t.v === '+' ? v : t.v === '!' ? Number(v === 0) : ~v;
    }
    return power(live);
  };
  const power = (live: boolean): number => {
    const base = postfix(live);
    if (!isOp('**')) return base;
    pos++;
    return int(base ** unary(live));
  };
  const postfix = (live: boolean): number => {
    const t = peek();
    if (!t) throw new Error(`syntax error: operand expected (error token is "${src}")`);
    pos++;
    if (t.k === 'num') return t.v;
    if (t.k === 'id') {
      if (isOp('++') || isOp('--')) {
        const delta = peek().v === '++' ? 1 : -1;
        pos++;
        const old = live ? read(t.v) : 0;
        if (live) write(t.v, old + delta);
        return old;
      }
      return live ? read(t.v) : 0;
    }
    if (t.v === '(') {
      const v = comma(live);
      expect(')');
      return v;
    }
    throw new Error(`syntax error: operand expected (error token is "${t.v}")`);
  };
  const comma = (live: boolean): number => {
    let v = assignment(live);
    while (isOp(',')) {
      pos++;
      v = assignment(live);
    }
    return v;
  };

  if (!toks.length) return 0;
  const result = comma(true);
  if (pos < toks.length) throw new Error(`syntax error in expression (error token is "${src}")`);
  return result;
}

function binary(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return int(a * b);
    case '/':
    case '%':
      if (b === 0) throw new Error('division by 0');
      return op === '/' ? int(a / b) : a % b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '<': return Number(a < b);
    case '>': return Number(a > b);
    case '<=': return Number(a <= b);
    case '>=': return Number(a >= b);
    case '==': return Number(a === b);
    case '!=': return Number(a !== b);
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
  }
  throw new Error(`unknown operator ${op}`);
}
