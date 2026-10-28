import { errMessage, FsError } from "../vfs/errors.ts";
import { readAll } from "../shell/io.ts";
import type { Ctx } from "./types.ts";
import { platform } from "../platform/index.ts";
import type { AbortSignal } from "../platform/abort.ts";

export interface OptSpec {
  /** Single-letter boolean flags, e.g. "alhR". */
  flags?: string;
  /** Single-letter flags that take a value, e.g. "nc". */
  values?: string;
  /** Long option -> short letter (or itself when it has no short form). Suffix "=" for valued options. */
  long?: Record<string, string>;
}

export interface Parsed {
  opts: Record<string, string | true>;
  operands: string[];
}

export class UsageError extends Error {}

/** getopt-style parsing: bundled flags (-la), attached values (-n5), --long[=value], and `--`. */
export function parseArgs(args: string[], spec: OptSpec): Parsed {
  const flags = spec.flags ?? "";
  const values = spec.values ?? "";
  const opts: Record<string, string | true> = {};
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      const key = Object.keys(spec.long ?? {}).find(
        (k) => k.replace(/=$/, "") === name,
      );
      if (!key) throw new UsageError(`unrecognized option '${a}'`);
      const target = spec.long![key];
      if (key.endsWith("=")) {
        const v = inline ?? args[++i];
        if (v === undefined)
          throw new UsageError(`option '--${name}' requires an argument`);
        opts[target] = v;
      } else opts[target] = inline ?? true;
      continue;
    }
    if (a.length < 2 || a[0] !== "-") {
      operands.push(a);
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (values.includes(c)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (v === undefined)
          throw new UsageError(`option requires an argument -- '${c}'`);
        opts[c] = v;
        break;
      }
      if (!flags.includes(c)) throw new UsageError(`invalid option -- '${c}'`);
      opts[c] = true;
    }
  }
  return { opts, operands };
}

/** Wraps a command body: usage errors exit 2, other errors print "name: msg" and exit 1. */
export function command(fn: (ctx: Ctx) => Promise<number> | number) {
  return async (ctx: Ctx): Promise<number> => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof UsageError) {
        ctx.stderr.write(
          `${ctx.name}: ${e.message}\nTry '${ctx.name} --help' for more information.\n`,
        );
        return 2;
      }
      throw e;
    }
  };
}

export function fail(ctx: Ctx, msg: string): number {
  ctx.stderr.write(`${ctx.name}: ${msg}\n`);
  return 1;
}

export function fsFail(ctx: Ctx, path: string, e: unknown, verb = ""): number {
  const msg = e instanceof FsError ? e.message : errMessage(e);
  return fail(ctx, verb ? `${verb} '${path}': ${msg}` : `${path}: ${msg}`);
}

export function abs(ctx: Ctx, path: string): string {
  return ctx.shell.abs(path);
}

/** Reads each named file (or stdin for none / "-"), reporting errors like coreutils. */
export async function readInputs(
  ctx: Ctx,
  files: string[],
  each: (text: string, name: string) => void | Promise<void>,
): Promise<number> {
  let status = 0;
  for (const f of files.length ? files : ["-"]) {
    let text: string;
    try {
      text =
        f === "-" ? await readAll(ctx.stdin) : ctx.vfs.readFile(abs(ctx, f));
    } catch (e) {
      status = fsFail(ctx, f, e);
      continue;
    }
    await each(text, f);
  }
  return status;
}

export async function readInput(
  ctx: Ctx,
  files: string[],
): Promise<{ text: string; status: number }> {
  let text = "";
  const status = await readInputs(ctx, files, (t) => {
    text += t;
  });
  return { text, status };
}

/** Splits text into lines, dropping the empty string after a trailing newline. */
export function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (out.at(-1) === "") out.pop();
  return out;
}

export function humanSize(bytes: number, si = false): string {
  const unit = si ? 1000 : 1024;
  if (bytes < unit) return String(bytes);
  const units = "KMGTPE";
  let n = bytes;
  let i = -1;
  do {
    n /= unit;
    i++;
  } while (n >= unit && i < units.length - 1);
  return `${n < 10 ? Math.ceil(n * 10) / 10 : Math.ceil(n)}${units[i]}`;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = platform.setTimeout(done, ms);
    function done() {
      platform.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Shell-builtin style error: "bash: cd: msg". */
export function bfail(ctx: Ctx, msg: string, code = 1): number {
  ctx.stderr.write(`${ctx.shell.argv0}: ${ctx.name}: ${msg}\n`);
  return code;
}
