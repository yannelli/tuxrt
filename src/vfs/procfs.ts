import { machine, memoryUsage, randomText, uptimeSeconds } from './machine.ts';
import type { FileNode } from './types.ts';
import type { VFS } from './vfs.ts';

function cpuinfo(): string {
  return Array.from({ length: machine.cpus }, (_, i) =>
    [
      `processor\t: ${i}`,
      'vendor_id\t: GenuineIntel',
      `model name\t: ${machine.cpuModel}`,
      'cpu MHz\t\t: 2200.000',
      'cache size\t: 56320 KB',
      `cpu cores\t: ${machine.cpus}`,
      'flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sse sse2 ssse3 avx avx2',
      '',
    ].join('\n'),
  ).join('\n');
}

function meminfo(): string {
  const m = memoryUsage();
  const row = (k: string, v: number) => `${`${k}:`.padEnd(16)}${String(v).padStart(8)} kB`;
  return `${[
    row('MemTotal', m.total),
    row('MemFree', m.free),
    row('MemAvailable', m.available),
    row('Buffers', Math.round(m.buffCache * 0.1)),
    row('Cached', Math.round(m.buffCache * 0.9)),
    row('Shmem', m.shared),
    row('SwapTotal', 0),
    row('SwapFree', 0),
  ].join('\n')}\n`;
}

const procFiles: Record<string, () => string> = {
  version: () => `Linux version ${machine.release} (buildd@lcy02-amd64-028) (gcc 13.2.0) ${machine.version}\n`,
  cpuinfo,
  meminfo,
  uptime: () => `${uptimeSeconds().toFixed(2)} ${(uptimeSeconds() * machine.cpus * 0.95).toFixed(2)}\n`,
  loadavg: () => '0.08 0.03 0.01 1/112 1337\n',
  filesystems: () => 'nodev\tsysfs\nnodev\ttmpfs\nnodev\tproc\n\text4\n',
  mounts: () => '/dev/sda1 / ext4 rw,relatime 0 0\nproc /proc proc rw,nosuid,nodev,noexec 0 0\ntmpfs /tmp tmpfs rw 0 0\n',
  hostname: () => '',
  cmdline: () => `BOOT_IMAGE=/vmlinuz-${machine.release} root=/dev/sda1 ro quiet splash\n`,
};

function virtual(vfs: VFS, mode: number, generate: () => string, sink?: (d: string) => void): FileNode {
  return { ...vfs.newFile('', mode), generate, sink };
}

export function mountProc(vfs: VFS, hostname: () => string): void {
  vfs.mkdir('/proc', false, 0o555);
  for (const [name, gen] of Object.entries(procFiles)) {
    const node = virtual(vfs, 0o444, name === 'hostname' ? () => `${hostname()}\n` : gen);
    (vfs.lookup('/proc') as { children: Map<string, FileNode> }).children.set(name, node);
  }
}

export function mountDev(vfs: VFS, tty: (d: string) => void): void {
  vfs.mkdir('/dev', false, 0o755);
  const dev = vfs.lookup('/dev') as { children: Map<string, FileNode> };
  const discard = () => {};
  dev.children.set('null', virtual(vfs, 0o666, () => '', discard));
  dev.children.set('zero', virtual(vfs, 0o666, () => '\0'.repeat(4096), discard));
  dev.children.set('random', virtual(vfs, 0o666, () => randomText(4096), discard));
  dev.children.set('urandom', virtual(vfs, 0o666, () => randomText(4096), discard));
  dev.children.set('tty', virtual(vfs, 0o666, () => '', tty));
  vfs.symlink('/proc/self/fd/1', '/dev/stdout');
  vfs.symlink('/proc/self/fd/2', '/dev/stderr');
  vfs.mkdir('/dev/shm', false, 0o1777);
}

export const DEVICE_PATHS = new Set(['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/tty']);
