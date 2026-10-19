import { AbortController } from './abort.ts';
import { utf8Decode } from '../vfs/bytes.ts';
import type { Http } from './http.ts';
import { platform } from './index.ts';

export interface DnsRecord {
  data: string;
  ttl: number;
}

/** A failed query, named by its DNS rcode: NXDOMAIN, SERVFAIL, REFUSED, or TIMEOUT when no server answered. */
export class DnsFailure extends Error {}

export interface Dns {
  /** Addresses for `host` (family 0 = both); NXDOMAIN when it has none. */
  lookup(host: string, family: 0 | 4 | 6): Promise<string[]>;
  /** Records of one type, formatted as dig prints them. PTR takes an IP address. NODATA is an empty list. */
  query(name: string, type: string, server?: string): Promise<DnsRecord[]>;
}

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const OFFLINE: Dns = {
  lookup: () => Promise.reject(new DnsFailure('TIMEOUT')),
  query: () => Promise.reject(new DnsFailure('TIMEOUT')),
};

/** The platform resolver, or one that times out like a machine with no network. */
export function currentDns(): Dns {
  return platform.dns ?? OFFLINE;
}

export function isIP(s: string): 0 | 4 | 6 {
  if (V4.test(s)) return 4;
  const parts = s.split('::');
  if (parts.length > 2) return 0;
  const groups = parts.flatMap((p) => (p ? p.split(':') : []));
  if (groups.length && V4.test(groups[groups.length - 1])) groups.splice(-1, 1, '0', '0');
  if (!groups.every((g) => /^[\da-f]{1,4}$/i.test(g))) return 0;
  return (parts.length === 2 ? groups.length < 8 : groups.length === 8) ? 6 : 0;
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

const TYPE_CODES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };
const RCODE_NAMES: Record<number, string> = { 2: 'SERVFAIL', 3: 'NXDOMAIN', 5: 'REFUSED' };
const DOH = 'https://cloudflare-dns.com/dns-query';
const TIMEOUT_MS = 5000;

/** DNS over HTTPS (RFC 8484 JSON form): the fallback resolver when the host has fetch but no sockets. */
export function dnsOverHttps(http: Http): Dns {
  const query = async (name: string, type: string): Promise<DnsRecord[]> => {
    const qname = type === 'PTR' && isIP(name) ? arpa(name) : name;
    const c = new AbortController();
    const timer = platform.setTimeout(() => c.abort(), TIMEOUT_MS);
    let body: { Status: number; Answer?: { type: number; TTL: number; data: string }[] };
    try {
      const res = await http(`${DOH}?name=${encodeURIComponent(qname)}&type=${type}`, { headers: { accept: 'application/dns-json' }, redirect: 'follow', signal: c.signal });
      body = JSON.parse(utf8Decode(new Uint8Array(await res.arrayBuffer())));
    } catch {
      throw new DnsFailure('TIMEOUT');
    } finally {
      platform.clearTimeout(timer);
    }
    if (body.Status !== 0) throw new DnsFailure(RCODE_NAMES[body.Status] ?? 'SERVFAIL');
    return (body.Answer ?? []).filter((a) => a.type === TYPE_CODES[type]).map((a) => ({ data: a.data, ttl: a.TTL }));
  };
  return {
    query,
    async lookup(host, family) {
      const types = family === 4 ? ['A'] : family === 6 ? ['AAAA'] : ['A', 'AAAA'];
      const found = (await Promise.all(types.map((t) => query(host, t)))).flat().map((r) => r.data);
      if (!found.length) throw new DnsFailure('NXDOMAIN');
      return found;
    },
  };
}
