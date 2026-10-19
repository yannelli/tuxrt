import { machine, memoryUsage } from '../vfs/machine.ts';
import type { User } from '../vfs/users.ts';

export function motd(user: User): string {
  const d = machine.distro;
  const mem = memoryUsage();
  const lines = [
    `Welcome to ${d.name} ${d.version} (GNU/Linux ${machine.release} ${machine.arch})`,
    '',
    ' * Documentation:  https://help.ubuntu.com',
    ' * Management:     https://landscape.canonical.com',
    ' * Support:        https://ubuntu.com/pro',
    '',
    ` System information as of ${new Date().toUTCString().replace('GMT', 'UTC')}`,
    '',
    `  System load:  0.08              Processes:             112`,
    `  Usage of /:   7.4% of 28.89GB   Users logged in:       0`,
    `  Memory usage: ${Math.round((mem.used / mem.total) * 100)}%               IPv4 address for eth0: 10.0.2.15`,
    '',
    'This system is emulated by tuxrt: everything runs in memory, nothing touches the host.',
    '',
  ];
  if (user.groups.includes(27)) {
    lines.push(`Prefix a command with "sudo" to run it with root privileges.`, `"man sudo_root" explains how administrator access works here.`, '');
  }
  return `${lines.join('\n')}\n`;
}
