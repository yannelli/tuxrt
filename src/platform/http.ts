import type { AbortSignal } from './abort.ts';
import type { Dns } from './dns.ts';

export interface HttpRequest {
  method?: string;
  headers?: [string, string][] | Record<string, string>;
  body?: Uint8Array;
  redirect: 'follow' | 'manual';
  signal: AbortSignal;
}

/** The parts of a fetch Response that curl and wget read. */
export interface HttpResponse {
  url: string;
  status: number;
  statusText: string;
  headers: HeaderList;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Http = (url: string, req: HttpRequest) => Promise<HttpResponse>;

/** A failed request. `code` is errno-style (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, ECONNRESET, CERT_*), or '' when the host can't tell. */
export class NetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Lower-cased response headers in arrival order; set-cookie values stay separate. */
export class HeaderList {
  private readonly list: [string, string][];

  constructor(list: [string, string][]) {
    this.list = list.map(([k, v]) => [k.toLowerCase(), v]);
  }

  get(name: string): string | null {
    const all = this.list.filter(([k]) => k === name.toLowerCase()).map(([, v]) => v);
    return all.length ? all.join(', ') : null;
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  getSetCookie(): string[] {
    return this.list.filter(([k]) => k === 'set-cookie').map(([, v]) => v);
  }

  *[Symbol.iterator](): Iterator<[string, string]> {
    const seen = new Set<string>();
    for (const [k] of [...this.list].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (seen.has(k) || k === 'set-cookie') continue;
      seen.add(k);
      yield [k, this.get(k)!];
    }
  }
}

interface HostHeaders {
  forEach(cb: (value: string, key: string) => void): void;
  getSetCookie?(): string[];
}

interface HostResponse {
  url: string;
  status: number;
  statusText: string;
  headers: HostHeaders;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type HostFetch = (url: string, init: Record<string, unknown>) => Promise<HostResponse>;
type HostAbort = new () => { signal: unknown; abort(reason?: unknown): void };

function headerList(h: HostHeaders): HeaderList {
  const list: [string, string][] = [];
  h.forEach((v, k) => {
    if (!h.getSetCookie || k.toLowerCase() !== 'set-cookie') list.push([k, v]);
  });
  for (const c of h.getSetCookie?.() ?? []) list.push(['set-cookie', c]);
  return new HeaderList(list);
}

/** undici puts the system error on `cause`; other engines give a bare TypeError, so DNS is asked to tell "no such host" apart. */
async function classify(e: unknown, url: string, dns: Dns | null): Promise<NetError> {
  const cause = (e as { cause?: { code?: string; message?: string; errors?: { code?: string }[] } } | null)?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  if (code) return new NetError(code, cause?.message ?? code);
  const host = /^[a-z]+:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url)?.[1] ?? '';
  if (dns && host && !host.startsWith('[') && !/^[\d.]+$/.test(host)) {
    try {
      await dns.lookup(host, 0);
    } catch {
      return new NetError('ENOTFOUND', `getaddrinfo ENOTFOUND ${host}`);
    }
  }
  return new NetError('', e instanceof Error ? e.message : String(e));
}

/** Adapts a WHATWG fetch (Node, Deno, Bun, browsers, or a host bridge) to the Http interface. */
export function httpOverFetch(fetch: HostFetch, Abort: HostAbort | undefined, dns: () => Dns | null): Http {
  return (url, req) =>
    new Promise((resolve, reject) => {
      if (req.signal.aborted) return reject(req.signal.reason);
      const host = Abort ? new Abort() : null;
      const onAbort = () => {
        host?.abort(req.signal.reason);
        reject(req.signal.reason);
      };
      req.signal.addEventListener('abort', onAbort, { once: true });
      const init = { method: req.method, headers: req.headers, body: req.body, redirect: req.redirect, signal: host?.signal };
      fetch(url, init)
        .then((res) => resolve({ url: res.url, status: res.status, statusText: res.statusText, headers: headerList(res.headers), arrayBuffer: () => res.arrayBuffer() }))
        .catch(async (e) => reject(req.signal.aborted ? req.signal.reason : await classify(e, url, dns())))
        .finally(() => req.signal.removeEventListener('abort', onAbort));
    });
}
