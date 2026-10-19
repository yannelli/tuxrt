import type { CommandTable } from '../commands/types.ts';
import type { AbortSignal } from './abort.ts';
import { dnsOverHttps, type Dns } from './dns.ts';
import { httpOverFetch, type HostFetch, type Http } from './http.ts';

export type Probe = number | 'timeout' | 'error';

/** Everything tuxrt needs from the JS host; the core is otherwise plain ECMAScript, so hosts fill in what they can. */
export interface Platform {
  /** Monotonic milliseconds, for durations. */
  now(): number;
  random(n: number): Uint8Array;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Resolves after the host event loop has had a turn, so timers, I/O and Ctrl-C get through busy loops. */
  yield(): Promise<void>;
  /** HTTP for curl, wget and DNS-over-HTTPS; null when the host has no network. */
  http: Http | null;
  dns: Dns | null;
  /** Times a TCP handshake (a refusal counts as an answer); null when the host can't open sockets. */
  connect: ((address: string, port: number, ms: number, signal: AbortSignal) => Promise<Probe>) | null;
  /** Native raw-deflate for speed; a pure-JS encoder is used otherwise. */
  deflateRaw?(data: Uint8Array, level: number): Uint8Array;
  /** Bytes of JS heap in use, for free/top/proc. */
  heapUsed?(): number;
  /** CPU microseconds consumed by the host process, for `time`. */
  cpuUsage?(): { user: number; system: number };
  /** Extra or replacement commands, e.g. `node` and a worker-thread `jq` on Node. */
  commands?: CommandTable;
}

interface HostGlobals {
  performance?: { now(): number };
  crypto?: { getRandomValues(b: Uint8Array): Uint8Array };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  setImmediate?: (fn: () => void) => unknown;
  MessageChannel?: new () => { port1: { onmessage: (() => void) | null }; port2: { postMessage(m: unknown): void } };
  fetch?: HostFetch;
  AbortController?: new () => { signal: unknown; abort(reason?: unknown): void };
}

interface Timer {
  cancelled: boolean;
  id: unknown;
}

function missing(name: string): never {
  throw new Error(`tuxrt: the host has no ${name}; provide it with configurePlatform({ ${name} })`);
}

function yielder(g: HostGlobals): () => Promise<void> {
  if (g.setImmediate) return () => new Promise((r) => g.setImmediate!(r));
  // Browsers clamp nested setTimeout(0) to 4ms; a message round trip is not clamped.
  if (g.MessageChannel) {
    const { port1, port2 } = new g.MessageChannel();
    const queue: (() => void)[] = [];
    port1.onmessage = () => queue.shift()?.();
    return () => new Promise<void>((r) => (queue.push(r), port2.postMessage(0)));
  }
  return () => new Promise((r) => (g.setTimeout ?? missing('setTimeout'))(r, 0));
}

/** Defaults built from whatever standard globals the engine provides. */
export function portablePlatform(): Platform {
  const g = globalThis as HostGlobals;
  const clock = g.performance ?? Date;
  let dns: Dns | null = null;
  const http = g.fetch ? httpOverFetch(g.fetch.bind(globalThis), g.AbortController, () => dns) : null;
  dns = http && dnsOverHttps(http);
  return {
    now: () => clock.now(),
    random: (n) => {
      const b = new Uint8Array(n);
      if (g.crypto) return g.crypto.getRandomValues(b);
      return b.map(() => Math.floor(Math.random() * 256));
    },
    // Some hosts (the jsc shell, bare JSContext bridges) have no clearTimeout, so cancellation is tracked here too.
    setTimeout: (fn, ms) => {
      const timer: Timer = { cancelled: false, id: undefined };
      timer.id = (g.setTimeout ?? missing('setTimeout'))(() => timer.cancelled || fn(), ms);
      return timer;
    },
    clearTimeout: (h) => {
      const timer = h as Timer | undefined;
      if (!timer) return;
      timer.cancelled = true;
      g.clearTimeout?.(timer.id);
    },
    yield: yielder(g),
    http,
    dns,
    connect: null,
  };
}

export let platform: Platform = portablePlatform();

/** Overrides parts of the platform for every runtime booted afterwards (and running ones). */
export function configurePlatform(overrides: Partial<Platform>): Platform {
  const dns = overrides.http && !('dns' in overrides) ? { dns: dnsOverHttps(overrides.http) } : {};
  platform = { ...platform, ...overrides, ...dns };
  return platform;
}
