import { randomBytes } from 'node:crypto';

export const machine = {
  kernel: 'Linux',
  release: '6.8.0-45-generic',
  version: '#45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024',
  arch: 'x86_64',
  cpus: 4,
  cpuModel: 'Intel(R) Xeon(R) CPU @ 2.20GHz',
  memKb: 4_028_440,
  diskKb: 30_298_176,
  bootTime: Date.now(),
  distro: { id: 'ubuntu', name: 'Ubuntu', version: '24.04.1 LTS', release: '24.04', codename: 'noble' },
};

export function uptimeSeconds(): number {
  return (Date.now() - machine.bootTime) / 1000 + 3600;
}

/** Fake but internally consistent memory accounting so free, top and /proc/meminfo agree. */
export function memoryUsage() {
  const used = Math.round(machine.memKb * 0.18 + process.memoryUsage().heapUsed / 1024);
  const buffCache = Math.round(machine.memKb * 0.22);
  const free = machine.memKb - used - buffCache;
  return { total: machine.memKb, used, free, shared: 1204, buffCache, available: free + buffCache };
}

export function randomText(bytes: number): string {
  return randomBytes(bytes).toString('latin1');
}
