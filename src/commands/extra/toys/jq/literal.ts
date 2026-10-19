import { fmtNum } from './dump.ts';
import { Big } from './value.ts';

/** jq 1.7 keeps a literal's decNumber to-scientific-string form while the value passes through unmodified. */
export function literal(text: string): number | Big {
  const n = Number(text);
  const canon = canonical(text);
  return canon === fmtNum(n) ? n : new Big(canon);
}

function canonical(text: string): string {
  const [, sign, int, frac = '', exp = '0'] = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)!;
  const digits = (int + frac).replace(/^0+(?=\d)/, '');
  const e = Number(exp) - frac.length;
  const adjusted = e + digits.length - 1;
  if (e <= 0 && adjusted >= -6) {
    const point = digits.length + e;
    if (e === 0) return sign + digits;
    return sign + (point > 0 ? `${digits.slice(0, point)}.${digits.slice(point)}` : `0.${'0'.repeat(-point)}${digits}`);
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mantissa}E${adjusted >= 0 ? '+' : ''}${adjusted}`;
}
