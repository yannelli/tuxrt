import type { CommandTable, Ctx } from '../types.ts';
import { command, parseArgs } from '../util.ts';
import { isLocal, probe, ResolveError, resolveHost, reverseName, type Family } from './probe.ts';

interface Hop {
  name: string;
  addr: string;
  rtt: () => Promise<number | null>;
}

/** The emulated path: the QEMU user-mode gateway, then the real destination with its measured RTT. */
async function hops(ctx: Ctx, addr: string, family: Family, waitMs: number, numeric: boolean): Promise<Hop[]> {
  const name = numeric ? addr : await reverseName(ctx, addr);
  const dest: Hop = { name, addr, rtt: () => probe(addr, waitMs, ctx.signal) };
  if (isLocal(addr)) return [dest];
  const gw = family === 4 ? '10.0.2.2' : 'fe80::2';
  return [{ name: numeric ? gw : '_gateway', addr: gw, rtt: async () => 0.2 + Math.random() * 0.3 }, dest];
}

async function resolveOrFail(ctx: Ctx, host: string | undefined, family: Family): Promise<string | number> {
  if (!host) return (ctx.stderr.write('Specify "host" missing argument.\n'), 2);
  try {
    return await resolveHost(ctx, host, family);
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    ctx.stderr.write(`${host}: ${e.message}\nCannot handle "host" cmdline arg \`${host}' on position 1 (argc 1)\n`);
    return 2;
  }
}

async function traceroute(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'n46IT', values: 'mqwpfz' });
  const family: Family = ctx.name === 'traceroute6' || opts['6'] ? 6 : 4;
  const host = operands[0];
  const addr = await resolveOrFail(ctx, host, family);
  if (typeof addr === 'number') return addr;
  const maxHops = Number(opts.m ?? 30);
  const queries = Number(opts.q ?? 3);
  ctx.stdout.write(`traceroute to ${host} (${addr}), ${maxHops} hops max, ${family === 4 ? 60 : 80} byte packets\n`);
  const path = (await hops(ctx, addr, family, Number(opts.w ?? 5) * 1000, !!opts.n)).slice(0, maxHops);
  for (const [i, hop] of path.entries()) {
    let line = `${String(i + 1).padStart(2)} `;
    let named = false;
    for (let q = 0; q < queries && !ctx.signal.aborted; q++) {
      const rtt = await hop.rtt();
      if (rtt === null) line += ' *';
      else {
        if (!named) line += ` ${opts.n ? hop.addr : `${hop.name} (${hop.addr})`}`;
        named = true;
        line += `  ${rtt.toFixed(3)} ms`;
      }
    }
    ctx.stdout.write(`${line}\n`);
    if (ctx.signal.aborted || !named) break;
  }
  return 0;
}

async function tracepath(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'n46b', values: 'lmp' });
  const family: Family = ctx.name === 'tracepath6' || opts['6'] ? 6 : 4;
  const addr = await resolveOrFail(ctx, operands[0], family);
  if (typeof addr === 'number') return addr;
  const pmtu = isLocal(addr) ? 65535 : 1500;
  const path = await hops(ctx, addr, family, 3000, !!opts.n);
  const label = (hop: Hop) => (opts.b ? `${hop.name} (${hop.addr})` : opts.n ? hop.addr : hop.name).padEnd(48);
  ctx.stdout.write(` 1?: ${'[LOCALHOST]'.padEnd(32)} pmtu ${pmtu}\n`);
  for (const [i, hop] of path.entries()) {
    const last = i === path.length - 1;
    const rtt = await hop.rtt();
    if (rtt === null) {
      ctx.stdout.write(`${String(i + 1).padStart(2)}:  no reply\n     Too many hops: pmtu ${pmtu}\n     Resume: pmtu ${pmtu}\n`);
      return 0;
    }
    ctx.stdout.write(`${String(i + 1).padStart(2)}:  ${label(hop)}${rtt.toFixed(3).padStart(8)}ms ${last ? 'reached' : ''}\n`);
  }
  ctx.stdout.write(`     Resume: pmtu ${pmtu} hops ${path.length} back ${path.length} \n`);
  return 0;
}

export const traceCommands: CommandTable = {
  traceroute: { fn: command(traceroute), desc: 'show the hops to a network host' },
  traceroute6: { fn: command(traceroute), desc: 'show the hops to a network host' },
  tracepath: { fn: command(tracepath), desc: 'trace the path and MTU to a host' },
};
