import { format } from '../builtins/printf.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, UsageError } from '../util.ts';
import { pause } from './stream.ts';

const NUMBER = /^[-+]?(?:(\d+)\.?(\d*)|\.(\d+))(?:[eE]([-+]?\d+))?$/;

function precision(s: string): number {
  const m = NUMBER.exec(s);
  if (!m) return 0;
  return Math.max(0, (m[2] ?? m[3] ?? '').length - Number(m[4] ?? 0));
}

function parseOperands(args: string[]): { fmt?: string; sep: string; equal: boolean; nums: string[] } {
  let fmt: string | undefined;
  let sep = '\n';
  let equal = false;
  const nums: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = (inline: string) => {
      const v = inline || args[++i];
      if (v === undefined) throw new UsageError(`option requires an argument -- '${a[1]}'`);
      return v;
    };
    if (nums.length || /^-?[\d.]/.test(a) || a === '-' || !a.startsWith('-')) nums.push(a);
    else if (a === '--') nums.push(...args.splice(i + 1));
    else if (a.startsWith('--format=') || a.startsWith('--separator=')) [fmt, sep] = a[2] === 'f' ? [a.slice(9), sep] : [fmt, a.slice(12)];
    else if (a === '--equal-width' || a === '-w') equal = true;
    else if (a.startsWith('-f')) fmt = value(a.slice(2));
    else if (a.startsWith('-s')) sep = value(a.slice(2));
    else if (/^-w[fs]/.test(a)) {
      equal = true;
      args.splice(i + 1, 0, `-${a.slice(2)}`);
    } else throw new UsageError(a.startsWith('--') ? `unrecognized option '${a}'` : `invalid option -- '${a[1]}'`);
  }
  return { fmt, sep, equal, nums };
}

async function seq(ctx: Ctx): Promise<number> {
  const { fmt, sep, equal, nums } = parseOperands([...ctx.args]);
  const usage = (msg: string) => fail(ctx, `${msg}\nTry 'seq --help' for more information.`);
  if (!nums.length) return usage('missing operand');
  if (nums.length > 3) return usage(`extra operand '${nums[3]}'`);
  const bad = nums.find((n) => !NUMBER.test(n) && !/^[-+]?inf(inity)?$/i.test(n));
  if (bad !== undefined) return usage(`invalid floating point argument: '${bad}'`);
  const [firstS, incrS, lastS] = nums.length === 1 ? ['1', '1', nums[0]] : nums.length === 2 ? [nums[0], '1', nums[1]] : nums;
  const [first, incr, last] = [firstS, incrS, lastS].map((s) => Number(s.replace(/inf(inity)?/i, 'Infinity')));
  if (incr === 0) return usage(`invalid Zero increment value: '${incrS}'`);
  if (fmt !== undefined && equal) return usage('format string may not be specified when printing equal width strings');
  if (fmt !== undefined) {
    const specs = fmt.replace(/%%/g, '').match(/%[-+ #0'I]*\d*(?:\.\d*)?[a-zA-Z]/g) ?? [];
    if (specs.length !== 1) return fail(ctx, specs.length ? `format '${fmt}' has too many % directives` : `format '${fmt}' has no % directive`);
    if (!/[aAeEfFgG]$/.test(specs[0])) return fail(ctx, `format '${fmt}' has unknown ${specs[0]} directive`);
  }
  const prec = Math.max(precision(firstS), precision(incrS));
  let show = fmt !== undefined ? (x: number) => format(fmt, [String(x)]) : (x: number) => x.toFixed(prec);
  if (equal) {
    const width = Math.max(show(first).length, show(last).length);
    const plain = show;
    show = (x) => {
      const s = plain(x);
      return s.startsWith('-') ? `-${s.slice(1).padStart(width - 1, '0')}` : s.padStart(width, '0');
    };
  }
  const lastText = show(last);
  let out = '';
  let prev = '';
  let count = 0;
  for (let i = 0; ; i++) {
    const x = first + i * incr;
    let s = '';
    if (incr > 0 ? x > last : x < last) {
      s = show(x);
      if (s !== lastText || s === prev) break;
    }
    s ||= show(x);
    out += (count++ ? sep : '') + s;
    prev = s;
    if (out.length > 16384) {
      ctx.stdout.write(out);
      out = '';
      await pause(ctx);
    }
  }
  ctx.stdout.write(count ? `${out}\n` : out);
  return 0;
}

export const seqCommands: CommandTable = {
  seq: { fn: command(seq), desc: 'print a sequence of numbers' },
};
