export interface ArgSpec {
  /** Single-letter boolean flags. */
  flags: string;
  /** Single-letter flags that take a value. */
  values: string;
  /** Long option -> key. Suffix "=" for valued options. */
  long: Record<string, string>;
}

export type Opt = [key: string, value: string | true];

export class ArgError extends Error {
  readonly option: string;
  readonly missing: boolean;

  constructor(option: string, missing: boolean) {
    super(missing ? `option requires an argument -- '${option}'` : `invalid option -- '${option}'`);
    this.option = option;
    this.missing = missing;
  }
}

/** getopt-style scan that keeps every occurrence in order, so repeated options (-H, -d) accumulate. */
export function scanArgs(args: string[], spec: ArgSpec): { opts: Opt[]; operands: string[] } {
  const opts: Opt[] = [];
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      const key = Object.keys(spec.long).find((k) => k.replace(/=$/, '') === name);
      if (!key) throw new ArgError(a, false);
      if (!key.endsWith('=')) opts.push([spec.long[key], true]);
      else {
        const v = inline ?? args[++i];
        if (v === undefined) throw new ArgError(a, true);
        opts.push([spec.long[key], v]);
      }
      continue;
    }
    if (a.length < 2 || a[0] !== '-') {
      operands.push(a);
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (spec.values.includes(c)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (v === undefined) throw new ArgError(c, true);
        opts.push([c, v]);
        break;
      }
      if (!spec.flags.includes(c)) throw new ArgError(c, false);
      opts.push([c, true]);
    }
  }
  return { opts, operands };
}

/** Node's fetch reports network failures as TypeError("fetch failed") with the system error as `cause`. */
export function causeCode(e: unknown): string {
  const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } } | null)?.cause;
  return cause?.code ?? cause?.errors?.[0]?.code ?? '';
}

export const DNS_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL']);

export function withScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function defaultPort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

export function abortCode(signal: AbortSignal): number {
  return 128 + (Number(signal.reason) || 2);
}

/** Per-request signal: the job's signal, an optional timeout, and a controller to release the body afterwards. */
export function requestSignal(parent: AbortSignal, ms: number) {
  const controller = new AbortController();
  const timeout = ms > 0 ? AbortSignal.timeout(ms) : null;
  const signal = AbortSignal.any(timeout ? [parent, controller.signal, timeout] : [parent, controller.signal]);
  return { signal, release: () => controller.abort(), timedOut: () => timeout?.aborted ?? false };
}

/** Races a non-abortable promise (dns lookup) against a signal. */
export function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function parseUrl(raw: string, base?: URL): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}
