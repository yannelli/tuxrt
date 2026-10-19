import { isIP } from '../../platform/dns.ts';
import { platform } from '../../platform/index.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, parseArgs } from '../util.ts';
import { strftime } from './datefmt.ts';
import { arpa, DnsFailure, follow, query, RCODES, STUB, TYPES, type Answer } from './dnsquery.ts';

const HOST_FORMAT: Record<string, string> = {
  A: 'has address', AAAA: 'has IPv6 address', MX: 'mail is handled by', TXT: 'descriptive text', NS: 'name server',
  CNAME: 'is an alias for', SOA: 'has SOA record', PTR: 'domain name pointer',
};
const NS_FORMAT: Record<string, string> = { MX: 'mail exchanger', TXT: 'text', NS: 'nameserver', CNAME: 'canonical name', SOA: 'SOA', PTR: 'name' };

const TIMEOUT = ';; connection timed out; no servers could be reached\n';

async function host(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'avlr46CdTUsi', values: 'tcNRmW' });
  const [name, server] = operands;
  if (!name) return (ctx.stderr.write('Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n            [-R number] [-m flag] [-p port] hostname [server]\n'), 1);
  const want = typeof opts.t === 'string' ? opts.t.toUpperCase() : opts.a ? 'ANY' : null;
  if (want && want !== 'ANY' && !TYPES.includes(want)) return fail(ctx, `invalid type: ${opts.t}`);
  if (server) ctx.stdout.write(`Using domain server:\nName: ${server}\nAddress: ${server}#53\nAliases: \n\n`);
  const line = (a: Answer) => ctx.stdout.write(`${a.name} ${HOST_FORMAT[a.type]} ${a.data}\n`);
  try {
    if (isIP(name)) {
      const ptr = await query(ctx, server, name, 'PTR', !server);
      if (!ptr.length) return (ctx.stdout.write(`Host ${arpa(name)} not found: 3(NXDOMAIN)\n`), 1);
      ptr.forEach(line);
      return 0;
    }
    const { aliases, target } = await follow(ctx, server, name, !server);
    aliases.forEach(line);
    const types = want === 'ANY' ? ['A', 'AAAA', 'MX', 'TXT', 'NS'] : want ? [want] : ['A', 'AAAA', 'MX'];
    for (const type of types.filter((t) => t !== 'CNAME' || !aliases.length)) {
      const answers = await query(ctx, server, target, type, !server);
      answers.forEach(line);
      if (want && want !== 'ANY' && !answers.length && !aliases.length) ctx.stdout.write(`${target} has no ${type} record\n`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof DnsFailure)) throw e;
    ctx.stdout.write(e.message === 'TIMEOUT' ? TIMEOUT : `Host ${isIP(name) ? arpa(name) : name} not found: ${RCODES[e.message]}(${e.message})\n`);
    return 1;
  }
}

async function nslookup(ctx: Ctx): Promise<number> {
  const opt = ctx.args.find((a) => /^-(type|query|q|t)=/i.test(a));
  const [name, server] = ctx.args.filter((a) => !a.startsWith('-'));
  if (!name) return (ctx.stderr.write('Usage: nslookup [-opt ...] host [server]\n'), 1);
  const type = opt ? opt.split('=')[1].toUpperCase() : null;
  const shown = server ?? STUB;
  ctx.stdout.write(`Server:\t\t${shown}\nAddress:\t${shown}#53\n\n`);
  try {
    if (isIP(name) || type === 'PTR') {
      for (const a of await query(ctx, server, name, 'PTR', !server)) ctx.stdout.write(`${a.name}\t${NS_FORMAT.PTR} = ${a.data}\n`);
      ctx.stdout.write('\nAuthoritative answers can be found from:\n\n');
      return 0;
    }
    const { aliases, target } = await follow(ctx, server, name, !server);
    const types = type ? [type] : ['A', 'AAAA'];
    const answers = (await Promise.all(types.filter((t) => t !== 'CNAME').map((t) => query(ctx, server, target, t, !server)))).flat();
    if (!answers.length && !aliases.length) return (ctx.stdout.write(`*** Can't find ${name}: No answer\n\n`), 0);
    ctx.stdout.write('Non-authoritative answer:\n');
    for (const a of [...aliases, ...answers]) {
      ctx.stdout.write(a.type === 'A' || a.type === 'AAAA' ? `Name:\t${a.name}\nAddress: ${a.data}\n` : `${a.name}\t${NS_FORMAT[a.type]} = ${a.data}\n`);
    }
    ctx.stdout.write('\n');
    return 0;
  } catch (e) {
    if (!(e instanceof DnsFailure)) throw e;
    ctx.stdout.write(e.message === 'TIMEOUT' ? `${TIMEOUT}\n` : `** server can't find ${name}: ${e.message}\n\n`);
    return 1;
  }
}

const fqdn = (n: string) => (n.endsWith('.') ? n : `${n}.`);
const tabs = (s: string, col: number) => `${s}${'\t'.repeat(Math.max(1, Math.ceil((col - s.length) / 8)))}`;

async function dig(ctx: Ctx): Promise<number> {
  let server: string | undefined;
  let name: string | undefined;
  let type = 'A';
  let reverse: string | undefined;
  const show = { comments: true, question: true, answer: true, stats: true, short: false };
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    const flag = a.slice(1).replace(/^no/, '');
    if (a.startsWith('@')) server = a.slice(1);
    else if (a === '-x') {
      reverse = ctx.args[++i];
      type = 'PTR';
    }
    else if (a === '-t') type = (ctx.args[++i] ?? 'A').toUpperCase();
    else if (a === '+noall' || a === '+all') for (const k of ['comments', 'question', 'answer', 'stats'] as const) show[k] = a === '+all';
    else if (a.startsWith('+') && flag in show) show[flag as keyof typeof show] = !a.startsWith('+no');
    else if (a.startsWith('+') || a.startsWith('-')) continue;
    else if (TYPES.includes(a.toUpperCase()) && (name !== undefined || ctx.args.slice(i + 1).some((x) => !x.startsWith('+') && !x.startsWith('@')))) type = a.toUpperCase();
    else if (a.toUpperCase() !== 'IN') name = a;
  }
  const qname = reverse ? arpa(reverse) : fqdn(name ?? '.');
  const shown = server ?? STUB;
  const out = (s: string) => ctx.stdout.write(s);
  if (show.comments && !show.short) out(`\n; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> ${ctx.args.join(' ')}\n;; global options: +cmd\n`);
  const start = platform.now();
  let answers: Answer[] = [];
  let status = 'NOERROR';
  try {
    if (reverse) answers = await query(ctx, server, reverse, 'PTR', !server);
    else {
      const { aliases, target } = type === 'CNAME' ? { aliases: [], target: qname } : await follow(ctx, server, qname, !server);
      answers = [...aliases, ...(await query(ctx, server, target, type, !server))];
    }
  } catch (e) {
    if (!(e instanceof DnsFailure)) throw e;
    if (e.message === 'TIMEOUT') return (out(`;; communications error to ${shown}#53: timed out\n;; no servers could be reached\n`), 9);
    status = e.message;
  }
  if (show.short) return (answers.forEach((a) => out(`${a.data}\n`)), 0);
  const elapsed = Math.round(platform.now() - start);
  if (show.comments) {
    out(`;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: ${Math.floor(Math.random() * 65536)}\n`);
    out(`;; flags: qr rd ra; QUERY: 1, ANSWER: ${answers.length}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; OPT PSEUDOSECTION:\n; EDNS: version: 0, flags:; udp: 65494\n`);
  }
  if (show.question) out(`${show.comments ? ';; QUESTION SECTION:\n' : ''}${tabs(`;${qname}`, 32)}IN\t${type}\n${show.comments ? '\n' : ''}`);
  if (show.answer && answers.length) {
    if (show.comments) out(';; ANSWER SECTION:\n');
    for (const a of answers) out(`${tabs(fqdn(a.name), 24)}${a.ttl}\tIN\t${a.type}\t${a.data}\n`);
    if (show.comments) out('\n');
  }
  if (show.stats) {
    const size = 12 + qname.length + 6 + 11 + answers.reduce((n, a) => n + 12 + (a.type === 'A' ? 4 : a.type === 'AAAA' ? 16 : a.data.length + 2), 0);
    out(`;; Query time: ${elapsed} msec\n;; SERVER: ${shown}#53(${shown}) (UDP)\n;; WHEN: ${strftime('%a %b %d %H:%M:%S %Z %Y', new Date())}\n;; MSG SIZE  rcvd: ${size}\n\n`);
  }
  return 0;
}

export const dnsCommands: CommandTable = {
  host: { fn: command(host), desc: 'DNS lookup utility' },
  nslookup: { fn: nslookup, desc: 'query Internet name servers interactively' },
  dig: { fn: dig, desc: 'DNS lookup utility' },
};
