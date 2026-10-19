import { createHash } from 'node:crypto';
import { fromBytes, toBytes } from '../../vfs/bytes.ts';
import type { CommandDef, CommandTable, Ctx } from '../types.ts';
import { command, fail, lines, parseArgs, readInput, readInputs } from '../util.ts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function parseLine(line: string): [string, string] | null {
  const gnu = /^([0-9a-fA-F]+) [ *](.+)$/.exec(line);
  if (gnu) return [gnu[1], gnu[2]];
  const bsd = /^\w+ \((.+)\) = ([0-9a-fA-F]+)$/.exec(line);
  return bsd ? [bsd[2], bsd[1]] : null;
}

async function check(ctx: Ctx, files: string[], digest: (text: string) => string, opts: Record<string, string | true>): Promise<number> {
  let bad = 0;
  let unreadable = 0;
  let malformed = 0;
  let found = 0;
  const hexLength = digest('').length;
  const status = await readInputs(ctx, files, (text, list) => {
    const before = found;
    for (const line of lines(text)) {
      const entry = parseLine(line);
      if (!entry || entry[0].length !== hexLength) {
        malformed++;
        continue;
      }
      const [hash, name] = entry;
      found++;
      let content: string;
      try {
        content = ctx.vfs.readFile(ctx.shell.abs(name));
      } catch {
        ctx.stderr.write(`${ctx.name}: ${name}: No such file or directory\n`);
        if (!opts.status) ctx.stdout.write(`${name}: FAILED open or read\n`);
        unreadable++;
        continue;
      }
      const ok = digest(content) === hash.toLowerCase();
      if (!ok) bad++;
      if (!opts.status && (!ok || !opts.quiet)) ctx.stdout.write(`${name}: ${ok ? 'OK' : 'FAILED'}\n`);
    }
    if (found === before) ctx.stderr.write(`${ctx.name}: ${list === '-' ? 'standard input' : list}: no properly formatted checksum lines found\n`);
  });
  if (!opts.status) {
    if (malformed && found) ctx.stderr.write(`${ctx.name}: WARNING: ${plural(malformed, 'line')} ${malformed === 1 ? 'is' : 'are'} improperly formatted\n`);
    if (unreadable) ctx.stderr.write(`${ctx.name}: WARNING: ${plural(unreadable, 'listed file')} could not be read\n`);
    if (bad) ctx.stderr.write(`${ctx.name}: WARNING: ${plural(bad, 'computed checksum')} did NOT match\n`);
  }
  return status || bad || unreadable || !found ? 1 : 0;
}

function hasher(algo: string, tag: string): CommandDef {
  return {
    desc: `compute and check ${tag} message digest`,
    fn: command(async (ctx) => {
      const { opts, operands } = parseArgs(ctx.args, {
        flags: 'cbtwz',
        long: { check: 'c', binary: 'b', text: 't', tag: 'tag', quiet: 'quiet', status: 'status', warn: 'w', strict: 'strict', zero: 'z' },
      });
      const digest = (text: string) => createHash(algo).update(toBytes(text)).digest('hex');
      if (opts.c) return check(ctx, operands, digest, opts);
      return readInputs(ctx, operands, (text, name) => {
        ctx.stdout.write(opts.tag ? `${tag} (${name}) = ${digest(text)}\n` : `${digest(text)}  ${name}\n`);
      });
    }),
  };
}

async function base64(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'di', values: 'w', long: { decode: 'd', 'ignore-garbage': 'i', 'wrap=': 'w' } });
  if (operands.length > 1) return fail(ctx, `extra operand ‘${operands[1]}’\nTry 'base64 --help' for more information.`);
  const wrap = opts.w === undefined ? 76 : Number(opts.w);
  if (!Number.isInteger(wrap) || wrap < 0) return fail(ctx, `invalid wrap size: ‘${opts.w}’`);
  const { text, status } = await readInput(ctx, operands);
  if (status) return status;
  if (opts.d) {
    let clean = text.replace(/\s/g, '');
    if (opts.i) clean = clean.replace(/[^A-Za-z0-9+/=]/g, '');
    const valid = /^[A-Za-z0-9+/]*={0,2}$/.test(clean) && clean.length % 4 !== 1;
    ctx.stdout.write(fromBytes(Buffer.from(valid ? clean : clean.replace(/[^A-Za-z0-9+/].*$/, ''), 'base64')));
    return valid ? 0 : fail(ctx, 'invalid input');
  }
  const encoded = toBytes(text).toString('base64');
  if (!wrap) return (ctx.stdout.write(encoded), 0);
  if (encoded) ctx.stdout.write(`${encoded.match(new RegExp(`.{1,${wrap}}`, 'g'))!.join('\n')}\n`);
  return 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  return c >>> 0;
});

/** POSIX cksum: CRC-32/CKSUM over the data followed by its length. */
function crc(bytes: Buffer): number {
  let c = 0;
  const step = (b: number) => (c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ b) & 0xff]) >>> 0);
  for (const b of bytes) step(b);
  for (let len = bytes.length; len > 0; len = Math.floor(len / 256)) step(len & 0xff);
  return ~c >>> 0;
}

function cksum(ctx: Ctx): Promise<number> {
  return readInputs(ctx, ctx.args, (text, name) => {
    const bytes = toBytes(text);
    ctx.stdout.write(`${crc(bytes)} ${bytes.length}${name === '-' && !ctx.args.length ? '' : ` ${name}`}\n`);
  });
}

export const hashCommands: CommandTable = {
  md5sum: hasher('md5', 'MD5'),
  sha1sum: hasher('sha1', 'SHA1'),
  sha224sum: hasher('sha224', 'SHA224'),
  sha256sum: hasher('sha256', 'SHA256'),
  sha384sum: hasher('sha384', 'SHA384'),
  sha512sum: hasher('sha512', 'SHA512'),
  base64: { fn: command(base64), desc: 'encode or decode base64 data' },
  cksum: { fn: cksum, desc: 'compute and verify file checksums' },
};
