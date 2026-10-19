/** C printf numeric conversions (64-bit wrap, round-half-even, %g exponent switching), shared by printf and awk. */
export interface Piece {
  pre: string;
  body: string;
  zeroOk: boolean;
}

export function pad({ pre, body, zeroOk }: Piece, width: number, left: boolean, zero: boolean): string {
  const fill = width - pre.length - body.length;
  if (fill <= 0) return pre + body;
  if (left) return pre + body + ' '.repeat(fill);
  if (zero && zeroOk) return pre + '0'.repeat(fill) + body;
  return ' '.repeat(fill) + pre + body;
}

export function sign(neg: boolean, flags: string): string {
  return neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
}

export function integer(conv: string, flags: string, prec: number | undefined, n: number): Piece {
  if (!Number.isFinite(n)) return nonFinite(n, flags, false);
  const t = BigInt(Math.trunc(n));
  const signed = conv === 'd' || conv === 'i';
  const neg = signed && t < 0n;
  const mag = signed ? (neg ? -t : t) : BigInt.asUintN(64, t);
  let digits = mag.toString(conv === 'o' ? 8 : conv === 'x' || conv === 'X' ? 16 : 10);
  if (conv === 'X') digits = digits.toUpperCase();
  if (prec !== undefined) digits = prec === 0 && mag === 0n ? '' : digits.padStart(prec, '0');
  let pre = signed ? sign(neg, flags) : '';
  if (flags.includes('#') && mag !== 0n) {
    if (conv === 'o' && !digits.startsWith('0')) digits = `0${digits}`;
    if (conv === 'x' || conv === 'X') pre = conv === 'x' ? '0x' : '0X';
  }
  return { pre, body: digits, zeroOk: prec === undefined };
}

function nonFinite(n: number, flags: string, upper: boolean): Piece {
  const body = Number.isNaN(n) ? 'nan' : 'inf';
  return { pre: sign(n < 0, flags), body: upper ? body.toUpperCase() : body, zeroOk: false };
}

export function float(conv: string, flags: string, prec: number | undefined, n: number): Piece {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  if (!Number.isFinite(n)) return nonFinite(n, flags, upper);
  const neg = n < 0 || Object.is(n, -0);
  const x = Math.abs(n);
  const alt = flags.includes('#');
  const p = Math.min(prec ?? 6, 100);
  let body: string;
  if (conv === 'f' || conv === 'F') body = fixed(x, p) + (alt && p === 0 ? '.' : '');
  else if (conv === 'e' || conv === 'E') body = expo(x, p, alt);
  else body = general(x, p === 0 ? 1 : p, alt);
  return { pre: sign(neg, flags), body: upper ? body.toUpperCase() : body, zeroOk: true };
}

/** JS rounds exact ties up; C rounds them to even. `exact` holds enough extra digits to spot a tie. */
function roundTie(rounded: string, exact: string, keep: number): string {
  const tail = exact.slice(keep);
  if (!/^50*$/.test(tail)) return rounded;
  const head = exact.slice(0, keep).replace(/\.$/, '');
  return Number(head.at(-1)) % 2 === 0 ? head : rounded;
}

function fixed(x: number, p: number): string {
  if (x >= 1e21) return BigInt(x).toString() + (p ? `.${'0'.repeat(p)}` : '');
  const q = Math.min(100, p + 25);
  const exact = x.toFixed(q);
  return roundTie(x.toFixed(p), exact, exact.length - (q - p));
}

function expParts(x: number, p: number): [string, number] {
  const q = Math.min(100, p + 25);
  const [em, ee] = x.toExponential(q).split('e');
  const [rm, re] = x.toExponential(p).split('e');
  const mant = roundTie(rm, em, em.length - (q - p));
  return [mant, Number(mant === rm ? re : ee)];
}

function withExp(mant: string, e: number): string {
  return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
}

function expo(x: number, p: number, alt: boolean): string {
  const [mant, e] = expParts(x, p);
  return withExp(alt && p === 0 ? `${mant}.` : mant, e);
}

function general(x: number, p: number, alt: boolean): string {
  const e = x === 0 ? 0 : expParts(x, p - 1)[1];
  const strip = (s: string) => (alt || !s.includes('.') ? s : s.replace(/\.?0+$/, ''));
  if (e < -4 || e >= p) {
    const [mant] = expParts(x, p - 1);
    return withExp(strip(alt && !mant.includes('.') ? `${mant}.` : mant), e);
  }
  const s = fixed(x, p - 1 - e);
  return strip(alt && !s.includes('.') ? `${s}.` : s);
}
