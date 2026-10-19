import { webcrypto } from 'node:crypto';
import { promisify } from 'node:util';
import { machine } from '../../../vfs/machine.ts';
import { NODE_VERSION } from './errors.ts';
import type { NodeRuntime } from './runtime.ts';

type Fn = (...args: unknown[]) => unknown;

// Web platform globals that hold no host handles; MessageChannel, BroadcastChannel and WebSocket are left out.
const WEB = [
  'AbortController', 'AbortSignal', 'Blob', 'Buffer', 'CompressionStream', 'DecompressionStream', 'DOMException',
  'Event', 'EventTarget', 'File', 'FormData', 'Headers', 'ReadableStream', 'Request', 'Response', 'TextDecoder',
  'TextDecoderStream', 'TextEncoder', 'TextEncoderStream', 'TransformStream', 'URL', 'URLSearchParams',
  'WritableStream', 'atob', 'btoa', 'performance', 'structuredClone',
];
const BODY_READERS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'];

function sandboxCrypto(rt: NodeRuntime) {
  const host = webcrypto.subtle as unknown as Record<string, Fn>;
  const subtle: Record<string, Fn> = {};
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(webcrypto.subtle))) {
    if (name !== 'constructor') subtle[name] = (...args) => rt.loop.track(host[name](...args) as Promise<unknown>, rt.realm.Promise);
  }
  return {
    getRandomValues: <T extends ArrayBufferView>(array: T) => webcrypto.getRandomValues(array as unknown as Uint8Array) as unknown as T,
    randomUUID: () => webcrypto.randomUUID(),
    subtle,
  };
}

/** fetch through the host, tied to the command's signal and counted as a pending handle. */
function sandboxFetch(rt: NodeRuntime) {
  return (input: unknown, init?: RequestInit) => {
    const signal = init?.signal ? AbortSignal.any([init.signal, rt.ctx.signal]) : rt.ctx.signal;
    const response = fetch(input as string, { ...init, signal }).then((res) => {
      for (const name of BODY_READERS) {
        const read = (res as unknown as Record<string, Fn>)[name];
        if (typeof read !== 'function') continue;
        Object.defineProperty(res, name, {
          configurable: true,
          value: (...args: unknown[]) => rt.loop.track(read.apply(res, args) as Promise<unknown>, rt.realm.Promise),
        });
      }
      return res;
    });
    return rt.loop.track(response, rt.realm.Promise);
  };
}

export function createGlobals(rt: NodeRuntime): Record<string, unknown> {
  const { loop } = rt;
  const g: Record<string, unknown> = {};
  for (const name of WEB) if (name in globalThis) g[name] = (globalThis as Record<string, unknown>)[name];
  const later = (kind: 'timeout' | 'immediate', ms: unknown, value: unknown) =>
    new rt.realm.Promise((resolve) => loop.schedule(kind, () => resolve(value), ms, []));
  const setTimeout = Object.assign((fn: unknown, ms?: unknown, ...args: unknown[]) => loop.schedule('timeout', fn, ms, args), {
    [promisify.custom]: (ms: unknown, value: unknown) => later('timeout', ms, value),
  });
  const setImmediate = Object.assign((fn: unknown, ...args: unknown[]) => loop.schedule('immediate', fn, 0, args), {
    [promisify.custom]: (value: unknown) => later('immediate', 0, value),
  });
  const clear = (t: unknown) => loop.clear(t);
  return Object.assign(g, {
    console: rt.console,
    process: rt.process,
    setTimeout,
    setInterval: (fn: unknown, ms?: unknown, ...args: unknown[]) => loop.schedule('interval', fn, ms, args),
    setImmediate,
    clearTimeout: clear,
    clearInterval: clear,
    clearImmediate: clear,
    queueMicrotask: (fn: unknown) => {
      if (typeof fn !== 'function') throw new rt.realm.TypeError('The "callback" argument must be of type function');
      queueMicrotask(() => loop.invoke(fn as Fn, undefined, []));
    },
    fetch: sandboxFetch(rt),
    crypto: sandboxCrypto(rt),
    navigator: {
      hardwareConcurrency: machine.cpus,
      language: 'en-US',
      languages: ['en-US'],
      platform: 'linux',
      userAgent: `Node.js/${NODE_VERSION.slice(1).split('.')[0]}`,
    },
    __tuxrtImport: (req: Fn, spec: unknown) =>
      new rt.realm.Promise((resolve, reject) => {
        try {
          const m = req(spec) as Record<string, unknown>;
          resolve(m && m.__esModule ? m : { ...m, default: m });
        } catch (e) {
          reject(e);
        }
      }),
  });
}
