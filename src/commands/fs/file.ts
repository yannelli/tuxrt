import type { Stat } from '../../vfs/types.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { DEVICES, msgOf, usage } from './common.ts';
import { DIGESTS } from '../../lib/digest.ts';
import { utf8Encode } from '../../vfs/bytes.ts';

const MAGIC: [string, string][] = [
  ['\x7fELF', 'elf'],
  ['\x1f\x8b', 'gzip compressed data'],
  ['PK\x03\x04', 'Zip archive data'],
  ['\x89PNG', 'PNG image data'],
  ['BZh', 'bzip2 compressed data'],
  ['\xfd7zXZ', 'XZ compressed data'],
];

const INTERPRETERS: Record<string, string> = {
  bash: 'Bourne-Again shell script',
  sh: 'POSIX shell script',
  dash: 'POSIX shell script',
  zsh: "Paul Falstad's zsh script",
  python: 'Python script',
  python3: 'Python script',
  node: 'Node.js script',
  perl: 'Perl script',
  ruby: 'Ruby script',
};

function elf(data: string): string {
  const id = DIGESTS.sha1(utf8Encode(data));
  return `ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=${id}, for GNU/Linux 3.2.0, stripped`;
}

function textKind(data: string): string | null {
  if (/[\0-\x06\x0e-\x1a\x1c-\x1f\x7f]/.test(data)) return null;
  if (/^[\x00-\x7f]*$/.test(data)) return 'ASCII text';
  return /[\x80-\x9f]/.test(data) ? null : 'Unicode text, UTF-8 text';
}

function isJson(data: string): boolean {
  if (!/^\s*[[{]/.test(data)) return false;
  try {
    JSON.parse(data);
    return true;
  } catch {
    return false;
  }
}

function describeContent(data: string): string {
  if (data.startsWith('%PDF-')) return `PDF document, version ${data.slice(5, 8)}`;
  if (data.slice(257, 262) === 'ustar') return 'POSIX tar archive';
  for (const [magic, desc] of MAGIC) if (data.startsWith(magic)) return desc === 'elf' ? elf(data) : desc;
  const text = textKind(data);
  if (!text) return 'data';
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(data);
  let kind = text;
  if (shebang) {
    const name = shebang[1].split('/').pop()!;
    const interp = name === 'env' && shebang[2] ? shebang[2] : name;
    kind = `${INTERPRETERS[interp] ?? `a ${shebang[1]}${shebang[2] ? ` ${shebang[2]}` : ''} script`}, ${text} executable`;
  } else if (isJson(data)) return 'JSON text data';
  if (data.includes('\r\n')) kind += ', with CRLF line terminators';
  else if (!data.includes('\n')) kind += ', with no line terminators';
  return kind;
}

function describe(ctx: Ctx, op: string, follow: boolean): string {
  const { vfs } = ctx;
  const path = ctx.shell.abs(op);
  let st: Stat;
  try {
    st = vfs.stat(path, false);
  } catch (e) {
    return `cannot open \`${op}' (${msgOf(e)})`;
  }
  if (st.kind === 'symlink') {
    const target = vfs.tryLookup(path) ? vfs.stat(path) : null;
    if (!follow || !target) return `${target ? '' : 'broken '}symbolic link to ${vfs.readlink(path)}`;
    st = target;
  }
  if (st.kind === 'dir') return 'directory';
  const dev = DEVICES[vfs.realpath(path)];
  if (dev) return `character special (${dev[0]}/${dev[1]})`;
  if (!vfs.access(path, 'r')) return 'regular file, no read permission';
  if (st.size === 0) return 'empty';
  return describeContent(vfs.readFile(path));
}

function file(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'bLh',
    long: { brief: 'b', dereference: 'L', 'no-dereference': 'h' },
  });
  if (!operands.length) return usage(ctx, 'missing file operand');
  const width = Math.max(...operands.map((o) => o.length));
  for (const op of operands) {
    const desc = describe(ctx, op, !!opts.L);
    ctx.stdout.write(opts.b ? `${desc}\n` : `${op}:${' '.repeat(width - op.length)} ${desc}\n`);
  }
  return 0;
}

export const fileCommands: CommandTable = {
  file: { desc: 'determine file type', fn: command(file) },
};
