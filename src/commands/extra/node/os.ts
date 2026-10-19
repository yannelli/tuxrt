import { osConstants as constants } from './constants.ts';
import { machine, memoryUsage, uptimeSeconds } from '../../../vfs/machine.ts';
import type { NodeRuntime } from './runtime.ts';

/** The `os` module, describing the emulated machine rather than the host. */
export function createOs(rt: NodeRuntime): Record<string, unknown> {
  const { ctx } = rt;
  const env = () => rt.process.env as Record<string, string | undefined>;
  const cpu = () => ({
    model: machine.cpuModel,
    speed: 2200,
    times: { user: 252020, nice: 0, sys: 30340, idle: 1070356870, irq: 0 },
  });
  const iface = (address: string, family: string, cidr: string, mac: string, internal: boolean) => ({
    address,
    netmask: family === 'IPv4' ? (internal ? '255.0.0.0' : '255.255.240.0') : 'ffff:ffff:ffff:ffff::',
    family,
    mac,
    internal,
    cidr,
  });
  return {
    EOL: '\n',
    devNull: '/dev/null',
    constants,
    arch: () => 'x64',
    machine: () => machine.arch,
    platform: () => 'linux',
    type: () => machine.kernel,
    release: () => machine.release,
    version: () => machine.version,
    endianness: () => 'LE',
    hostname: () => rt.asUser(() => ctx.vfs.readFile('/etc/hostname').trim()),
    homedir: () => env().HOME ?? ctx.shell.user.home,
    tmpdir: () => env().TMPDIR ?? '/tmp',
    uptime: () => Math.floor(uptimeSeconds()),
    loadavg: () => [0.08, 0.03, 0.01],
    totalmem: () => machine.memKb * 1024,
    freemem: () => memoryUsage().available * 1024,
    availableParallelism: () => machine.cpus,
    cpus: () => Array.from({ length: machine.cpus }, cpu),
    userInfo: () => ({
      uid: rt.cred.uid,
      gid: rt.cred.gid,
      username: ctx.shell.user.name,
      homedir: ctx.shell.user.home,
      shell: ctx.shell.user.shell,
    }),
    networkInterfaces: () => ({
      lo: [iface('127.0.0.1', 'IPv4', '127.0.0.1/8', '00:00:00:00:00:00', true), iface('::1', 'IPv6', '::1/128', '00:00:00:00:00:00', true)],
      eth0: [iface('10.0.2.15', 'IPv4', '10.0.2.15/20', '52:54:00:12:34:56', false)],
    }),
    getPriority: () => 0,
    setPriority: () => {},
  };
}
