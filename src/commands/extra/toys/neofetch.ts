import { machine, memoryUsage, uptimeSeconds } from '../../../vfs/machine.ts';
import type { CommandFn } from '../../types.ts';
import { loadDb } from '../apt/db.ts';

const LOGO = `                  @@@@
                 @@@@@@
                 @@@@@@
           oooo          oooo
         ooooooo        ooooooo
       oooooo              oooooo
      ooooo                  ooooo
     ooooo                    ooooo
     oooo                      oooo
    oooo                        oooo
    oooo                        oooo


   @@@@@@                      @@@@@@
   @@@@@@   o              o   @@@@@@
    @@@    ooooo        ooooo    @@@
           oooooooooooooooooo
                oooooooo`.split('\n');

const LOGO_WIDTH = 40;

/** neofetch drops zero units and singularizes 1 ("1 hour, 3 mins"). */
function uptime(total: number): string {
  const s = Math.floor(total);
  const units: [number, string][] = [[Math.floor(s / 86400), 'day'], [Math.floor(s / 3600) % 24, 'hour'], [Math.floor(s / 60) % 60, 'min']];
  const parts = units.filter(([n]) => n > 0).map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : `${s} secs`;
}

function cpu(): string {
  const name = machine.cpuModel.replace(/\((R|TM)\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
  const ghz = Number(/@ ([\d.]+)GHz/.exec(machine.cpuModel)?.[1] ?? 2.2);
  return `${name} (${machine.cpus}) @ ${ghz.toFixed(3)}GHz`;
}

export const neofetch: CommandFn = (ctx) => {
  const tty = ctx.stdout.isTTY === true;
  const paint = (s: string, code: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const user = ctx.shell.user.name;
  const host = ctx.vfs.readFile('/etc/hostname').trim();
  const mem = memoryUsage();
  const fields: [string, string][] = [
    ['OS', `${machine.distro.name} ${machine.distro.version} ${machine.arch}`],
    ['Host', 'KVM/QEMU (Standard PC (i440FX + PIIX, 1996) pc-i440fx-8.2)'],
    ['Kernel', machine.release],
    ['Uptime', uptime(uptimeSeconds())],
    ['Packages', `${loadDb(ctx.vfs).size} (dpkg)`],
    ['Shell', 'bash 5.2.21'],
    ['Terminal', '/dev/pts/0'],
    ['CPU', cpu()],
    ['Memory', `${Math.floor(mem.used / 1024)}MiB / ${Math.floor(mem.total / 1024)}MiB`],
  ];
  const info = [
    `${paint(user, '1;31')}@${paint(host, '1;31')}`,
    '-'.repeat(user.length + host.length + 1),
    ...fields.map(([k, v]) => `${paint(k, '1;31')}: ${v}`),
  ];
  if (tty) {
    const blocks = (base: number) => `${[...Array(8).keys()].map((i) => `\x1b[${base + i}m   `).join('')}\x1b[0m`;
    info.push('', blocks(40), blocks(100));
  }
  const rows = Math.max(LOGO.length, info.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const logo = paint((LOGO[i] ?? '').padEnd(LOGO_WIDTH), '1;31');
    out.push(`${logo}   ${info[i] ?? ''}`.trimEnd());
  }
  ctx.stdout.write(`${out.join('\n')}\n`);
  return 0;
};
