import { isLValue, isRef, type Expr, type GetlineExpr, type Ref } from './ast.ts';
import type { Evaluator } from './eval.ts';
import { sprintf } from './format.ts';
import { splitFields, splitRegex } from './records.ts';
import { compile } from './regex.ts';
import { AwkArray, strnum, toNum, UNINIT, type Val } from './value.ts';

const RECORD: Expr = { k: 'field', e: { k: 'num', v: 0 } };
const MATH: Record<string, (x: number) => number> = { sin: Math.sin, cos: Math.cos, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, int: Math.trunc };

function arrayArg(ev: Evaluator, e: Expr | undefined, fn: string): Ref {
  if (!e || !isRef(e)) throw ev.fatal(`${fn}: second argument must be an array name`);
  return e;
}

export async function callBuiltin(ev: Evaluator, name: string, args: Expr[]): Promise<Val> {
  const arg = async (i: number): Promise<Val> => (args[i] ? ev.ev(args[i]) : UNINIT);
  const num = async (i: number) => toNum(await arg(i));
  const str = async (i: number) => ev.str(await arg(i));
  switch (name) {
    case 'length': {
      if (!args.length) return ev.record.length;
      const cur = isRef(args[0]) ? ev.peek(args[0]) : undefined;
      return cur instanceof AwkArray ? cur.m.size : (await str(0)).length;
    }
    case 'substr': {
      const s = await str(0);
      const m = await num(1);
      const n = args.length > 2 ? await num(2) : Infinity;
      const start = Math.max(Math.round(m), 1);
      const end = Math.min(Number.isNaN(n) ? 0 : Math.round(m + n), s.length + 1);
      return end > start ? s.slice(start - 1, end - 1) : '';
    }
    case 'index': {
      const s = await str(0);
      const t = await str(1);
      return t === '' ? 0 : s.indexOf(t) + 1;
    }
    case 'split': {
      const s = await str(0);
      const ref = arrayArg(ev, args[1], 'split');
      const sep = args[2];
      const parts = !sep ? splitFields(s, ev.fs) : sep.k === 'regex' ? splitRegex(s, sep.src) : splitFields(s, await str(2));
      const a = ev.array(ref);
      a.m.clear();
      parts.forEach((p, i) => a.m.set(String(i + 1), strnum(p)));
      return parts.length;
    }
    case 'sub':
    case 'gsub':
      return substitute(ev, name === 'gsub', args);
    case 'match':
      return match(ev, await str(0), await ev.regexSource(args[1]), args[2]);
    case 'sprintf': {
      const vals: Val[] = [];
      for (const a of args) vals.push(await ev.ev(a));
      return sprintf(ev.str(vals[0] ?? ''), vals.slice(1), ev.convfmt);
    }
    case 'atan2': {
      const y = await num(0);
      return Math.atan2(y, await num(1));
    }
    case 'rand':
      return ev.rand();
    case 'srand':
      return ev.srand(args.length ? await num(0) : undefined);
    case 'tolower':
      return (await str(0)).toLowerCase();
    case 'toupper':
      return (await str(0)).toUpperCase();
    case 'system':
      return ev.streams.system(await str(0));
    case 'close':
      return ev.streams.close(await str(0));
    case 'fflush':
      return 0;
  }
  return MATH[name](await num(0));
}

async function match(ev: Evaluator, s: string, src: string, arrExpr: Expr | undefined): Promise<Val> {
  const m = compile(src).exec(s);
  const start = m ? m.index + 1 : 0;
  ev.setVar('RSTART', start);
  ev.setVar('RLENGTH', m ? m[0].length : -1);
  if (arrExpr) {
    const a = ev.array(arrayArg(ev, arrExpr, 'match'));
    a.m.clear();
    let at = m ? m.index : 0;
    m?.forEach((g, i) => {
      if (g === undefined) return;
      // JS exposes no group offsets without the "d" flag; locate each group after the previous one.
      const pos = i === 0 ? m.index : s.indexOf(g, at);
      if (i > 0) at = pos;
      a.m.set(String(i), strnum(g));
      a.m.set(`${i}${ev.subsep}start`, pos + 1);
      a.m.set(`${i}${ev.subsep}length`, g.length);
    });
  }
  return start;
}

function expandReplacement(repl: string, matched: string): string {
  if (!repl.includes('&') && !repl.includes('\\')) return repl;
  let out = '';
  for (let i = 0; i < repl.length; i++) {
    const c = repl[i];
    if (c === '\\' && (repl[i + 1] === '&' || repl[i + 1] === '\\')) out += repl[++i];
    else out += c === '&' ? matched : c;
  }
  return out;
}

async function substitute(ev: Evaluator, global: boolean, args: Expr[]): Promise<Val> {
  const src = await ev.regexSource(args[0]);
  const repl = ev.str(args[1] ? await ev.ev(args[1]) : UNINIT);
  const target = args[2] ?? RECORD;
  if (!isLValue(target)) throw ev.fatal(`${global ? 'gsub' : 'sub'}: third argument is not a changeable object`);
  const loc = await ev.loc(target);
  const s = ev.str(loc.get());
  const re = compile(src, true);
  let out = '';
  let pos = 0;
  let count = 0;
  let lastEnd = -1;
  while (pos <= s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) break;
    const start = m.index;
    const end = start + m[0].length;
    if (start === end && start === lastEnd) {
      // An empty match right after the previous match does not count; step over one char.
      if (start >= s.length) break;
      out += s.slice(pos, start + 1);
      pos = start + 1;
      continue;
    }
    out += s.slice(pos, start) + expandReplacement(repl, m[0]);
    count++;
    lastEnd = end;
    if (end > start) pos = end;
    else {
      out += s.slice(start, start + 1);
      pos = start + 1;
    }
    if (!global) break;
  }
  if (!count) return 0;
  loc.set(out + s.slice(pos));
  return count;
}

export async function getline(ev: Evaluator, e: GetlineExpr): Promise<Val> {
  let rec: string | null;
  if (e.from === 'main') rec = await ev.nextMainRecord();
  else {
    const name = ev.str(await ev.ev(e.src!));
    const src = e.from === 'file' ? ev.streams.fileInput(name) : ev.streams.cmdInput(name);
    if (!src) return -1;
    rec = await src.next(ev.rs);
  }
  if (rec === null) return 0;
  if (e.from !== 'file') ev.incr('NR');
  if (e.from === 'main') ev.incr('FNR');
  if (e.target) (await ev.loc(e.target)).set(strnum(rec));
  else ev.setRecord(rec);
  return 1;
}
