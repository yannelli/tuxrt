import { ansiC } from '../../shell/expand.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { bfail } from '../util.ts';

const SPEC = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfgGcsbq%])/g;

function toNumber(s: string | undefined): number {
  if (s === undefined || s === '') return 0;
  if (/^['"]/.test(s)) return s.codePointAt(1) ?? 0;
  const n = /^[-+]?0[xX]/.test(s) ? parseInt(s, 16) : /^[-+]?0\d/.test(s) ? parseInt(s, 8) : Number(s);
  if (Number.isNaN(n)) throw new Error(`${s}: invalid number`);
  return n;
}

function pad(s: string, flags: string, width: number): string {
  if (s.length >= width) return s;
  if (flags.includes('-')) return s.padEnd(width);
  if (flags.includes('0') && /^[-+]?\d/.test(s)) {
    const sign = /^[-+]/.test(s) ? s[0] : '';
    return sign + s.slice(sign.length).padStart(width - sign.length, '0');
  }
  return s.padStart(width);
}

/** Formats like printf(1). Returns the output; reuses the format while arguments remain. */
export function format(fmt: string, args: string[]): string {
  let out = '';
  let i = 0;
  const next = () => args[i++];
  do {
    const start = i;
    let stop = false;
    out += ansiC(fmt).replace(SPEC, (_all, flags: string, w?: string, p?: string, conv?: string) => {
      if (conv === '%') return '%';
      if (stop) return '';
      const width = w === '*' ? toNumber(next()) : Number(w ?? 0);
      const prec = p === '*' ? toNumber(next()) : p === undefined ? undefined : Number(p);
      const arg = next();
      let s: string;
      switch (conv) {
        case 'd':
        case 'i': {
          const n = Math.trunc(toNumber(arg));
          s = (n >= 0 && flags.includes('+') ? '+' : n >= 0 && flags.includes(' ') ? ' ' : '') + String(n);
          break;
        }
        case 'u': s = String(Math.abs(Math.trunc(toNumber(arg)))); break;
        case 'o': s = (flags.includes('#') ? '0' : '') + Math.trunc(toNumber(arg)).toString(8); break;
        case 'x': s = (flags.includes('#') ? '0x' : '') + Math.trunc(toNumber(arg)).toString(16); break;
        case 'X': s = (flags.includes('#') ? '0X' : '') + Math.trunc(toNumber(arg)).toString(16).toUpperCase(); break;
        case 'f': s = toNumber(arg).toFixed(prec ?? 6); break;
        case 'e':
        case 'E': s = toNumber(arg).toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
        case 'g':
        case 'G': s = String(Number(toNumber(arg).toPrecision(prec || 6))); break;
        case 'c': s = (arg ?? '').charAt(0); break;
        case 'b': {
          const raw = arg ?? '';
          const cut = raw.indexOf('\\c');
          s = ansiC(cut === -1 ? raw : raw.slice(0, cut));
          if (cut !== -1) stop = true;
          break;
        }
        case 'q': s = /^[\w./-]+$/.test(arg ?? '') ? (arg ?? "''") : `'${(arg ?? '').replace(/'/g, "'\\''")}'`; break;
        default: s = arg ?? '';
      }
      if (prec !== undefined && (conv === 's' || conv === 'b')) s = s.slice(0, prec);
      return pad(s, flags, width);
    });
    if (stop || i === start) break;
  } while (i < args.length);
  return out;
}

function printf(ctx: Ctx): number {
  let args = ctx.args;
  let target: string | undefined;
  if (args[0] === '-v') {
    target = args[1];
    args = args.slice(2);
  }
  if (args[0] === '--') args = args.slice(1);
  if (!args.length) return bfail(ctx, 'usage: printf [-v var] format [arguments]', 2);
  let out: string;
  try {
    out = format(args[0], args.slice(1));
  } catch (e) {
    return bfail(ctx, (e as Error).message);
  }
  if (target) ctx.shell.set(target, out);
  else ctx.stdout.write(out);
  return 0;
}

export const printfBuiltins: CommandTable = {
  printf: { fn: printf, builtin: true, stub: true, desc: 'Formats and prints arguments under control of the format' },
};
