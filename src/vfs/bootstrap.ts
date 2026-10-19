import { machine } from './machine.ts';
import { mountDev, mountProc } from './procfs.ts';
import { VFS } from './vfs.ts';

export const ELF_MAGIC = '\x7fELF\x02\x01\x01\0tuxrt:';
export const DEFAULT_USER = { name: 'ubuntu', uid: 1000, gid: 1000, home: '/home/ubuntu' };

const d = machine.distro;

const etc: Record<string, string> = {
  hostname: 'ubuntu\n',
  hosts: '127.0.0.1 localhost\n127.0.1.1 ubuntu\n\n::1     ip6-localhost ip6-loopback\n',
  'os-release': [
    `PRETTY_NAME="${d.name} ${d.version}"`,
    `NAME="${d.name}"`,
    `VERSION_ID="${d.release}"`,
    `VERSION="${d.version} (Noble Numbat)"`,
    `VERSION_CODENAME=${d.codename}`,
    `ID=${d.id}`,
    'ID_LIKE=debian',
    'HOME_URL="https://www.ubuntu.com/"',
    `UBUNTU_CODENAME=${d.codename}`,
    '',
  ].join('\n'),
  'lsb-release': `DISTRIB_ID=Ubuntu\nDISTRIB_RELEASE=${d.release}\nDISTRIB_CODENAME=${d.codename}\nDISTRIB_DESCRIPTION="${d.name} ${d.version}"\n`,
  issue: `${d.name} ${d.version} \\n \\l\n\n`,
  passwd: [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
    'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
    'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
    'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
    'ubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash',
    '',
  ].join('\n'),
  group: [
    'root:x:0:',
    'daemon:x:1:',
    'adm:x:4:syslog,ubuntu',
    'sudo:x:27:ubuntu',
    'www-data:x:33:',
    'shadow:x:42:',
    'users:x:100:',
    'nogroup:x:65534:',
    'ubuntu:x:1000:',
    '',
  ].join('\n'),
  shadow: 'root:*:19962:0:99999:7:::\nubuntu:!:19962:0:99999:7:::\n',
  shells: '# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n',
  timezone: 'Etc/UTC\n',
  'resolv.conf': 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n',
  fstab: 'LABEL=cloudimg-rootfs\t/\text4\tdiscard,errors=remount-ro\t0 1\n',
  environment: 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n',
  motd: '',
  profile: 'if [ -d /etc/profile.d ]; then\n  for i in /etc/profile.d/*.sh; do\n    [ -r "$i" ] && . "$i"\n  done\nfi\n',
};

const bashrc = `# ~/.bashrc: executed by bash(1) for non-login shells.
HISTSIZE=1000
PS1='\\[\\e[01;32m\\]\\u@\\h\\[\\e[00m\\]:\\[\\e[01;34m\\]\\w\\[\\e[00m\\]\\$ '
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`;

const profile = `# ~/.profile: executed by the command interpreter for login shells.
if [ -d "$HOME/bin" ]; then
    PATH="$HOME/bin:$PATH"
fi
if [ -d "$HOME/.local/bin" ]; then
    PATH="$HOME/.local/bin:$PATH"
fi
`;

const dirs: [string, number][] = [
  ['/usr', 0o755], ['/usr/bin', 0o755], ['/usr/sbin', 0o755], ['/usr/lib', 0o755],
  ['/usr/local', 0o755], ['/usr/local/bin', 0o755], ['/usr/local/sbin', 0o755], ['/usr/local/lib', 0o755],
  ['/usr/share', 0o755], ['/usr/share/doc', 0o755], ['/usr/include', 0o755],
  ['/usr/share/man', 0o755], ['/usr/share/man/man1', 0o755], ['/usr/share/man/man5', 0o755],
  ['/usr/share/man/man7', 0o755], ['/usr/share/man/man8', 0o755], ['/usr/local/share', 0o755], ['/usr/local/share/man', 0o755],
  ['/etc', 0o755], ['/etc/profile.d', 0o755], ['/etc/skel', 0o755], ['/etc/apt', 0o755],
  ['/var', 0o755], ['/var/log', 0o775], ['/var/tmp', 0o1777], ['/var/lib', 0o755], ['/var/cache', 0o755],
  ['/var/www', 0o755], ['/var/mail', 0o2775],
  ['/home', 0o755], ['/root', 0o700], ['/tmp', 0o1777], ['/opt', 0o755], ['/srv', 0o755],
  ['/mnt', 0o755], ['/media', 0o755], ['/boot', 0o755], ['/run', 0o755], ['/sys', 0o555],
  ['/snap', 0o755], ['/lost+found', 0o700],
];

/** Builds a fresh Ubuntu 24.04 root filesystem. `commands` become ELF stubs in /usr/bin. */
export function bootstrap(commands: Iterable<string>, tty: (d: string) => void = () => {}): VFS {
  const vfs = new VFS();
  for (const [path, mode] of dirs) vfs.mkdir(path, false, mode);
  for (const [link, target] of [['/bin', 'usr/bin'], ['/sbin', 'usr/sbin'], ['/lib', 'usr/lib'], ['/lib64', 'usr/lib']]) {
    vfs.symlink(target, link);
  }
  for (const [name, content] of Object.entries(etc)) vfs.writeFile(`/etc/${name}`, content);
  vfs.chmod('/etc/shadow', 0o640);
  vfs.chown('/etc/shadow', 0, 42);
  vfs.writeFile('/etc/bash.bashrc', '# System-wide .bashrc file for interactive bash(1) shells.\n');
  vfs.writeFile('/etc/skel/.bashrc', bashrc);
  vfs.writeFile('/etc/skel/.profile', profile);
  vfs.writeFile('/etc/sudoers', 'root\tALL=(ALL:ALL) ALL\n%sudo\tALL=(ALL:ALL) ALL\n');
  vfs.chmod('/etc/sudoers', 0o440);
  vfs.writeFile('/var/log/syslog', `${new Date(machine.bootTime).toISOString()} ubuntu kernel: Linux version ${machine.release}\n`);
  vfs.writeFile('/root/.bashrc', bashrc);
  vfs.writeFile('/root/.profile', profile);

  installStubs(vfs, commands);
  mountVirtual(vfs, tty);
  createHome(vfs, DEFAULT_USER);
  return vfs;
}

/** Writes an ELF stub into /usr/bin for every command that lacks one. Expects root credentials. */
export function installStubs(vfs: VFS, commands: Iterable<string>): void {
  for (const name of commands) {
    const path = `/usr/bin/${name}`;
    if (vfs.exists(path)) continue;
    vfs.writeFile(path, `${ELF_MAGIC}${name}\n`);
    vfs.chmod(path, name === 'sudo' ? 0o4755 : 0o755);
  }
}

export function mountVirtual(vfs: VFS, tty: (d: string) => void): void {
  mountProc(vfs, () => vfs.readFile('/etc/hostname').trim());
  mountDev(vfs, tty);
}

export function createHome(vfs: VFS, user: { uid: number; gid: number; home: string }): void {
  vfs.mkdir(user.home, true, 0o750);
  for (const file of ['.bashrc', '.profile']) {
    vfs.writeFile(`${user.home}/${file}`, vfs.readFile(`/etc/skel/${file}`));
    vfs.chown(`${user.home}/${file}`, user.uid, user.gid);
  }
  vfs.writeFile(`${user.home}/.bash_logout`, '# ~/.bash_logout: executed by bash(1) when login shell exits.\n');
  vfs.chown(`${user.home}/.bash_logout`, user.uid, user.gid);
  vfs.chown(user.home, user.uid, user.gid);
}
