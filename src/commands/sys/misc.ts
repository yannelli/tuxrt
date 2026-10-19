import { readAll } from '../../shell/io.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, lines, parseArgs, readInput } from '../util.ts';

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  for (b %= m; e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m;
  return r;
}

/** Deterministic Miller-Rabin for every n below 3.3e24, which covers what factor is asked in practice. */
function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) if (n % p === 0n) return n === p;
  let d = n - 1n;
  let r = 0;
  for (; !(d & 1n); r++) d >>= 1n;
  witness: for (const a of SMALL_PRIMES) {
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < r; i++) if ((x = (x * x) % n) === n - 1n) continue witness;
    return false;
  }
  return true;
}

const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a < 0n ? -a : a);

function pollardRho(n: bigint): bigint {
  for (let c = 1n; ; c++) {
    const f = (v: bigint) => (v * v + c) % n;
    let [x, y, d] = [2n, 2n, 1n];
    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      d = gcd(x - y, n);
    }
    if (d !== n) return d;
  }
}

function factorize(n: bigint): bigint[] {
  const out: bigint[] = [];
  for (let p = 2n; p < 1000n && p * p <= n; p++) for (; n % p === 0n; n /= p) out.push(p);
  if (n < 2n) return out;
  if (isPrime(n) || n < 1_000_000n) return [...out, n];
  const d = pollardRho(n);
  return [...out, ...factorize(d), ...factorize(n / d)].sort((a, b) => (a < b ? -1 : 1));
}

async function factor(ctx: Ctx): Promise<number> {
  const inputs = ctx.args.length ? ctx.args : (await readAll(ctx.stdin)).split(/\s+/).filter(Boolean);
  let status = 0;
  for (const s of inputs) {
    if (!/^\+?\d+$/.test(s)) status = fail(ctx, `‘${s}’ is not a valid positive integer`);
    else ctx.stdout.write(`${BigInt(s)}:${factorize(BigInt(s)).map((p) => ` ${p}`).join('')}\n`);
  }
  return status;
}

async function shuf(ctx: Ctx): Promise<number> {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'erz',
    values: 'nio',
    long: { echo: 'e', 'head-count=': 'n', 'input-range=': 'i', 'output=': 'o', repeat: 'r', 'zero-terminated': 'z' },
  });
  let items: string[];
  if (opts.e) items = operands;
  else if (typeof opts.i === 'string') {
    const m = /^(\d+)-(\d+)$/.exec(opts.i);
    if (!m || +m[1] > +m[2] + 1) return fail(ctx, `invalid input range: ‘${opts.i}’`);
    items = Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => String(+m[1] + i));
  } else {
    if (operands.length > 1) return fail(ctx, `extra operand ‘${operands[1]}’`);
    const { text, status } = await readInput(ctx, operands);
    if (status) return status;
    items = opts.z ? text.split('\0').filter(Boolean) : lines(text);
  }
  const count = opts.n === undefined ? (opts.r ? Infinity : items.length) : Number(opts.n);
  if (Number.isNaN(count) || count < 0) return fail(ctx, `invalid line count: ‘${opts.n}’`);
  const end = opts.z ? '\0' : '\n';
  let out = '';
  if (opts.r) {
    if (!items.length) return count === 0 ? 0 : fail(ctx, 'no lines to repeat');
    for (let i = 0; i < count && !ctx.signal.aborted; i++) {
      ctx.stdout.write(`${items[Math.floor(Math.random() * items.length)]}${end}`);
      if (i % 256 === 255) await new Promise((r) => setImmediate(r));
    }
    return 0;
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  for (const item of items.slice(0, count)) out += `${item}${end}`;
  if (typeof opts.o === 'string') ctx.vfs.writeFile(ctx.shell.abs(opts.o), out);
  else ctx.stdout.write(out);
  return 0;
}

const POWER: Record<string, [string, string]> = {
  reboot: ['Reboot', 'reboot'], poweroff: ['PowerOff', 'power off'], halt: ['Halt', 'halt'], shutdown: ['PowerOff', 'shut down'],
};

/** Never stops the emulated machine; non-root gets systemd's polkit refusal, root a polite one. */
function power(ctx: Ctx): number {
  const [method, verb] = ctx.name === 'shutdown' && ctx.args.includes('-r') ? POWER.reboot : POWER[ctx.name];
  if (ctx.name === 'shutdown' && ctx.args.includes('-c')) return 0;
  if (ctx.shell.user.uid !== 0) return (ctx.stderr.write(`Call to ${method} failed: Interactive authentication required.\n`), 1);
  ctx.stderr.write(`Failed to ${verb} system: this machine is emulated by tuxrt and stays up.\n`);
  return 1;
}

export const miscCommands: CommandTable = {
  factor: { fn: factor, desc: 'factor numbers' },
  shuf: { fn: command(shuf), desc: 'generate random permutations' },
  sync: { fn: () => 0, desc: 'Synchronize cached writes to persistent storage' },
  reboot: { fn: power, desc: 'Reboot the machine' },
  poweroff: { fn: power, desc: 'Power off the machine' },
  halt: { fn: power, desc: 'Halt the machine' },
  shutdown: { fn: power, desc: 'Halt, power off or reboot the machine' },
};
