import { AbortController, AbortSignal } from '../../../platform/abort.ts';
import { NetError, type HttpRequest, type HttpResponse } from '../../../platform/http.ts';
import { platform } from '../../../platform/index.ts';
import { URL, type Url } from '../../../platform/url.ts';

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

/** errno-style code of a failed request, or '' when the platform could not tell. */
export function causeCode(e: unknown): string {
  return e instanceof NetError ? e.code : '';
}

/** The platform's HTTP client; without one, requests fail the way they do on a machine with no network. */
export function http(url: string, req: HttpRequest): Promise<HttpResponse> {
  if (!platform.http) return Promise.reject(new NetError('EAI_AGAIN', 'Temporary failure in name resolution'));
  return platform.http(url, req);
}

export const DNS_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL']);

export function withScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function defaultPort(url: Url): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

export function abortCode(signal: AbortSignal): number {
  return 128 + (Number(signal.reason) || 2);
}

/** Per-request signal: the job's signal, an optional timeout, and a controller to release the body afterwards. */
export function requestSignal(parent: AbortSignal, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = ms > 0 ? platform.setTimeout(() => ((timedOut = true), controller.abort(new Error('timeout'))), ms) : null;
  const release = () => (platform.clearTimeout(timer), controller.abort());
  return { signal: AbortSignal.any([parent, controller.signal]), release, timedOut: () => timedOut };
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

export function parseUrl(raw: string, base?: Url): Url | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}
