import { currentDns, isIP } from '../../platform/dns.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { lines } from '../util.ts';
import { hostsFile } from './probe.ts';

interface Iface {
  name: string;
  head: string;
  link: string[];
  v4: [string, string][];
  v6: [string, string][];
}

const FOREVER = '       valid_lft forever preferred_lft forever';
const IFACES: Iface[] = [
  {
    name: 'lo',
    head: '<LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN',
    link: ['link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00'],
    v4: [['127.0.0.1/8', 'inet 127.0.0.1/8 scope host lo']],
    v6: [['::1/128', 'inet6 ::1/128 scope host noprefixroute ']],
  },
  {
    name: 'eth0',
    head: '<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP',
    link: ['link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff', 'altname enp0s3'],
    v4: [['10.0.2.15/24 metric 100', 'inet 10.0.2.15/24 metric 100 brd 10.0.2.255 scope global dynamic eth0\n       valid_lft 86313sec preferred_lft 86313sec']],
    v6: [['fe80::5054:ff:fe12:3456/64', 'inet6 fe80::5054:ff:fe12:3456/64 scope link ']],
  },
];

const ROUTES: Record<number, string[]> = {
  4: [
    'default via 10.0.2.2 dev eth0 proto dhcp src 10.0.2.15 metric 100 ',
    '10.0.2.0/24 dev eth0 proto kernel scope link src 10.0.2.15 metric 100 ',
    '10.0.2.2 dev eth0 proto dhcp scope link src 10.0.2.15 metric 100 ',
    '10.0.2.3 dev eth0 proto dhcp scope link src 10.0.2.15 metric 100 ',
  ],
  6: ['::1 dev lo proto kernel metric 256 pref medium', 'fe80::/64 dev eth0 proto kernel metric 256 pref medium'],
};

const OBJECTS = ['address', 'link', 'route', 'neighbour'];
const SHOW = ['show', 'list', 'lst', 'ls', 'sh'];

function ip(ctx: Ctx): number {
  const args = [...ctx.args];
  const flags = new Set<string>();
  while (args[0]?.startsWith('-')) flags.add(args.shift()!.replace(/^--?/, ''));
  const family = flags.has('6') ? 6 : flags.has('4') ? 4 : 0;
  const brief = flags.has('br') || flags.has('brief');
  const [word, cmd = 'show', ...rest] = args;
  if (!word) return (ctx.stderr.write('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | neighbour | route | ... }\n'), 255);
  const obj = OBJECTS.find((o) => o.startsWith(word) || (o === 'neighbour' && word === 'neighbor'));
  if (!obj) return (ctx.stderr.write(`Object "${word}" is unknown, try "ip help".\n`), 255);
  if (!SHOW.includes(cmd)) {
    if (ctx.shell.user.uid !== 0) return (ctx.stderr.write('RTNETLINK answers: Operation not permitted\n'), 2);
    return 0;
  }
  if (obj === 'route') return (ctx.stdout.write(`${ROUTES[family || 4].join('\n')}\n`), 0);
  if (obj === 'neighbour') return (ctx.stdout.write('10.0.2.2 dev eth0 lladdr 52:55:0a:00:02:02 REACHABLE \n'), 0);
  const dev = rest.find((r) => r !== 'dev');
  const ifaces = dev ? IFACES.filter((i) => i.name === dev) : IFACES;
  if (!ifaces.length) return (ctx.stderr.write(`Device "${dev}" does not exist.\n`), 1);
  ifaces.forEach((i) => {
    const index = IFACES.indexOf(i) + 1;
    const addrs = [...(family === 6 ? [] : i.v4), ...(family === 4 ? [] : i.v6)];
    const state = /state (\S+)/.exec(i.head)![1];
    if (brief) return ctx.stdout.write(`${i.name.padEnd(16)} ${state.padEnd(14)} ${addrs.map(([a]) => a).join(' ')} \n`);
    const mode = obj === 'link' ? ' mode DEFAULT' : '';
    ctx.stdout.write(`${index}: ${i.name}: ${i.head}${mode} group default qlen 1000\n`);
    if (obj === 'link' || !family) for (const l of i.link) ctx.stdout.write(`    ${l}\n`);
    if (obj === 'address') for (const [, line] of addrs) ctx.stdout.write(`    ${line}\n${line.includes('valid_lft') ? '' : `${FOREVER}\n`}`);
  });
  return 0;
}

const DATABASES: Record<string, string> = { passwd: '/etc/passwd', group: '/etc/group', shadow: '/etc/shadow' };

async function hostEntry(ctx: Ctx, key: string): Promise<string | undefined> {
  const entry = hostsFile(ctx).find(([addr, names]) => addr === key || names.includes(key));
  if (entry) return `${entry[0].padEnd(15)} ${entry[1].join(' ')}`;
  if (isIP(key)) return undefined;
  try {
    return `${(await currentDns().lookup(key, 0))[0].padEnd(15)} ${key}`;
  } catch {
    return undefined;
  }
}

async function getent(ctx: Ctx): Promise<number> {
  const [db, ...keys] = ctx.args.filter((a) => !a.startsWith('-'));
  if (!db) return (ctx.stderr.write('Usage: getent [OPTION...] database [key ...]\n'), 1);
  let found: (string | undefined)[];
  if (db in DATABASES) {
    let rows: string[];
    try {
      rows = lines(ctx.vfs.readFile(DATABASES[db]));
    } catch {
      return 2;
    }
    const match = (key: string) => rows.find((r) => r.split(':')[0] === key || (db !== 'shadow' && /^\d+$/.test(key) && r.split(':')[2] === key));
    found = keys.length ? keys.map(match) : rows;
  } else if (db === 'hosts' || db === 'ahosts') {
    found = keys.length ? await Promise.all(keys.map((k) => hostEntry(ctx, k))) : hostsFile(ctx).map(([a, n]) => `${a.padEnd(15)} ${n.join(' ')}`);
  } else {
    return (ctx.stderr.write(`Unknown database: ${db}\nTry \`getent --help' or \`getent --usage' for more information.\n`), 1);
  }
  for (const row of found) if (row !== undefined) ctx.stdout.write(`${row}\n`);
  return found.includes(undefined) ? 2 : 0;
}

export const netCommands: CommandTable = {
  ip: { fn: ip, desc: 'show or change network links and routes' },
  getent: { fn: getent, desc: 'look up entries in NSS databases' },
};
