import { lookup, Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Ctx } from '../types.ts';
import { hostname } from './info.ts';
import { hostsFile, localLookup } from './probe.ts';

export const TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR'];
export const STUB = '127.0.0.53';
const TTL = 300;

export interface Answer {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

/** A failed query, named by its DNS rcode: NXDOMAIN, SERVFAIL, REFUSED, or TIMEOUT when no server answered. */
export class DnsFailure extends Error {}

export const RCODES: Record<string, number> = { SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 };

export async function resolver(server?: string): Promise<Resolver> {
  const r = new Resolver({ timeout: 2500, tries: 2 });
  if (server) r.setServers([isIP(server) ? server : (await lookup(server)).address]);
  return r;
}

function expand6(ip: string): string {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map((g) => g.padStart(4, '0')).join('');
}

export function arpa(ip: string): string {
  if (isIP(ip) === 4) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  return `${[...expand6(ip)].reverse().join('.')}.ip6.arpa`;
}

function isLocalName(ctx: Ctx, name: string): boolean {
  return name === 'localhost' || name === hostname(ctx) || hostsFile(ctx).some(([, names]) => names.includes(name));
}

/** systemd-resolved answers localhost, our hostname and /etc/hosts itself; NODATA for other types. */
function synthesize(ctx: Ctx, name: string, type: string): Answer[] | null {
  if (type === 'PTR') {
    const entry = hostsFile(ctx).find(([addr]) => addr === name);
    return entry ? [{ name: arpa(name), type, ttl: 0, data: `${entry[1][0]}.` }] : null;
  }
  if (!isLocalName(ctx, name)) return null;
  const family = type === 'A' ? 4 : type === 'AAAA' ? 6 : 0;
  const addr = family ? localLookup(ctx, name, family) : undefined;
  return addr ? [{ name, type, ttl: 0, data: addr }] : [];
}

async function fetch(r: Resolver, name: string, type: string): Promise<Answer[]> {
  const ans = (data: string, ttl = TTL): Answer => ({ name: type === 'PTR' ? arpa(name) : name, type, ttl, data });
  switch (type) {
    case 'A': return (await r.resolve4(name, { ttl: true })).map((a) => ans(a.address, a.ttl));
    case 'AAAA': return (await r.resolve6(name, { ttl: true })).map((a) => ans(a.address, a.ttl));
    case 'MX': return (await r.resolveMx(name)).sort((a, b) => a.priority - b.priority).map((m) => ans(`${m.priority} ${m.exchange}.`));
    case 'TXT': return (await r.resolveTxt(name)).map((chunks) => ans(chunks.map((c) => `"${c}"`).join(' ')));
    case 'NS': return (await r.resolveNs(name)).map((n) => ans(`${n}.`));
    case 'CNAME': return (await r.resolveCname(name)).map((n) => ans(`${n}.`));
    case 'PTR': return (await r.reverse(name)).map((n) => ans(`${n}.`));
    default: {
      const s = await r.resolveSoa(name);
      return [ans(`${s.nsname}. ${s.hostmaster}. ${s.serial} ${s.refresh} ${s.retry} ${s.expire} ${s.minttl}`)];
    }
  }
}

/** Records of one type for `name` (an IP address for PTR). NODATA is an empty list. */
export async function query(ctx: Ctx, r: Resolver, name: string, type: string, local: boolean): Promise<Answer[]> {
  const bare = name.replace(/\.$/, '') || '.';
  const synthesized = local ? synthesize(ctx, bare, type) : null;
  if (synthesized) return synthesized;
  try {
    return await fetch(r, bare, type);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENODATA') return [];
    throw new DnsFailure(code === 'ENOTFOUND' ? 'NXDOMAIN' : code === 'ESERVFAIL' ? 'SERVFAIL' : code === 'EREFUSED' ? 'REFUSED' : 'TIMEOUT');
  }
}

/** Follows one CNAME, returning the alias records and the name to query next. */
export async function follow(ctx: Ctx, r: Resolver, name: string, local: boolean): Promise<{ aliases: Answer[]; target: string }> {
  const aliases = await query(ctx, r, name, 'CNAME', local);
  return { aliases, target: aliases.length ? aliases[0].data.replace(/\.$/, '') : name };
}
