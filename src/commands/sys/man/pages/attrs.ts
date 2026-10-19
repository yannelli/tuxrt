import { COREUTILS, coreutilsDocs, GNU_HELP, type Page } from '../types.ts';

const ownershipOptions = (reference: string, from: [string, string][] = []): [string, string][] => [
  ['-c, --changes', 'like verbose but report only when a change is made'],
  ['-f, --silent, --quiet', 'suppress most error messages'],
  ['-v, --verbose', 'output a diagnostic for every file processed'],
  ['--dereference', 'affect the referent of each symbolic link (this is the default), rather than the symbolic link itself'],
  ['-h, --no-dereference', 'affect symbolic links instead of any referenced file (useful only on systems that can change the ownership of a symlink)'],
  ...from,
  ['--no-preserve-root', "do not treat '/' specially (the default)"],
  ['--preserve-root', "fail to operate recursively on '/'"],
  ['--reference=RFILE', reference],
  ['-R, --recursive', 'operate on files and directories recursively'],
  ['-H', 'if a command line argument is a symbolic link to a directory, traverse it'],
  ['-L', 'traverse every symbolic link to a directory encountered'],
  ['-P', 'do not traverse any symbolic links (default)'],
  ...GNU_HELP,
];

const TRAVERSAL = 'The -H, -L and -P options modify how a hierarchy is traversed when the -R option is also specified. If more than one is specified, only the final one takes effect.';

export const attrPages: Page[] = [
  {
    name: 'touch',
    section: '1',
    summary: 'change file timestamps',
    synopsis: ['touch [OPTION]... FILE...'],
    description: [
      'Update the access and modification times of each FILE to the current time.',
      'A FILE argument that does not exist is created empty, unless -c or -h is supplied.',
      'A FILE argument string of - is handled specially and causes touch to change the times of the file associated with standard output.',
      'Mandatory arguments to long options are mandatory for short options too.',
    ],
    options: [
      ['-a', 'change only the access time'],
      ['-c, --no-create', 'do not create any files'],
      ['-d, --date=STRING', 'parse STRING and use it instead of current time'],
      ['-f', '(ignored)'],
      ['-h, --no-dereference', 'affect each symbolic link instead of any referenced file (useful only on systems that can change the timestamps of a symlink)'],
      ['-m', 'change only the modification time'],
      ['-r, --reference=FILE', "use this file's times instead of current time"],
      ['-t STAMP', 'use [[CC]YY]MMDDhhmm[.ss] instead of current time'],
      ['--time=WORD', 'change the specified time: WORD is access, atime, or use: equivalent to -a; WORD is modify or mtime: equivalent to -m'],
      ...GNU_HELP,
    ],
    sections: [
      ['DATE STRING', [
        'Note that the -d and -t options accept different time-date formats.',
        'The --date=STRING is a mostly free format human readable date string such as "Sun, 29 Feb 2004 16:21:42 -0800" or "2004-02-29 16:21:42" or even "next Thursday". A date string may contain items indicating calendar date, time of day, time zone, day of week, relative time, relative date, and numbers. An empty string indicates the beginning of the day. The date string format is more complex than is easily documented here but is fully described in the info documentation.',
      ]],
    ],
    examples: [
      ['touch notes.txt', 'Create notes.txt if it does not exist, otherwise set its times to now.'],
      ['touch -d "2024-01-01 12:00" report.pdf', 'Set both timestamps of report.pdf to a specific date.'],
      ['touch -r original.txt copy.txt', 'Give copy.txt the same timestamps as original.txt.'],
    ],
    seeAlso: [coreutilsDocs('touch')],
    footer: COREUTILS,
  },
  {
    name: 'ln',
    section: '1',
    summary: 'make links between files',
    synopsis: [
      'ln [OPTION]... [-T] TARGET LINK_NAME',
      'ln [OPTION]... TARGET',
      'ln [OPTION]... TARGET... DIRECTORY',
      'ln [OPTION]... -t DIRECTORY TARGET...',
    ],
    description: [
      'In the 1st form, create a link to TARGET with the name LINK_NAME. In the 2nd form, create a link to TARGET in the current directory. In the 3rd and 4th forms, create links to each TARGET in DIRECTORY. Create hard links by default, symbolic links with --symbolic. By default, each destination (name of new link) should not already exist. When creating hard links, each TARGET must exist. Symbolic links can hold arbitrary text; if later resolved, a relative link is interpreted in relation to its parent directory.',
      'Mandatory arguments to long options are mandatory for short options too.',
    ],
    options: [
      ['--backup[=CONTROL]', 'make a backup of each existing destination file'],
      ['-b', 'like --backup but does not accept an argument'],
      ['-d, -F, --directory', 'allow the superuser to attempt to hard link directories (note: will probably fail due to system restrictions, even for the superuser)'],
      ['-f, --force', 'remove existing destination files'],
      ['-i, --interactive', 'prompt whether to remove destinations'],
      ['-L, --logical', 'dereference TARGETs that are symbolic links'],
      ['-n, --no-dereference', 'treat LINK_NAME as a normal file if it is a symbolic link to a directory'],
      ['-P, --physical', 'make hard links directly to symbolic links'],
      ['-r, --relative', 'with -s, create links relative to link location'],
      ['-s, --symbolic', 'make symbolic links instead of hard links'],
      ['-S, --suffix=SUFFIX', 'override the usual backup suffix'],
      ['-t, --target-directory=DIRECTORY', 'specify the DIRECTORY in which to create the links'],
      ['-T, --no-target-directory', 'treat LINK_NAME as a normal file always'],
      ['-v, --verbose', 'print name of each linked file'],
      ...GNU_HELP,
    ],
    sections: [
      ['BACKUP CONTROL', [
        "The backup suffix is '~', unless set with --suffix or SIMPLE_BACKUP_SUFFIX. The version control method may be selected via the --backup option or through the VERSION_CONTROL environment variable. Here are the values:",
        ['none, off', 'never make backups (even if --backup is given)'],
        ['numbered, t', 'make numbered backups'],
        ['existing, nil', 'numbered if numbered backups exist, simple otherwise'],
        ['simple, never', 'always make simple backups'],
        'Using -s ignores -L and -P. Otherwise, the last option specified controls behavior when a TARGET is a symbolic link, defaulting to -P.',
      ]],
    ],
    examples: [
      ['ln -s /usr/local/bin/tool-2.1 tool', 'Create a symbolic link named tool pointing at /usr/local/bin/tool-2.1.'],
      ['ln data.csv data-link.csv', 'Create a hard link: a second name for the same file.'],
      ['ln -sfn releases/v2 current', 'Repoint the symbolic link current at releases/v2, replacing the old link.'],
    ],
    seeAlso: ['link(2)', 'symlink(2)', coreutilsDocs('ln')],
    footer: COREUTILS,
  },
  {
    name: 'chmod',
    section: '1',
    summary: 'change file mode bits',
    synopsis: [
      'chmod [OPTION]... MODE[,MODE]... FILE...',
      'chmod [OPTION]... OCTAL-MODE FILE...',
      'chmod [OPTION]... --reference=RFILE FILE...',
    ],
    description: [
      'This manual page documents the GNU version of chmod. chmod changes the file mode bits of each given file according to mode, which can be either a symbolic representation of changes to make, or an octal number representing the bit pattern for the new mode bits.',
      'The format of a symbolic mode is [ugoa...][[-+=][perms...]...], where perms is either zero or more letters from the set rwxXst, or a single letter from the set ugo. Multiple symbolic modes can be given, separated by commas.',
      "A combination of the letters ugoa controls which users' access to the file will be changed: the user who owns it (u), other users in the file's group (g), other users not in the file's group (o), or all users (a). If none of these are given, the effect is as if (a) were given, but bits that are set in the umask are not affected.",
      "The operator + causes the selected file mode bits to be added to the existing file mode bits of each file; - causes them to be removed; and = causes them to be added and causes unmentioned bits to be removed except that a directory's unmentioned set user and group ID bits are not affected.",
      "The letters rwxXst select file mode bits for the affected users: read (r), write (w), execute (or search for directories) (x), execute/search only if the file is a directory or already has execute permission for some user (X), set user or group ID on execution (s), restricted deletion flag or sticky bit (t). Instead of one or more of these letters, you can specify exactly one of the letters ugo: the permissions granted to the user who owns the file (u), the permissions granted to other users who are members of the file's group (g), and the permissions granted to users that are in neither of the two preceding categories (o).",
      "A numeric mode is from one to four octal digits (0-7), derived by adding up the bits with values 4, 2, and 1. Omitted digits are assumed to be leading zeros. The first digit selects the set user ID (4) and set group ID (2) and restricted deletion or sticky (1) attributes. The second digit selects permissions for the user who owns the file: read (4), write (2), and execute (1); the third selects permissions for other users in the file's group, with the same values; and the fourth for other users not in the file's group, with the same values.",
      'chmod never changes the permissions of symbolic links; the chmod system call cannot change their permissions. This is not a problem since the permissions of symbolic links are never used. However, for each symbolic link listed on the command line, chmod changes the permissions of the pointed-to file. In contrast, chmod ignores symbolic links encountered during recursive directory traversals.',
    ],
    options: [
      ['-c, --changes', 'like verbose but report only when a change is made'],
      ['-f, --silent, --quiet', 'suppress most error messages'],
      ['-v, --verbose', 'output a diagnostic for every file processed'],
      ['--no-preserve-root', "do not treat '/' specially (the default)"],
      ['--preserve-root', "fail to operate recursively on '/'"],
      ['--reference=RFILE', "use RFILE's mode instead of specifying MODE values. RFILE is always dereferenced if a symbolic link."],
      ['-R, --recursive', 'change files and directories recursively'],
      ...GNU_HELP,
    ],
    sections: [
      ['MODE FORMAT', ["Each MODE is of the form '[ugoa]*([-+=]([rwxXst]*|[ugo]))+|[-+=][0-7]+'."]],
      ['SETUID AND SETGID BITS', [
        "chmod clears the set-group-ID bit of a regular file if the file's group ID does not match the user's effective group ID or one of the user's supplementary group IDs, unless the user has appropriate privileges. Additional restrictions may cause the set-user-ID and set-group-ID bits of MODE or RFILE to be ignored. This behavior depends on the policy and functionality of the underlying chmod system call. When in doubt, check the underlying system behavior.",
        'For directories chmod preserves set-user-ID and set-group-ID bits unless you explicitly specify otherwise. You can set or clear the bits with symbolic modes like u+s and g-s. To clear these bits for directories with a numeric mode requires an additional leading zero like 00755, leading minus like -6000, or leading equals like =755.',
      ]],
      ['RESTRICTED DELETION FLAG OR STICKY BIT', [
        "The restricted deletion flag or sticky bit is a single bit, whose interpretation depends on the file type. For directories, it prevents unprivileged users from removing or renaming a file in the directory unless they own the file or the directory; this is called the restricted deletion flag for the directory, and is commonly found on world-writable directories like /tmp. For regular files on some older systems, the bit saves the program's text image on the swap device so it will load more quickly when run; this is called the sticky bit.",
      ]],
    ],
    examples: [
      ['chmod +x deploy.sh', 'Make a script executable for everyone (subject to the umask).'],
      ['chmod 644 index.html', 'Owner can read and write; group and others can only read.'],
      ['chmod u=rwx,g=rx,o= bin', 'Set exact permissions symbolically: rwx for the owner, r-x for the group, nothing for others.'],
      ['chmod -R go-w shared/', 'Recursively remove write permission for group and others.'],
    ],
    seeAlso: ['chmod(2)', coreutilsDocs('chmod')],
    footer: COREUTILS,
  },
  {
    name: 'chown',
    section: '1',
    summary: 'change file owner and group',
    synopsis: [
      'chown [OPTION]... [OWNER][:[GROUP]] FILE...',
      'chown [OPTION]... --reference=RFILE FILE...',
    ],
    description: [
      "This manual page documents the GNU version of chown. chown changes the user and/or group ownership of each given file. If only an owner (a user name or numeric user ID) is given, that user is made the owner of each given file, and the files' group is not changed. If the owner is followed by a colon and a group name (or numeric group ID), with no spaces between them, the group ownership of the files is changed as well. If a colon but no group name follows the user name, that user is made the owner of the files and the group of the files is changed to that user's login group. If the colon and group are given, but the owner is omitted, only the group of the files is changed; in this case, chown performs the same function as chgrp. If only a colon is given, or if the entire operand is empty, neither the owner nor the group is changed.",
    ],
    options: ownershipOptions("use RFILE's owner and group rather than specifying OWNER:GROUP values. RFILE is always dereferenced.", [
      ['--from=CURRENT_OWNER:CURRENT_GROUP', 'change the owner and/or group of each file only if its current owner and/or group match those specified here. Either may be omitted, in which case a match is not required for the omitted attribute'],
    ]),
    sections: [
      ['NOTES', [
        TRAVERSAL,
        "Owner is unchanged if missing. Group is unchanged if missing, but changed to login group if implied by a ':' following a symbolic OWNER. OWNER and GROUP may be numeric as well as symbolic.",
      ]],
    ],
    examples: [
      ['chown root /u', 'Change the owner of /u to "root".'],
      ['chown root:staff /u', 'Likewise, but also change its group to "staff".'],
      ['chown -hR root /u', 'Change the owner of /u and subfiles to "root".'],
    ],
    seeAlso: ['chown(2)', coreutilsDocs('chown')],
    footer: COREUTILS,
  },
  {
    name: 'chgrp',
    section: '1',
    summary: 'change group ownership',
    synopsis: [
      'chgrp [OPTION]... GROUP FILE...',
      'chgrp [OPTION]... --reference=RFILE FILE...',
    ],
    description: ['Change the group of each FILE to GROUP. With --reference, change the group of each FILE to that of RFILE.'],
    options: ownershipOptions("use RFILE's group rather than specifying a GROUP. RFILE is always dereferenced if a symbolic link."),
    sections: [['NOTES', [TRAVERSAL]]],
    examples: [
      ['chgrp staff /u', 'Change the group of /u to "staff".'],
      ['chgrp -hR staff /u', 'Change the group of /u and subfiles to "staff".'],
    ],
    seeAlso: ['chown(1)', 'chown(2)', coreutilsDocs('chgrp')],
    footer: COREUTILS,
  },
];
