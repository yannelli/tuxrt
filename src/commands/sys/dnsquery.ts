import { arpa, currentDns, DnsFailure } from '../../platform/dns.ts';
import type { Ctx } from '../types.ts';
import { hostname } from './info.ts';
import { hostsFile, localLookup } from './probe.ts';

export const TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR'];
export const STUB = '127.0.0.53';

export interface Answer {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

export { arpa, DnsFailure };

export const RCODES: Record<string, number> = { SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 };

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

/** Records of one type for `name` (an IP address for PTR). NODATA is an empty list. */
export async function query(ctx: Ctx, server: string | undefined, name: string, type: string, local: boolean): Promise<Answer[]> {
  const bare = name.replace(/\.$/, '') || '.';
  const synthesized = local ? synthesize(ctx, bare, type) : null;
  if (synthesized) return synthesized;
  const records = await currentDns().query(bare, type, server);
  return records.map((r) => ({ name: type === 'PTR' ? arpa(bare) : bare, type, ttl: r.ttl, data: r.data }));
}

/** Follows one CNAME, returning the alias records and the name to query next. */
export async function follow(ctx: Ctx, server: string | undefined, name: string, local: boolean): Promise<{ aliases: Answer[]; target: string }> {
  const aliases = await query(ctx, server, name, 'CNAME', local);
  return { aliases, target: aliases.length ? aliases[0].data.replace(/\.$/, '') : name };
}
