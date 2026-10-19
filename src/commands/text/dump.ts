import type { CommandTable, Ctx } from '../types.ts';
import { abs, command, fail, fsFail } from '../util.ts';
import { getopt } from './args.ts';
import { readText, toBytes } from './stream.ts';
import { hexBytes, latin1, utf8Decode } from '../../vfs/bytes.ts';

interface OdType {
  kind: string;
  size: number;
  width: number;
}

const WIDTHS: Record<string, number[]> = { o: [3, 6, 0, 11, 0, 0, 0, 22], x: [2, 4, 0, 8, 0, 0, 0, 16], u: [3, 5, 0, 10, 0, 0, 0, 20], d: [4, 6, 0, 11, 0, 0, 0, 20] };
const SIZES: Record<string, number> = { C: 1, S: 2, I: 4, L: 8 };
const ESCAPES: Record<number, string> = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' };
const NAMES = 'nul soh stx etx eot enq ack bel bs ht nl vt ff cr so si dle dc1 dc2 dc3 dc4 nak syn etb can em sub esc fs gs rs us sp'.split(' ');

function parseType(spec: string): OdType[] | null {
  const out: OdType[] = [];
  const re = /([acdoux])(\d+|[CSIL])?(z?)/gy;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(spec))) {
    consumed = re.lastIndex;
    const kind = m[1] + (m[3] ? 'z' : '');
    if (m[1] === 'a' || m[1] === 'c') {
      out.push({ kind, size: 1, width: 3 });
      continue;
    }
    const size = m[2] === undefined ? 4 : SIZES[m[2]] ?? Number(m[2]);
    const width = WIDTHS[m[1]][size - 1];
    if (!width) return null;
    out.push({ kind, size, width });
  }
  return consumed === spec.length && out.length ? out : null;
}

function field(t: OdType, bytes: Uint8Array, i: number): string {
  const k = t.kind[0];
  if (k === 'c') {
    const b = bytes[i];
    return (ESCAPES[b] ?? (b >= 32 && b < 127 ? String.fromCharCode(b) : b.toString(8).padStart(3, '0'))).padStart(t.width);
  }
  if (k === 'a') {
    const b = bytes[i] & 127;
    return (b === 127 ? 'del' : b <= 32 ? NAMES[b] : String.fromCharCode(b)).padStart(t.width);
  }
  let v = 0n;
  for (let j = t.size - 1; j >= 0; j--) v = (v << 8n) | BigInt(bytes[i + j] ?? 0);
  if (k === 'd' && v >= 1n << BigInt(t.size * 8 - 1)) v -= 1n << BigInt(t.size * 8);
  if (k === 'o') return v.toString(8).padStart(t.width, '0');
  if (k === 'x') return v.toString(16).padStart(t.width, '0');
  return v.toString().padStart(t.width);
}

async function od(ctx: Ctx): Promise<number> {
  const { list, opts, operands } = getopt(ctx.args, {
    flags: 'bcdosxvi',
    values: 'AtjNw',
    long: { 'address-radix=': 'A', 'format=': 't', 'skip-bytes=': 'j', 'read-bytes=': 'N', 'output-duplicates': 'v', 'width=': 'w' },
  });
  const short: Record<string, string> = { b: 'o1', c: 'c', d: 'u2', o: 'o2', s: 'd2', x: 'x2', i: 'd4' };
  const types: OdType[] = [];
  for (const [k, v] of list) {
    const spec = k === 't' ? String(v) : short[k];
    if (!spec) continue;
    const parsed = parseType(spec);
    if (!parsed) return fail(ctx, `invalid type string '${spec}'`);
    types.push(...parsed);
  }
  if (!types.length) types.push(...parseType('o2')!);
  const radix = String(opts.A ?? 'o');
  const base = { o: 8, d: 10, x: 16, n: 0 }[radix];
  if (base === undefined) return fail(ctx, `invalid output address radix '${radix}'; it must be one character from [doxn]`);
  const addr = (n: number) => (base ? n.toString(base).padStart(base === 16 ? 6 : 7, '0') : '');
  let text = '';
  let status = 0;
  for (const f of operands.length ? operands : ['-']) {
    const t = await readText(ctx, f);
    if (t === null) status = 1;
    else text += t;
  }
  const skip = Number(opts.j ?? 0);
  let bytes = toBytes(text).subarray(skip);
  if (opts.N !== undefined) bytes = bytes.subarray(0, Number(opts.N));
  const per = opts.w === undefined ? 16 : Number(opts.w) || 32;
  let out = '';
  let prev: Uint8Array | null = null;
  let starred = false;
  for (let off = 0; off < bytes.length; off += per) {
    const row = bytes.subarray(off, off + per);
    if (!opts.v && prev && row.length === per && row.every((b, i) => b === prev![i])) {
      if (!starred) out += '*\n';
      starred = true;
      continue;
    }
    starred = false;
    prev = row;
    types.forEach((t, n) => {
      let line = n === 0 ? addr(skip + off) : ' '.repeat(addr(0).length);
      for (let i = 0; i < row.length; i += t.size) line += ` ${field(t, row, i)}`;
      if (t.kind.endsWith('z')) line += `${' '.repeat(Math.max(0, (Math.ceil(per / t.size) - Math.ceil(row.length / t.size)) * (t.width + 1)))}  >${latin1(row).replace(/[^\x20-\x7e]/g, '.')}<`;
      out += `${line}\n`;
    });
  }
  if (base) out += `${addr(skip + bytes.length)}\n`;
  ctx.stdout.write(out);
  return status;
}

function decode(buf: Uint8Array): string {
  return utf8Decode(buf, true) ?? latin1(buf);
}

async function xxd(ctx: Ctx): Promise<number> {
  const { opts, operands } = getopt(ctx.args, {
    flags: 'prubiEe',
    values: 'cglsn',
    long: { ps: 'p', plain: 'p', postscript: 'p', revert: 'r', uppercase: 'u', bits: 'b', include: 'i', 'cols=': 'c', 'groupsize=': 'g', 'len=': 'l', 'seek=': 's', 'name=': 'n' },
  });
  const [inFile = '-', outFile] = operands;
  const text = await readText(ctx, inFile);
  if (text === null) return 2;
  let output: string;
  if (opts.r) {
    const hex = opts.p ? text.replace(/[^0-9a-fA-F]/g, '') : text.split('\n').map((l) => (/^[0-9a-fA-F]+:\s?(.*?)(?: {2}.*)?$/.exec(l)?.[1] ?? '').replace(/[^0-9a-fA-F]/g, '')).join('');
    output = decode(hexBytes(hex.length % 2 ? hex.slice(0, -1) : hex));
  } else {
    const seek = Number(opts.s ?? 0);
    let bytes = toBytes(text).subarray(seek);
    if (opts.l !== undefined) bytes = bytes.subarray(0, Number(opts.l));
    const hex = (b: number) => (opts.b ? b.toString(2).padStart(8, '0') : opts.u ? b.toString(16).padStart(2, '0').toUpperCase() : b.toString(16).padStart(2, '0'));
    if (opts.p) {
      const cols = Number(opts.c ?? 30);
      const all = [...bytes].map(hex).join('');
      output = all ? `${all.match(new RegExp(`.{1,${cols * 2}}`, 'g'))!.join('\n')}\n` : '';
    } else if (opts.i) {
      const name = String(opts.n ?? (inFile === '-' ? '' : inFile)).replace(/[^a-zA-Z0-9]/g, '_');
      const cols = Number(opts.c ?? 12);
      const rows: string[] = [];
      for (let i = 0; i < bytes.length; i += cols) rows.push(`  ${[...bytes.subarray(i, i + cols)].map((b) => `0x${hex(b)}`).join(', ')}`);
      const body = rows.join(',\n');
      output = name ? `unsigned char ${name}[] = {\n${body}\n};\nunsigned int ${name}_len = ${bytes.length};\n` : `${body}\n`;
    } else {
      const cols = Number(opts.c ?? 16);
      const group = Number(opts.g ?? (opts.b ? 1 : 2)) || cols;
      const cell = opts.b ? 8 : 2;
      const hexWidth = cols * cell + Math.ceil(cols / group) - 1;
      output = '';
      for (let off = 0; off < bytes.length; off += cols) {
        const row = [...bytes.subarray(off, off + cols)];
        const groups: string[] = [];
        for (let i = 0; i < row.length; i += group) groups.push(row.slice(i, i + group).map(hex).join(''));
        const ascii = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
        output += `${(seek + off).toString(16).padStart(8, '0')}: ${groups.join(' ').padEnd(hexWidth)}  ${ascii}\n`;
      }
    }
  }
  if (!outFile) {
    ctx.stdout.write(output);
    return 0;
  }
  try {
    ctx.vfs.writeFile(abs(ctx, outFile), output);
  } catch (e) {
    return fsFail(ctx, outFile, e) + 1;
  }
  return 0;
}

export const dumpCommands: CommandTable = {
  od: { fn: command(od), desc: 'show file bytes in octal and more' },
  xxd: { fn: command(xxd), desc: 'hex dump a file, or undo one' },
};
