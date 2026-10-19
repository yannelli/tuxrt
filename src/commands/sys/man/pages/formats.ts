import type { Page } from '../types.ts';

const SHADOW: [string, string] = ['shadow-utils 4.13', '11/04/2022'];
const SHADOW_MANUAL = 'File Formats and Configuration';

export const formatPages: Page[] = [
  {
    name: 'passwd',
    section: '5',
    summary: 'the password file',
    synopsis: [],
    description: [
      '/etc/passwd contains one line for each user account, with seven fields delimited by colons (":"). These fields are:',
      ['login name', 'The name the user logs in with. It should not contain capital letters.'],
      ['optional encrypted password', 'If the password field is a lower-case "x", the encrypted password is actually stored in the shadow(5) file instead; there must be a corresponding line in /etc/shadow, or else the user account is invalid. The field may be blank, in which case no password is required to authenticate as the specified login name; however, some applications may decide not to permit any access at all if the password field is blank. A password field which starts with an exclamation mark means that the password is locked.'],
      ['numerical user ID', 'The UID of the account. UID 0 is the superuser (root).'],
      ['numerical group ID', 'The primary group ID of the user. Group names and members are defined in group(5).'],
      ['user name or comment field', 'Also known as the GECOS field. It is used by various system utilities, such as finger(1), and often holds the full name of the user.'],
      ['user home directory', 'The initial working directory. The login program uses this information to set the value of the $HOME environment variable.'],
      ['optional user command interpreter', "The name of the user's command language interpreter, or the name of the initial program to execute. The login program uses this information to set the value of the $SHELL environment variable. If this field is empty, it defaults to the value /bin/sh. Accounts that must not log in commonly use /usr/sbin/nologin."],
      'The file should be readable by all users, since many utilities such as ls(1) use it to map user IDs to user names, but writable only by the superuser. A typical entry looks like:',
      { code: '       root:x:0:0:root:/root:/bin/bash' },
    ],
    sections: [
      ['FILES', [
        ['/etc/passwd', 'User account information.'],
        ['/etc/shadow', 'Optional encrypted password file.'],
        ['/etc/passwd-', 'Backup file for /etc/passwd. Note that this file is used by the tools of the shadow toolsuite, but not by all user and password management tools.'],
      ]],
    ],
    seeAlso: ['crypt(3)', 'getent(1)', 'getpwnam(3)', 'login(1)', 'passwd(1)', 'pwck(8)', 'pwconv(8)', 'pwunconv(8)', 'shadow(5)', 'su(1)', 'sulogin(8)'],
    footer: SHADOW,
    manual: SHADOW_MANUAL,
  },
  {
    name: 'group',
    section: '5',
    summary: 'user group file',
    synopsis: [],
    description: [
      'The /etc/group file is a text file that defines the groups on the system. There is one entry per line, with the following format:',
      { code: '       group_name:password:GID:user_list' },
      'The fields are as follows:',
      ['group_name', 'the name of the group.'],
      ['password', 'the (encrypted) group password. If this field is empty, no password is needed. When the gshadow(5) file is in use, this field normally contains an "x" and the real password is stored there.'],
      ['GID', 'the numeric group ID.'],
      ['user_list', 'a list of the usernames that are members of this group, separated by commas.'],
      'A typical entry looks like:',
      { code: '       sudo:x:27:ubuntu' },
    ],
    sections: [
      ['FILES', [
        ['/etc/group', 'Group account information.'],
        ['/etc/gshadow', 'Secure group account information.'],
      ]],
    ],
    seeAlso: ['chgrp(1)', 'gpasswd(1)', 'groupadd(8)', 'groupdel(8)', 'groupmod(8)', 'grpck(8)', 'newgrp(1)', 'sg(1)', 'gshadow(5)', 'passwd(5)', 'vigr(8)'],
    footer: SHADOW,
    manual: SHADOW_MANUAL,
  },
  {
    name: 'hosts',
    section: '5',
    summary: 'static table lookup for hostnames',
    synopsis: ['/etc/hosts'],
    description: [
      'This manual page describes the format of the /etc/hosts file. This file is a simple text file that associates IP addresses with hostnames, one line per IP address. For each host a single line should be present with the following information:',
      { code: '       IP_address canonical_hostname [aliases...]' },
      'The IP address can conform to either IPv4 or IPv6. Fields of the entry are separated by any number of blanks and/or tab characters. Text from a "#" character until the end of the line is a comment, and is ignored. Host names may contain only alphanumeric characters, minus signs ("-"), and periods ("."). They must begin with an alphabetic character and end with an alphanumeric character. Optional aliases provide for name changes, alternate spellings, shorter hostnames, or generic hostnames (for example, localhost). If required, a host may have two separate entries in this file; one for each version of the Internet Protocol (IPv4 and IPv6).',
      'The Berkeley Internet Name Domain (BIND) Server implements the Internet name server for UNIX systems. It augments or replaces the /etc/hosts file or hostname lookup, and frees a host from relying on /etc/hosts being up to date and complete.',
      'In modern systems, even though the host table has been superseded by DNS, it is still widely used for bootstrapping (most systems have a small host table containing the name and address information for important hosts on the local network), NIS, and isolated nodes (small installations without a name server).',
    ],
    sections: [
      ['FILES', [['/etc/hosts', 'The static table of hostnames.']]],
      ['NOTES', [
        'Modifications to this file normally take effect immediately, except in cases where the file is cached by applications.',
        'The order in which /etc/hosts and DNS are consulted is controlled by the hosts line in /etc/nsswitch.conf.',
      ]],
      ['EXAMPLES', [
        { code: '# The following lines are desirable for IPv4 capable hosts\n127.0.0.1       localhost\n\n# 127.0.1.1 is often used for the FQDN of the machine\n127.0.1.1       ubuntu\n192.168.1.10    foo.example.org        foo\n192.168.1.13    bar.example.org        bar\n\n# The following lines are desirable for IPv6 capable hosts\n::1             ip6-localhost ip6-loopback\nfe00::0         ip6-localnet\nff00::0         ip6-mcastprefix\nff02::1         ip6-allnodes\nff02::2         ip6-allrouters' },
      ]],
    ],
    seeAlso: ['hostname(1)', 'resolver(3)', 'host.conf(5)', 'nsswitch.conf(5)', 'resolv.conf(5)', 'hostname(7)', 'named(8)', 'Internet RFC 952'],
    footer: ['Linux man-pages 6.7', '2023-10-31'],
  },
  {
    name: 'os-release',
    section: '5',
    summary: 'Operating system identification',
    aliases: ['initrd-release', 'extension-release'],
    synopsis: ['/etc/os-release', '/usr/lib/os-release', '/etc/initrd-release', '/usr/lib/extension-release.d/extension-release.IMAGE'],
    description: [
      'The /etc/os-release and /usr/lib/os-release files contain operating system identification data.',
      'The format of os-release is a newline-separated list of environment-like shell-compatible variable assignments. It is possible to source the configuration from Bourne shell scripts, however, beyond mere variable assignments, no shell features are supported (this means variable expansion is explicitly not supported), allowing applications to read the file without implementing a shell compatible execution engine. Variable assignment values must be enclosed in double or single quotes if they include spaces, semicolons or other special characters outside of A-Z, a-z, 0-9. Lines beginning with "#" are ignored.',
      'The file /etc/os-release takes precedence over /usr/lib/os-release. Applications should check for the former, and exclusively use its data if it exists, and only fall back to /usr/lib/os-release if it is missing. /usr/lib/os-release is the recommended place to store OS release information as part of vendor trees; /etc/os-release should be a relative symlink to /usr/lib/os-release.',
    ],
    sections: [
      ['OPTIONS', [
        'The following OS identifications parameters may be set using os-release:',
        ['NAME=', 'A string identifying the operating system, without a version component, and suitable for presentation to the user. If not set, a default of "NAME=Linux" may be used. Examples: "NAME=Fedora", "NAME="Debian GNU/Linux"".'],
        ['ID=', 'A lower-case string (no spaces or other characters outside of 0-9, a-z, ".", "_" and "-") identifying the operating system, excluding any version information and suitable for processing by scripts or usage in generated filenames. If not set, a default of "ID=linux" may be used. Examples: "ID=fedora", "ID=debian".'],
        ['ID_LIKE=', 'A space-separated list of operating system identifiers in the same syntax as the ID= setting. It should list identifiers of operating systems that are closely related to the local operating system in regards to packaging and programming interfaces, for example listing one or more OS identifiers the local OS is a derivative from. For an operating system with "ID=ubuntu", an assignment of "ID_LIKE=debian" is appropriate.'],
        ['PRETTY_NAME=', 'A pretty operating system name in a format suitable for presentation to the user. May or may not contain a release code name or OS version of some kind, as suitable. If not set, a default of "PRETTY_NAME="Linux"" may be used.'],
        ['VERSION=', 'A string identifying the operating system version, excluding any OS name information, possibly including a release code name, and suitable for presentation to the user. Examples: "VERSION=17", "VERSION="17 (Beefy Miracle)"".'],
        ['VERSION_ID=', 'A lower-case string (mostly numeric, no spaces or other characters outside of 0-9, a-z, ".", "_" and "-") identifying the operating system version, excluding any OS name information or release code name, and suitable for processing by scripts or usage in generated filenames. Examples: "VERSION_ID=17", "VERSION_ID=11.04".'],
        ['VERSION_CODENAME=', 'A lower-case string (no spaces or other characters outside of 0-9, a-z, ".", "_" and "-") identifying the operating system release code name, excluding any OS name information or release version, and suitable for processing by scripts or usage in generated filenames. Examples: "VERSION_CODENAME=buster", "VERSION_CODENAME=xenial".'],
        ['BUILD_ID=', 'A string uniquely identifying the system image originally used as the installation base. In most cases, VERSION_ID or IMAGE_ID+IMAGE_VERSION are updated when the entire system image is replaced during an update; BUILD_ID may be used in distributions where the original installation image version is important.'],
        ['HOME_URL=', 'The homepage of the operating system, or alternatively some homepage of the specific version of the operating system. Values should be in RFC3986 format, and should be "http:" or "https:" URLs. Only one URL shall be listed in each setting.'],
        ['DOCUMENTATION_URL=', 'The main documentation page for this operating system.'],
        ['SUPPORT_URL=', 'The main support page for the operating system, if there is any. This is primarily intended for operating systems which vendors provide support for.'],
        ['BUG_REPORT_URL=', 'The main bug reporting page for the operating system, if there is any. This is primarily intended for operating systems that rely on community QA.'],
        ['PRIVACY_POLICY_URL=', 'The main privacy policy page for the operating system, if there is any.'],
        ['SUPPORT_END=', 'The date at which support for this version of the OS ends, in the format YYYY-MM-DD. The date is interpreted as the start of the day in UTC.'],
        ['LOGO=', 'A string, specifying the name of an icon as defined by freedesktop.org Icon Theme Specification. This can be used by graphical applications to display an operating system or distributor logo. Example: "LOGO=fedora-logo".'],
        ['ANSI_COLOR=', 'A suggested presentation color when showing the OS name on the console. This should be specified as string suitable for inclusion in the ESC [ m ANSI/ECMA-48 escape code for setting graphical rendition. Example: "ANSI_COLOR="0;31"" for red.'],
        'If you are using this file to determine the OS or a specific version of it, use the ID and VERSION_ID fields, possibly with ID_LIKE as fallback for ID. When looking for an OS identification string for presentation to the user use the PRETTY_NAME field. Operating systems may extend os-release with their own fields, such as UBUNTU_CODENAME on Ubuntu.',
      ]],
      ['EXAMPLES', [
        '/etc/os-release on Ubuntu 24.04 LTS:',
        { code: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\nSUPPORT_URL="https://help.ubuntu.com/"\nBUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"\nUBUNTU_CODENAME=noble\nLOGO=ubuntu-logo' },
        'Reading os-release in sh(1):',
        { code: '#!/bin/sh -eu\ntest -e /etc/os-release && os_release=\'/etc/os-release\' \\\n                        || os_release=\'/usr/lib/os-release\'\n. "${os_release}"\necho "Running on ${PRETTY_NAME:-Linux}"' },
      ]],
    ],
    seeAlso: ['systemd(1)', 'lsb_release(1)', 'hostname(5)', 'machine-id(5)', 'machine-info(5)'],
    footer: ['systemd 255', ''],
    manual: 'os-release',
  },
];
