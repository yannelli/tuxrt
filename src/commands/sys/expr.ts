import type { CommandTable, Ctx } from '../types.ts';

class ExprError extends Error {}

const isInt = (s: string) => /^[-+]?\d+$/.test(s);
const isNull = (s: string) => s === '' || (isInt(s) && BigInt(s) === 0n);

function int(s: string): bigint {
  if (!isInt(s)) throw new ExprError('non-integer argument');
  return BigInt(s);
}

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: ' \\t\\n\\r\\f\\v', blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w',
};

/** POSIX basic regular expression to JavaScript: \( \) \{ \} \| \+ \? are the operators. */
export function breToJs(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const n = p[++i];
      out += '(){}|+?'.includes(n) ? n : `\\${n}`;
    } else if ('(){}|+?'.includes(c)) out += `\\${c}`;
    else if (c === '*' && (out === '' || out.endsWith('(') || out === '^')) out += '\\*';
    else if (c === '[') {
      const end = p.indexOf(']', i + (p[i + 1] === '^' ? 3 : 2));
      if (end === -1) throw new ExprError('Unmatched [, [^, [:, [., or [=');
      out += p.slice(i, end + 1).replace(/\\/g, '\\\\').replace(/\[:(\w+):\]/g, (_, k: string) => POSIX_CLASSES[k] ?? '');
      i = end;
    } else out += c;
  }
  return out;
}

function match(s: string, pattern: string): string {
  const js = breToJs(pattern);
  const m = new RegExp(`^(?:${js})`).exec(s);
  if (/(^|[^\\])\((?!\?)/.test(js)) return m?.[1] ?? '';
  return String(m ? m[0].length : 0);
}

function evaluate(tokens: string[]): string {
  let i = 0;
  const next = () => {
    if (i >= tokens.length) throw new ExprError(i ? `syntax error: missing argument after ‘${tokens[i - 1]}’` : 'missing operand');
    return tokens[i++];
  };
  const binary = (ops: string[], sub: () => string, apply: (op: string, l: string, r: string) => string) => (): string => {
    let l = sub();
    while (ops.includes(tokens[i])) {
      const op = tokens[i++];
      l = apply(op, l, sub());
    }
    return l;
  };
  const primary = (): string => {
    const t = next();
    if (t === '(') {
      const v = or();
      if (tokens[i] !== ')') throw new ExprError(i < tokens.length ? `syntax error: expecting ‘)’ instead of ‘${tokens[i]}’` : `syntax error: expecting ‘)’ after ‘${tokens[i - 1]}’`);
      i++;
      return v;
    }
    if (t === '+') return next();
    if (t === 'length') return String([...primary()].length);
    if (t === 'match') return match(primary(), primary());
    if (t === 'index') {
      const [s, chars] = [primary(), primary()];
      return String([...s].findIndex((c) => chars.includes(c)) + 1);
    }
    if (t === 'substr') {
      const [s, pos, len] = [primary(), primary(), primary()];
      if (!isInt(pos) || !isInt(len) || Number(pos) < 1 || Number(len) < 1) return '';
      return [...s].slice(Number(pos) - 1, Number(pos) - 1 + Number(len)).join('');
    }
    return t;
  };
  const colon = binary([':'], primary, (_, l, r) => match(l, r));
  const mul = binary(['*', '/', '%'], colon, (op, l, r) => {
    const [a, b] = [int(l), int(r)];
    if (op !== '*' && b === 0n) throw new ExprError('division by zero');
    return String(op === '*' ? a * b : op === '/' ? a / b : a % b);
  });
  const add = binary(['+', '-'], mul, (op, l, r) => String(op === '+' ? int(l) + int(r) : int(l) - int(r)));
  const cmp = binary(['<', '<=', '=', '==', '!=', '>=', '>'], add, (op, l, r) => {
    const c = isInt(l) && isInt(r) ? Number(BigInt(l) - BigInt(r) > 0n) - Number(BigInt(l) < BigInt(r)) : l < r ? -1 : l > r ? 1 : 0;
    const ok = { '<': c < 0, '<=': c <= 0, '=': c === 0, '==': c === 0, '!=': c !== 0, '>=': c >= 0, '>': c > 0 }[op];
    return ok ? '1' : '0';
  });
  const and = binary(['&'], cmp, (_, l, r) => (isNull(l) || isNull(r) ? '0' : l));
  const or = binary(['|'], and, (_, l, r) => (!isNull(l) ? l : !isNull(r) ? r : '0'));
  const result = or();
  if (i < tokens.length) throw new ExprError(`syntax error: unexpected argument ‘${tokens[i]}’`);
  return result;
}

function expr(ctx: Ctx): number {
  const args = ctx.args[0] === '--' ? ctx.args.slice(1) : ctx.args;
  try {
    const result = evaluate(args);
    ctx.stdout.write(`${result}\n`);
    return isNull(result) ? 1 : 0;
  } catch (e) {
    if (!(e instanceof ExprError || e instanceof SyntaxError)) throw e;
    ctx.stderr.write(`expr: ${e.message}${e.message === 'missing operand' ? "\nTry 'expr --help' for more information." : ''}\n`);
    return 2;
  }
}

export const exprCommands: CommandTable = {
  expr: { fn: expr, desc: 'evaluate expressions' },
};
