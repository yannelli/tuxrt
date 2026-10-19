export interface Pkg {
  name: string;
  version: string;
  arch: string;
  section: string;
  priority: string;
  /** Download size in bytes. */
  size: number;
  /** Installed size in KiB, as dpkg records it. */
  isize: number;
  desc: string;
  bins: string[];
}

type Row = [string, string, string, string, string, number, number, string, string];

const rows: Row[] = [
  ['apt', '2.7.14build2', 'amd64', 'admin', 'important', 1_376_000, 4_140, 'commandline package manager', 'apt apt-get apt-cache'],
  ['bash', '5.2.21-2ubuntu4', 'amd64', 'shells', 'required', 794_000, 1_864, 'GNU Bourne Again SHell', 'bash'],
  ['build-essential', '12.10ubuntu1', 'amd64', 'devel', 'optional', 4_928, 21, 'Informational list of build-essential packages', ''],
  ['ca-certificates', '20240203', 'all', 'misc', 'important', 159_000, 383, 'Common CA certificates', ''],
  ['coreutils', '9.4-3ubuntu6', 'amd64', 'utils', 'required', 1_413_000, 7_224, 'GNU core utilities',
    'basename cat chgrp chmod chown cp cut date dd df dirname du echo env false head id ln ls md5sum mkdir mktemp mv nproc ' +
    'printf pwd readlink realpath rm rmdir seq sha256sum sleep sort stat tail tee touch tr true truncate uname uniq wc whoami yes'],
  ['cowsay', '3.03+dfsg2-8', 'all', 'universe/games', 'optional', 18_600, 91, 'configurable talking cow', 'cowsay cowthink'],
  ['curl', '8.5.0-2ubuntu10.4', 'amd64', 'web', 'optional', 226_600, 534, 'command line tool for transferring data with URL syntax', 'curl'],
  ['dpkg', '1.22.6ubuntu6.1', 'amd64', 'admin', 'required', 1_282_000, 6_576, 'Debian package management system', 'dpkg dpkg-deb dpkg-query'],
  ['figlet', '2.2.5-3', 'amd64', 'universe/text', 'optional', 133_000, 715, 'Make large character ASCII banners out of ordinary text', 'figlet'],
  ['findutils', '4.9.0-5build1', 'amd64', 'utils', 'required', 304_000, 1_552, 'utilities for finding files--find, xargs', 'find xargs'],
  ['git', '1:2.43.0-1ubuntu7.1', 'amd64', 'vcs', 'optional', 3_679_000, 22_595, 'fast, scalable, distributed revision control system', 'git'],
  ['grep', '3.11-4build1', 'amd64', 'utils', 'required', 162_000, 422, 'GNU grep, egrep and fgrep', 'grep egrep fgrep'],
  ['gzip', '1.12-1ubuntu3', 'amd64', 'utils', 'required', 99_000, 252, 'GNU compression utilities', 'gzip gunzip zcat'],
  ['htop', '3.3.0-4build1', 'amd64', 'utils', 'optional', 171_000, 434, 'interactive processes viewer', 'htop'],
  ['jq', '1.7.1-3build1', 'amd64', 'utils', 'optional', 65_700, 99, 'lightweight and flexible command-line JSON processor', 'jq'],
  ['mawk', '1.3.4.20240123-1build1', 'amd64', 'interpreters', 'required', 127_000, 228, 'Pattern scanning and text processing language', 'mawk awk'],
  ['nano', '7.2-2build1', 'amd64', 'editors', 'important', 280_000, 881, 'small, friendly text editor inspired by Pico', 'nano rnano'],
  ['ncurses-bin', '6.4+20240113-1ubuntu2', 'amd64', 'utils', 'required', 188_000, 638, 'terminal-related programs and man pages', 'clear infocmp reset tput'],
  ['neofetch', '7.1.0-4', 'all', 'universe/utils', 'optional', 82_600, 357, 'Shows Linux System Information with Distribution Logo', 'neofetch'],
  ['nginx', '1.24.0-2ubuntu7.1', 'amd64', 'httpd', 'optional', 521_000, 1_404, 'small, powerful, scalable web/proxy server', 'nginx'],
  ['nodejs', '22.11.0-1nodesource1', 'amd64', 'web', 'optional', 37_012_000, 234_880, 'Node.js event-based server-side javascript engine', 'node nodejs'],
  ['passwd', '1:4.13+dfsg1-4ubuntu3', 'amd64', 'admin', 'required', 845_000, 2_840, 'change and administer password and group data', 'chage chfn chsh gpasswd passwd'],
  ['procps', '2:4.0.4-4ubuntu3', 'amd64', 'admin', 'important', 707_000, 1_626, '/proc file system utilities', 'free kill pgrep pidof pkill ps top uptime vmstat w watch'],
  ['python3', '3.12.3-0ubuntu2', 'amd64', 'python', 'important', 23_000, 83, 'interactive high-level object-oriented language (default python3 version)', 'python3'],
  ['sed', '4.9-2build1', 'amd64', 'utils', 'required', 192_000, 512, 'GNU stream editor for filtering/transforming text', 'sed'],
  ['sl', '5.02-1build1', 'amd64', 'universe/games', 'optional', 12_400, 51, "Correct you if you type `sl' by mistake", 'sl'],
  ['sudo', '1.9.15p5-3ubuntu5', 'amd64', 'admin', 'important', 964_000, 3_656, 'Provide limited super user privileges to specific users', 'sudo sudoedit'],
  ['tar', '1.35+dfsg-3build1', 'amd64', 'utils', 'required', 256_000, 960, 'GNU version of the tar archiving utility', 'tar'],
  ['tree', '2.1.1-2ubuntu3', 'amd64', 'universe/utils', 'optional', 47_400, 111, 'displays an indented directory tree, in color', 'tree'],
  ['util-linux', '2.39.3-9ubuntu6.1', 'amd64', 'utils', 'required', 1_128_000, 4_644, 'miscellaneous system utilities', 'dmesg findmnt lsblk more mount su umount'],
  ['vim', '2:9.1.0016-1ubuntu7.3', 'amd64', 'editors', 'optional', 1_881_000, 4_123, 'Vi IMproved - enhanced vi editor', 'vim'],
  ['wget', '1.21.4-1ubuntu4.1', 'amd64', 'web', 'standard', 334_000, 949, 'retrieves files from the web', 'wget'],
];

export const CATALOG = new Map<string, Pkg>(
  rows.map(([name, version, arch, section, priority, size, isize, desc, bins]) => [
    name,
    { name, version, arch, section, priority, size, isize, desc, bins: bins.split(' ').filter(Boolean) },
  ]),
);

export const BASE = [
  'apt', 'bash', 'ca-certificates', 'coreutils', 'cowsay', 'curl', 'dpkg', 'findutils', 'grep', 'gzip', 'jq',
  'mawk', 'ncurses-bin', 'nodejs', 'passwd', 'procps', 'sed', 'sudo', 'tar', 'util-linux', 'wget',
];

export const ESSENTIAL = new Set(['apt', 'bash', 'coreutils', 'dpkg', 'findutils', 'grep', 'gzip', 'ncurses-bin', 'sed', 'tar', 'util-linux']);

export const MAINTAINER = 'Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>';
export const ARCHIVE = 'http://archive.ubuntu.com/ubuntu';

export function component(p: Pkg): string {
  return p.section.includes('/') ? p.section.split('/')[0] : 'main';
}

/** Point releases ("ubuntu10.4") only exist in noble-updates; everything else is the release pocket. */
export function suite(version: string): string {
  return /ubuntu\d+\.\d+$/.test(version) ? 'noble-updates' : 'noble';
}

/** apt's SizeToStr: SI units, one decimal below 100. Callers append "B". */
export function sizeToStr(bytes: number): string {
  let n = bytes;
  for (const unit of ['', 'k', 'M', 'G']) {
    if (n < 100 && unit) return `${n.toFixed(1)} ${unit}`;
    if (n < 10_000) return `${Math.round(n)} ${unit}`;
    n /= 1000;
  }
  return `${Math.round(n)} T`;
}

export function globRegex(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}
