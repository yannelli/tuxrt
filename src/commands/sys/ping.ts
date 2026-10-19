import { isIP } from 'node:net';
import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs, sleep } from '../util.ts';
import { isLocal, ms, probe, ResolveError, resolveHost, reverseName, type Family } from './probe.ts';

function number(ctx: Ctx, value: string | true | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (typeof value === 'string' && Number.isFinite(n) && n >= 0) return n;
  ctx.stderr.write(`ping: invalid argument: '${value}'\n`);
  return null;
}

async function ping(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'qn46vDOaAbBdfLRrU', values: 'ciWwstIlMpQS' });
  const family: Family = ctx.name === 'ping6' || opts['6'] ? 6 : 4;
  const host = operands.at(-1);
  if (!host) return (ctx.stderr.write('ping: usage error: Destination address required\n'), 2);
  const count = number(ctx, opts.c, Infinity);
  const interval = number(ctx, opts.i, 1);
  const wait = number(ctx, opts.W, 10);
  const deadline = number(ctx, opts.w, Infinity);
  const size = number(ctx, opts.s, 56);
  if (count === null || interval === null || wait === null || deadline === null || size === null) return 1;
  if (count === 0) return (ctx.stderr.write(`ping: invalid argument: '0': out of range: 1 <= value <= 9223372036854775807\n`), 1);
  if (interval < 0.002 && ctx.shell.user.uid !== 0) {
    return (ctx.stderr.write('ping: cannot flood, minimal interval for user must be >= 2 ms, use -i 0.002 (or higher)\n'), 2);
  }
  let addr: string;
  try {
    addr = await resolveHost(ctx, host, family);
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    return (ctx.stderr.write(`${ctx.name}: ${host}: ${e.message}\n`), 2);
  }
  const numeric = !!opts.n || isIP(host) !== 0;
  const from = numeric ? addr : `${await reverseName(ctx, addr)} (${addr})`;
  ctx.stdout.write(family === 4
    ? `PING ${host} (${addr}) ${size}(${size + 28}) bytes of data.\n`
    : `PING ${host}(${isIP(host) ? addr : `${host} (${addr})`}) ${size} data bytes\n`);
  const ttl = isLocal(addr) ? 64 : 63;
  const times: number[] = [];
  const start = performance.now();
  let last = start;
  let sent = 0;
  const replies: Promise<void>[] = [];
  for (let seq = 1; seq <= count && !ctx.signal.aborted && performance.now() - start < deadline * 1000; seq++) {
    sent++;
    last = performance.now();
    replies.push(probe(addr, wait * 1000, ctx.signal).then((rtt) => {
      if (rtt === null || ctx.signal.aborted) return;
      times.push(rtt);
      last = performance.now();
      if (!opts.q) ctx.stdout.write(`${size + 8} bytes from ${from}: icmp_seq=${seq} ttl=${ttl} time=${ms(rtt)} ms\n`);
    }));
    if (seq < count) await sleep(interval * 1000, ctx.signal);
  }
  await Promise.all(replies);
  const loss = sent ? ((sent - times.length) / sent) * 100 : 0;
  ctx.stdout.write(`\n--- ${host} ping statistics ---\n`);
  ctx.stdout.write(`${sent} packets transmitted, ${times.length} received, ${+loss.toPrecision(6)}% packet loss, time ${Math.round(last - start)}ms\n`);
  if (!times.length) return 1;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length);
  ctx.stdout.write(`rtt min/avg/max/mdev = ${[Math.min(...times), avg, Math.max(...times), mdev].map((n) => n.toFixed(3)).join('/')} ms\n`);
  return 0;
}

export const pingCommands: CommandTable = {
  ping: { fn: command(ping), desc: 'send ICMP ECHO_REQUEST to network hosts' },
  ping6: { fn: command(ping), desc: 'send ICMP ECHO_REQUEST to network hosts' },
};
