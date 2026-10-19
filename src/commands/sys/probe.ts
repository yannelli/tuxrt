import type { AbortSignal } from '../../platform/abort.ts';
import { currentDns, DnsFailure, isIP } from '../../platform/dns.ts';
import { platform, type Probe } from '../../platform/index.ts';
import { http, requestSignal } from '../extra/net/argv.ts';
import type { Ctx } from '../types.ts';
import { hostname } from './info.ts';

export type Family = 4 | 6;

/** glibc's wording for a failed lookup. */
export class ResolveError extends Error {}

export function hostsFile(ctx: Ctx): [string, string[]][] {
  return ctx.vfs
    .readFile('/etc/hosts')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim().split(/\s+/))
    .filter(([addr, ...names]) => isIP(addr) && names.length)
    .map(([addr, ...names]) => [addr, names]);
}

/** Answers from /etc/hosts or for our own names, the way systemd-resolved does, without the network. */
export function localLookup(ctx: Ctx, host: string, family: Family): string | undefined {
  const entry = hostsFile(ctx).find(([addr, names]) => names.includes(host) && isIP(addr) === family);
  if (entry) return entry[0];
  if (host === 'localhost' || host === hostname(ctx)) return family === 4 ? '127.0.0.1' : '::1';
  return undefined;
}

export async function resolveHost(ctx: Ctx, host: string, family: Family): Promise<string> {
  const literal = isIP(host);
  if (literal) {
    if (literal !== family) throw new ResolveError('Address family for hostname not supported');
    return host;
  }
  const local = localLookup(ctx, host, family);
  if (local) return local;
  try {
    return (await currentDns().lookup(host, family))[0];
  } catch (e) {
    const missing = e instanceof DnsFailure && e.message === 'NXDOMAIN';
    throw new ResolveError(missing ? 'Name or service not known' : 'Temporary failure in name resolution');
  }
}

export function isLocal(address: string): boolean {
  return address.startsWith('127.') || address === '::1' || address === '10.0.2.15';
}

/** Reverse name for display; falls back to the address itself, like iputils. */
export async function reverseName(ctx: Ctx, address: string): Promise<string> {
  const local = hostsFile(ctx).find(([addr]) => addr === address);
  if (local) return local[1][0];
  if (isLocal(address)) return address;
  try {
    return (await currentDns().query(address, 'PTR'))[0]?.data.replace(/\.$/, '') ?? address;
  } catch {
    return address;
  }
}

/** Without sockets, an HTTP HEAD to the address stands in for the handshake; any response counts as a reply. */
async function httpOnce(address: string, ms: number, signal: AbortSignal): Promise<Probe> {
  if (ms <= 0 || signal.aborted) return 'timeout';
  const start = platform.now();
  const req = requestSignal(signal, ms);
  try {
    await http(`http://${isIP(address) === 6 ? `[${address}]` : address}/`, { method: 'HEAD', redirect: 'manual', signal: req.signal });
    return platform.now() - start;
  } catch {
    return req.timedOut() || signal.aborted ? 'timeout' : 'error';
  } finally {
    req.release();
  }
}

function connectOnce(address: string, port: number, ms: number, signal: AbortSignal): Promise<Probe> {
  if (ms <= 0 || signal.aborted) return Promise.resolve('timeout');
  return platform.connect ? platform.connect(address, port, ms, signal) : httpOnce(address, ms, signal);
}

/** One echo request, timed as a TCP handshake (443, then 80) since raw ICMP sockets are unavailable. */
export async function probe(address: string, timeoutMs: number, signal: AbortSignal): Promise<number | null> {
  if (isLocal(address)) return 0.015 + Math.random() * 0.04;
  const deadline = platform.now() + timeoutMs;
  for (const port of platform.connect ? [443, 80] : [80]) {
    // A refused connection still proves the host answered, so it counts as a reply.
    const r = await connectOnce(address, port, deadline - platform.now(), signal);
    if (typeof r === 'number') return r;
    if (r === 'timeout') return null;
  }
  return null;
}

/** iputils' millisecond formatting: three significant decimals for small values. */
export const ms = (t: number) => (t < 1 ? t.toFixed(3) : t < 10 ? t.toFixed(2) : t < 100 ? t.toFixed(1) : t.toFixed(0));
