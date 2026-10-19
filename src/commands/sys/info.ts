import { machine } from '../../vfs/machine.ts';
import { findUser, groupName, type User } from '../../vfs/users.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { command, fail, humanSize, parseArgs } from '../util.ts';

export function hostname(ctx: Ctx): string {
  return ctx.vfs.readFile('/etc/hostname').trim();
}

function uname(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, {
    flags: 'asnrvmpio',
    long: {
      all: 'a', 'kernel-name': 's', nodename: 'n', 'kernel-release': 'r', 'kernel-version': 'v',
      machine: 'm', processor: 'p', 'hardware-platform': 'i', 'operating-system': 'o',
    },
  });
  const fields: [string, string][] = [
    ['s', machine.kernel], ['n', hostname(ctx)], ['r', machine.release], ['v', machine.version],
    ['m', machine.arch], ['p', machine.arch], ['i', machine.arch], ['o', 'GNU/Linux'],
  ];
  const picked = fields.filter(([k]) => opts.a || opts[k]);
  ctx.stdout.write(`${(picked.length ? picked : fields.slice(0, 1)).map(([, v]) => v).join(' ')}\n`);
  return 0;
}

function hostnameCmd(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, {
    flags: 'IifsdAb',
    long: { 'all-ip-addresses': 'I', 'ip-address': 'i', fqdn: 'f', long: 'f', short: 's', domain: 'd', 'all-fqdns': 'A', boot: 'b' },
  });
  if (operands.length) {
    if (ctx.shell.user.uid !== 0) return fail(ctx, 'you must be root to change the host name');
    ctx.vfs.writeFile('/etc/hostname', `${operands[0]}\n`);
    return 0;
  }
  const name = hostname(ctx);
  const out = opts.I ? '10.0.2.15 ' : opts.i ? '127.0.1.1' : opts.d ? '' : opts.s ? name.split('.')[0] : opts.A ? `${name} ` : name;
  ctx.stdout.write(`${out}\n`);
  return 0;
}

function hostnamectl(ctx: Ctx): number {
  const [sub = 'status', name] = ctx.args;
  if (sub === 'hostname' && !name) return (ctx.stdout.write(`${hostname(ctx)}\n`), 0);
  if (sub === 'set-hostname' || sub === 'hostname') {
    if (!name) return fail(ctx, 'Too few arguments.');
    if (ctx.shell.user.uid !== 0) return (ctx.stderr.write('Could not set static hostname: Access denied\n'), 1);
    ctx.vfs.writeFile('/etc/hostname', `${name}\n`);
    return 0;
  }
  if (sub !== 'status') return fail(ctx, `Unknown command verb '${sub}'.`);
  const d = machine.distro;
  ctx.stdout.write([
    ` Static hostname: ${hostname(ctx)}`,
    '       Icon name: computer-vm',
    '         Chassis: vm',
    '      Machine ID: 3f9c1a52d1e04b6c9a7f2e8d5b0c4a17',
    '         Boot ID: 8d2e47b1c09f4a3e86b5d7f1a2c3e4b5',
    '  Virtualization: kvm',
    `Operating System: ${d.name} ${d.version}`,
    `          Kernel: ${machine.kernel} ${machine.release}`,
    '    Architecture: x86-64',
    ' Hardware Vendor: QEMU',
    '  Hardware Model: Standard PC _i440FX + PIIX, 1996_',
    'Firmware Version: 1.16.3-debian-1.16.3-2',
    '',
  ].join('\n'));
  return 0;
}

function idUser(ctx: Ctx, name?: string): User | undefined {
  return name === undefined ? ctx.shell.user : findUser(ctx.vfs, name);
}

function groupIds(user: User): number[] {
  return [...new Set(user.groups)];
}

function id(ctx: Ctx): number {
  const { opts, operands } = parseArgs(ctx.args, { flags: 'ugGnr', long: { user: 'u', group: 'g', groups: 'G', name: 'n', real: 'r' } });
  const user = idUser(ctx, operands[0]);
  if (!user) return fail(ctx, `‘${operands[0]}’: no such user`);
  const g = (gid: number) => (opts.n ? groupName(ctx.vfs, gid) : String(gid));
  if (opts.u) ctx.stdout.write(`${opts.n ? user.name : user.uid}\n`);
  else if (opts.g) ctx.stdout.write(`${g(user.gid)}\n`);
  else if (opts.G) ctx.stdout.write(`${groupIds(user).map(g).join(' ')}\n`);
  else {
    const groups = groupIds(user).map((gid) => `${gid}(${groupName(ctx.vfs, gid)})`).join(',');
    ctx.stdout.write(`uid=${user.uid}(${user.name}) gid=${user.gid}(${groupName(ctx.vfs, user.gid)}) groups=${groups}\n`);
  }
  return 0;
}

function groups(ctx: Ctx): number {
  const names = (u: User) => groupIds(u).map((gid) => groupName(ctx.vfs, gid)).join(' ');
  if (!ctx.args.length) return (ctx.stdout.write(`${names(ctx.shell.user)}\n`), 0);
  let status = 0;
  for (const name of ctx.args) {
    const user = findUser(ctx.vfs, name);
    if (user) ctx.stdout.write(`${name} : ${names(user)}\n`);
    else status = fail(ctx, `‘${name}’: no such user`);
  }
  return status;
}

function nproc(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, { long: { all: 'all', 'ignore=': 'ignore' } });
  ctx.stdout.write(`${Math.max(1, machine.cpus - Number(opts.ignore ?? 0))}\n`);
  return 0;
}

function lsbRelease(ctx: Ctx): number {
  const { opts } = parseArgs(ctx.args, {
    flags: 'aidrcsv',
    long: { all: 'a', id: 'i', description: 'd', release: 'r', codename: 'c', short: 's', version: 'v' },
  });
  const d = machine.distro;
  const fields: [string, string, string][] = [
    ['i', 'Distributor ID', d.name], ['d', 'Description', `${d.name} ${d.version}`], ['r', 'Release', d.release], ['c', 'Codename', d.codename],
  ];
  const picked = fields.filter(([k]) => opts.a || opts[k]);
  if (!picked.length || opts.a || opts.v) ctx.stderr.write('No LSB modules are available.\n');
  for (const [, label, value] of picked) ctx.stdout.write(opts.s ? `${value}\n` : `${label}:\t${value}\n`);
  return 0;
}

function lscpu(ctx: Ctx): number {
  const rows: [string, string | number][] = [
    ['Architecture:', machine.arch], ['  CPU op-mode(s):', '32-bit, 64-bit'], ['  Address sizes:', '46 bits physical, 48 bits virtual'],
    ['  Byte Order:', 'Little Endian'], ['CPU(s):', machine.cpus], ['  On-line CPU(s) list:', `0-${machine.cpus - 1}`],
    ['Vendor ID:', 'GenuineIntel'], ['  Model name:', machine.cpuModel], ['    CPU family:', 6], ['    Model:', 79],
    ['    Thread(s) per core:', 2], ['    Core(s) per socket:', machine.cpus / 2], ['    Socket(s):', 1],
    ['    BogoMIPS:', '4400.00'], ['Virtualization features:', ''], ['  Hypervisor vendor:', 'KVM'], ['  Virtualization type:', 'full'],
  ];
  for (const [k, v] of rows) ctx.stdout.write(`${k.padEnd(26)}${v}`.trimEnd() + '\n');
  return 0;
}

function lsblk(ctx: Ctx): number {
  const part = humanSize(machine.diskKb * 1024);
  ctx.stdout.write([
    'NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS',
    'sda      8:0    0   30G  0 disk ',
    `└─sda1   8:1    0 ${part.padStart(5)}  0 part /`,
    '',
  ].join('\n'));
  return 0;
}

const BOOT_LOG: [number, string][] = [
  [0, `Linux version ${machine.release} (buildd@lcy02-amd64-028) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) ${machine.version}`],
  [0, `Command line: BOOT_IMAGE=/vmlinuz-${machine.release} root=/dev/sda1 ro quiet splash`],
  [0.004, 'DMI: QEMU Standard PC (i440FX + PIIX, 1996), BIOS 1.16.3-debian-1.16.3-2 04/01/2014'],
  [0.152, `smpboot: Allowing ${machine.cpus} CPUs, 0 hotplug CPUs`],
  [0.41, `Memory: ${Math.round(machine.memKb * 0.96)}K/${machine.memKb}K available`],
  [1.204, 'EXT4-fs (sda1): mounted filesystem with ordered data mode. Quota mode: none.'],
  [1.88, 'systemd[1]: systemd 255.4-1ubuntu8.4 running in system mode'],
  [2.31, 'e1000 0000:00:03.0 eth0: (PCI:33MHz:32-bit) 52:54:00:12:34:56'],
  [3.017, 'e1000: eth0 NIC Link is Up 1000 Mbps Full Duplex, Flow Control: RX'],
];

function dmesg(ctx: Ctx): number {
  if (ctx.shell.user.uid !== 0) return fail(ctx, 'read kernel buffer failed: Operation not permitted');
  for (const [t, msg] of BOOT_LOG) ctx.stdout.write(`[${t.toFixed(6).padStart(12)}] ${msg}\n`);
  return 0;
}

export const infoCommands: CommandTable = {
  uname: { fn: command(uname), desc: 'print system information' },
  hostname: { fn: command(hostnameCmd), desc: 'print or change the hostname' },
  hostnamectl: { fn: hostnamectl, desc: 'Control the system hostname' },
  arch: { fn: (ctx) => (ctx.stdout.write(`${machine.arch}\n`), 0), desc: 'print the CPU architecture' },
  nproc: { fn: command(nproc), desc: 'print the available CPU count' },
  lsb_release: { fn: command(lsbRelease), desc: 'print distribution-specific information' },
  whoami: { fn: (ctx) => (ctx.stdout.write(`${ctx.shell.user.name}\n`), 0), desc: 'print effective user name' },
  id: { fn: command(id), desc: 'print user and group identity' },
  groups: { fn: groups, desc: "list a user's groups" },
  tty: { fn: (ctx) => (ctx.args[0] === '-s' ? 0 : (ctx.stdout.write('/dev/pts/0\n'), 0)), desc: 'print the terminal device on stdin' },
  lscpu: { fn: lscpu, desc: 'display information about the CPU architecture' },
  lsblk: { fn: lsblk, desc: 'list block devices' },
  dmesg: { fn: dmesg, desc: 'print kernel log messages' },
};
