import { Interrupt } from '../../shell/control.ts';
import { lineReader, readAll, type Reader } from '../../shell/io.ts';
import type { Ctx } from '../types.ts';
import { abs, fsFail } from '../util.ts';
import { platform } from '../../platform/index.ts';
import { latin1, utf8Decode } from '../../vfs/bytes.ts';

export interface LineSource {
  /** Next line including its "\n" (absent on an unterminated last line), or null at EOF. */
  next(): Promise<string | null>;
}

/** Yields stdin as it arrives, starting with anything a line reader already buffered. */
export async function* chunks(reader: Reader): AsyncGenerator<string> {
  const pending = lineReader(reader).drain();
  if (pending) yield pending;
  for (let c = await reader.read(); c !== null; c = await reader.read()) yield c;
}

/** Splits text into lines that keep their "\n". */
export function splitKeep(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/);
}

export function chomp(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

export function textLines(text: string): LineSource {
  const all = splitKeep(text);
  let i = 0;
  return { next: async () => all[i++] ?? null };
}

/** Reads a whole input ("-" = stdin). Prints "cmd: f: error" and returns null on failure. */
export async function readText(ctx: Ctx, f: string): Promise<string | null> {
  try {
    return f === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
  } catch (e) {
    fsFail(ctx, f, e);
    return null;
  }
}

/** Opens an input as a line source; stdin streams so infinite producers work. */
export function openLines(ctx: Ctx, f: string): LineSource | null {
  if (f === '-') return lineReader(ctx.stdin);
  try {
    return textLines(ctx.vfs.readFile(abs(ctx, f)));
  } catch (e) {
    fsFail(ctx, f, e);
    return null;
  }
}

/** Streams every line of every input to `fn`; returning false skips the rest of that input. */
export async function eachLine(ctx: Ctx, files: string[], fn: (line: string, file: string) => unknown): Promise<number> {
  let status = 0;
  for (const f of files.length ? files : ['-']) {
    const src = openLines(ctx, f);
    if (!src) {
      status = 1;
      continue;
    }
    for (let l = await src.next(); l !== null; l = await src.next()) if ((await fn(l, f)) === false) break;
  }
  return status;
}

/** Lets other pipeline stages run, and stops on Ctrl-C / kill. */
export async function pause(ctx: Ctx): Promise<void> {
  await ctx.stdout.drain?.();
  await platform.yield();
  if (ctx.signal.aborted) throw new Interrupt(128 + (Number(ctx.signal.reason) || 2));
}

export { isBinary as isRaw, toBytes } from '../../vfs/bytes.ts';

export function fromBytes(b: Uint8Array, raw: boolean): string {
  return raw ? latin1(b) : utf8Decode(b);
}

export function displayName(f: string): string {
  return f === '-' ? 'standard input' : f;
}
