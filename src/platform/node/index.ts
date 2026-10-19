import { lookup, Resolver } from 'node:dns/promises';
import { connect, isIP } from 'node:net';
import { deflateRawSync } from 'node:zlib';
import { nodeCommands } from '../../commands/extra/node/index.ts';
import type { AbortSignal } from '../abort.ts';
import { DnsFailure, type Dns, type DnsRecord } from '../dns.ts';
import { portablePlatform, type Platform, type Probe } from '../index.ts';
import { jq } from './jq.ts';

const TTL = 300;

function failure(e: unknown): DnsFailure {
  const code = (e as NodeJS.ErrnoException).code;
  return new DnsFailure(code === 'ENOTFOUND' ? 'NXDOMAIN' : code === 'ESERVFAIL' ? 'SERVFAIL' : code === 'EREFUSED' ? 'REFUSED' : 'TIMEOUT');
}

async function records(r: Resolver, name: string, type: string): Promise<DnsRecord[]> {
  const rec = (data: string, ttl = TTL): DnsRecord => ({ data, ttl });
  switch (type) {
    case 'A': return (await r.resolve4(name, { ttl: true })).map((a) => rec(a.address, a.ttl));
    case 'AAAA': return (await r.resolve6(name, { ttl: true })).map((a) => rec(a.address, a.ttl));
    case 'MX': return (await r.resolveMx(name)).sort((a, b) => a.priority - b.priority).map((m) => rec(`${m.priority} ${m.exchange}.`));
    case 'TXT': return (await r.resolveTxt(name)).map((chunks) => rec(chunks.map((c) => `"${c}"`).join(' ')));
    case 'NS': return (await r.resolveNs(name)).map((n) => rec(`${n}.`));
    case 'CNAME': return (await r.resolveCname(name)).map((n) => rec(`${n}.`));
    case 'PTR': return (await r.reverse(name)).map((n) => rec(`${n}.`));
    default: {
      const s = await r.resolveSoa(name);
      return [rec(`${s.nsname}. ${s.hostmaster}. ${s.serial} ${s.refresh} ${s.retry} ${s.expire} ${s.minttl}`)];
    }
  }
}

/** The system resolver (getaddrinfo) for lookups, and c-ares for record queries, optionally against one server. */
const dns: Dns = {
  async lookup(host, family) {
    try {
      return (await lookup(host, { family, all: true })).map((a) => a.address);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new DnsFailure(code === 'ENOTFOUND' || code === 'ENODATA' ? 'NXDOMAIN' : 'TIMEOUT');
    }
  },
  async query(name, type, server) {
    try {
      const r = new Resolver({ timeout: type === 'PTR' ? 1500 : 2500, tries: type === 'PTR' ? 1 : 2 });
      if (server) r.setServers([isIP(server) ? server : (await lookup(server)).address]);
      return await records(r, name, type);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENODATA') return [];
      throw failure(e);
    }
  },
};

function tcpConnect(host: string, port: number, ms: number, signal: AbortSignal): Promise<Probe> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = connect({ host, port });
    let settled = false;
    const done = (r: Probe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      socket.destroy();
      resolve(r);
    };
    const abort = () => done('timeout');
    const timer = setTimeout(abort, ms);
    signal.addEventListener('abort', abort, { once: true });
    socket.on('connect', () => done(performance.now() - start));
    socket.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? performance.now() - start : 'error'));
  });
}

/** Node, Bun and Deno (node: compat): real sockets and resolvers, native deflate, process stats, a worker-thread jq and `node`. */
export function nodePlatform(): Platform {
  return {
    ...portablePlatform(),
    dns,
    connect: tcpConnect,
    deflateRaw: (data, level) => deflateRawSync(data, { level }),
    heapUsed: () => process.memoryUsage().heapUsed,
    cpuUsage: () => process.cpuUsage(),
    commands: { ...nodeCommands, jq: { fn: jq, desc: 'Command-line JSON processor' } },
  };
}
