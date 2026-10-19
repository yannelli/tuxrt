import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs } from '../util.ts';
import { chunks } from './stream.ts';

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i));
const chars = (...ranges: [number, number][]) => ranges.flatMap(([a, b]) => span(a, b));

const CLASSES: Record<string, string[]> = {
  alpha: chars([65, 90], [97, 122]),
  upper: chars([65, 90]),
  lower: chars([97, 122]),
  digit: chars([48, 57]),
  alnum: chars([48, 57], [65, 90], [97, 122]),
  space: chars([9, 13], [32, 32]),
  blank: chars([9, 9], [32, 32]),
  punct: chars([33, 47], [58, 64], [91, 96], [123, 126]),
  print: chars([32, 126]),
  graph: chars([33, 126]),
  cntrl: chars([0, 31], [127, 127]),
  xdigit: chars([48, 57], [65, 70], [97, 102]),
};

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\' };

class TrError extends Error {}

/** Expands a tr SET: escapes, ranges, [:class:], [=c=], and [c*n] repeats (n = 0 means fill). */
function expand(spec: string, fillTo?: number): string[] {
  const out: string[] = [];
  let fill = -1;
  let i = 0;
  const readChar = (): string => {
    if (spec[i] !== '\\' || i + 1 >= spec.length) return spec[i++];
    const oct = /^[0-7]{1,3}/.exec(spec.slice(i + 1));
    if (oct) {
      i += 1 + oct[0].length;
      return String.fromCharCode(parseInt(oct[0], 8));
    }
    const c = spec[i + 1];
    i += 2;
    return ESC[c] ?? c;
  };
  while (i < spec.length) {
    const cls = /^\[:(\w+):\]/.exec(spec.slice(i));
    if (cls) {
      if (!CLASSES[cls[1]]) throw new TrError(`invalid character class '${cls[1]}'`);
      out.push(...CLASSES[cls[1]]);
      i += cls[0].length;
      continue;
    }
    const eq = /^\[=(.)=\]/s.exec(spec.slice(i));
    if (eq) {
      out.push(eq[1]);
      i += eq[0].length;
      continue;
    }
    const rep = fillTo !== undefined ? /^\[(\\?.)\*(\d*)\]/s.exec(spec.slice(i)) : null;
    if (rep) {
      const save = i;
      i = save + 1;
      const c = readChar();
      i = save + rep[0].length;
      const n = rep[2] ? parseInt(rep[2], rep[2].startsWith('0') ? 8 : 10) : 0;
      if (n === 0) fill = out.length;
      out.push(...Array(n || 1).fill(c));
      continue;
    }
    const c = readChar();
    if (spec[i] === '-' && i + 1 < spec.length) {
      i++;
      const end = readChar();
      if (end < c) throw new TrError(`range-endpoints of '${c}-${end}' are in reverse collating sequence order`);
      out.push(...span(c.charCodeAt(0), end.charCodeAt(0)));
    } else out.push(c);
  }
  if (fill !== -1 && fillTo !== undefined) out.splice(fill, 1, ...Array(Math.max(0, fillTo - out.length + 1)).fill(out[fill]));
  return out;
}

async function tr(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'cCdst',
    long: { complement: 'c', delete: 'd', 'squeeze-repeats': 's', 'truncate-set1': 't' },
  });
  const usage = (msg: string) => fail(ctx, `${msg}\nTry 'tr --help' for more information.`);
  const comp = !!(opts.c || opts.C);
  const translate = !opts.d && operands.length > 1;
  if (!operands.length) return usage('missing operand');
  if (!opts.d && !opts.s && operands.length < 2) return usage(`missing operand after '${operands[0]}'\nTwo strings must be given when translating.`);
  if (opts.d && !opts.s && operands.length > 1) return usage(`extra operand '${operands[1]}'\nOnly one string may be given when deleting without squeezing repeats.`);
  if (operands.length > 2) return usage(`extra operand '${operands[2]}'`);
  let set1: string[];
  let set2: string[];
  try {
    set1 = expand(operands[0]);
    set2 = operands[1] === undefined ? [] : expand(operands[1], set1.length);
  } catch (e) {
    if (e instanceof TrError) return fail(ctx, e.message);
    throw e;
  }
  const in1 = new Set(set1);
  const member = (c: string) => in1.has(c) !== comp;
  const map = new Map<string, string>();
  if (translate) {
    if (!set2.length) return fail(ctx, 'when not truncating set1, string2 must be non-empty');
    const last = set2[set2.length - 1];
    const from = comp ? span(0, 255).filter((c) => !in1.has(c)) : opts.t ? set1.slice(0, set2.length) : set1;
    from.forEach((c, i) => map.set(c, set2[i] ?? last));
  }
  const squeeze = opts.s ? new Set(translate || opts.d ? set2 : set1) : null;
  const squeezeComp = opts.s && !translate && !opts.d && comp;
  const fallback = comp && translate ? set2[set2.length - 1] : undefined;
  let prev = '';
  for await (const chunk of chunks(ctx.stdin)) {
    let out = '';
    for (const ch of chunk) {
      if (opts.d && member(ch)) continue;
      let c = ch;
      if (translate) c = map.get(ch) ?? (fallback !== undefined && member(ch) ? fallback : ch);
      if (squeeze && c === prev && (squeezeComp ? !in1.has(c) : squeeze.has(c))) continue;
      out += c;
      prev = c;
    }
    ctx.stdout.write(out);
  }
  return 0;
}

export const trCommands: CommandTable = {
  tr: { fn: command(tr), desc: 'translate or delete characters' },
};
