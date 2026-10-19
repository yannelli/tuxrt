import { GNU_HELP, type Page } from '../types.ts';
import { BACKUP, MANDATORY } from './files.ts';

const ownershipOptions = (reference: string, from: [string, string][] = []): [string, string][] => [
  ['-c, --changes', 'report only the files that actually change, unlike -v'],
  ['-f, --silent, --quiet', 'keep most error messages quiet'],
  ['-v, --verbose', 'report on every file handled'],
  ['--dereference', 'act on the file a symbolic link points to rather than on the link (the default)'],
  ['-h, --no-dereference', 'act on symbolic links themselves rather than their targets (only meaningful where the system lets a link have its own owner)'],
  ...from,
  ['--no-preserve-root', "give '/' no special protection (the default)"],
  ['--preserve-root', "refuse to recurse starting at '/'"],
  ['--reference=RFILE', reference],
  ['-R, --recursive', 'descend into directories and act on everything inside'],
  ['-H', 'follow symlinks given on the command line when they point at directories'],
  ['-L', 'descend through every symbolic link to a directory that turns up'],
  ['-P', 'never descend through symbolic links (the default)'],
  ...GNU_HELP,
];

const TRAVERSAL = '-H, -L and -P only matter together with -R, where they decide how symbolic links are followed during the walk. When several appear, the last one counts.';

export const attrPages: Page[] = [
  {
    name: 'touch',
    section: '1',
    summary: 'change file timestamps',
    synopsis: ['touch [OPTION]... FILE...'],
    description: [
      'Set the access and modification times of every FILE to the present moment.',
      'A FILE that is missing gets created as an empty file, except when -c or -h is in effect.',
      'The name - is special: it makes touch adjust the times of whatever file standard output refers to.',
      MANDATORY,
    ],
    options: [
      ['-a', 'update the access time only'],
      ['-c, --no-create', 'never create a file that is missing'],
      ['-d, --date=STRING', 'use the time described by STRING rather than now'],
      ['-f', 'accepted and ignored'],
      ['-h, --no-dereference', 'change the times of a symbolic link itself rather than its target (only meaningful where the system supports link timestamps)'],
      ['-m', 'update the modification time only'],
      ['-r, --reference=FILE', 'copy the times of FILE rather than using now'],
      ['-t STAMP', 'use a time written as [[CC]YY]MMDDhhmm[.ss] rather than now'],
      ['--time=WORD', 'pick one timestamp to change: access, atime or use act like -a; modify or mtime act like -m'],
      ...GNU_HELP,
    ],
    sections: [
      ['DATE STRING', [
        'The -d and -t options take differently formatted times.',
        'The STRING for --date is a loosely structured, human-friendly description. Inputs such as "2026-10-06 09:15", "Tue, 06 Oct 2026 09:15:00 +0200", "yesterday" or "last friday" are all accepted. It can mix a calendar date, a time of day, a time zone, a weekday, relative offsets and plain numbers. An empty string stands for midnight at the start of today.',
      ]],
    ],
    examples: [
      ['touch notes.txt', 'Create notes.txt if missing, or stamp it with the current time.'],
      ['touch -d "2024-01-01 12:00" report.pdf', 'Give report.pdf a fixed access and modification time.'],
      ['touch -r original.txt copy.txt', 'Make copy.txt carry the same times as original.txt.'],
    ],
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
      'Given TARGET and LINK_NAME, ln creates LINK_NAME pointing at TARGET. Given only TARGET, the new link appears in the working directory under the same base name. Given a DIRECTORY (last, or via -t), ln places one link per TARGET inside it.',
      'Links are hard links unless --symbolic is given. The new link names normally must not exist yet, and a hard link needs an existing TARGET. A symbolic link may contain any text at all; when it is followed, a relative value is resolved from the directory that holds the link.',
      MANDATORY,
    ],
    options: [
      ['--backup[=CONTROL]', 'save any destination file that would be replaced'],
      ['-b', 'same as --backup, without an argument'],
      ['-d, -F, --directory', 'let the superuser try to hard link a directory (the system will most likely refuse anyway)'],
      ['-f, --force', 'delete destination files that are in the way'],
      ['-i, --interactive', 'ask before deleting a destination'],
      ['-L, --logical', 'when a TARGET is a symbolic link, link to what it points to'],
      ['-n, --no-dereference', 'if LINK_NAME is a symbolic link to a directory, handle it as an ordinary file'],
      ['-P, --physical', 'when a TARGET is a symbolic link, hard link the link itself'],
      ['-r, --relative', 'together with -s, store a path relative to where the link lives'],
      ['-s, --symbolic', 'create symbolic links rather than hard links'],
      ['-S, --suffix=SUFFIX', 'use SUFFIX for backup names instead of the default'],
      ['-t, --target-directory=DIRECTORY', 'create the links inside DIRECTORY'],
      ['-T, --no-target-directory', 'never treat LINK_NAME as a directory to link into'],
      ['-v, --verbose', 'report each link as it is made'],
      ...GNU_HELP,
    ],
    sections: [
      [BACKUP[0], [
        ...BACKUP[1],
        'With -s, both -L and -P are ignored. Without it, the last of -L and -P decides what happens when a TARGET is a symbolic link; -P applies if neither is given.',
      ]],
    ],
    examples: [
      ['ln -s /usr/local/bin/tool-2.1 tool', 'Make a symbolic link called tool that points to /usr/local/bin/tool-2.1.'],
      ['ln data.csv data-link.csv', 'Make a hard link, giving one file a second name.'],
      ['ln -sfn releases/v2 current', 'Swap the symbolic link current over to releases/v2.'],
    ],
    seeAlso: ['link(2)', 'symlink(2)'],
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
      'chmod sets the permission (mode) bits of each FILE. The new mode is given either symbolically, as a list of edits, or as an octal number that spells out the bits directly.',
      'chmod leaves symbolic links themselves alone, since the system cannot set their permissions and never consults them. A link named on the command line has its target changed instead. Links met while walking a tree with -R are skipped.',
    ],
    options: [
      ['-c, --changes', 'report only the files that actually change, unlike -v'],
      ['-f, --silent, --quiet', 'keep most error messages quiet'],
      ['-v, --verbose', 'report on every file handled'],
      ['--no-preserve-root', "give '/' no special protection (the default)"],
      ['--preserve-root', "refuse to recurse starting at '/'"],
      ['--reference=RFILE', 'copy the mode of RFILE instead of taking a MODE; if RFILE is a symbolic link, its target is used'],
      ['-R, --recursive', 'descend into directories and change everything inside'],
      ...GNU_HELP,
    ],
    sections: [
      ['SYMBOLIC MODES', [
        'A symbolic mode looks like [ugoa...][[-+=][perms...]...]. Here perms is either any number of letters from rwxXst or exactly one letter from ugo. Several symbolic modes can be joined with commas.',
        "The leading letters say whose permissions change: u for the file's owner, g for members of the file's group, o for everyone else, and a for all three. Leaving them out works like a, except that bits masked by the umask stay as they are.",
        "The operator says what happens: + turns the listed bits on, - turns them off, and = turns them on while clearing every bit not listed. For directories, = leaves the setuid and setgid bits alone unless the mode mentions them.",
        "Permission letters: r is read, w is write, x is execute (search, for a directory), X is execute only for directories or for files that already have some execute bit, s is set-user-ID or set-group-ID on execution, and t is the restricted deletion flag (sticky bit). A single u, g or o in their place copies the permissions that the owner, group or others currently have.",
      ]],
      ['NUMERIC MODES', [
        "A numeric mode has one to four octal digits; missing leading digits count as zero. Each digit is a sum of 4, 2 and 1. Reading from the left in a four-digit mode: the first digit holds set-user-ID (4), set-group-ID (2) and the sticky bit (1); the second holds read (4), write (2) and execute (1) for the owner; the third does the same for the file's group; the last does the same for everyone else.",
      ]],
      ['MODE FORMAT', ["Each MODE is of the form '[ugoa]*([-+=]([rwxXst]*|[ugo]))+|[-+=][0-7]+'."]],
      ['SETUID AND SETGID BITS', [
        "An unprivileged user who asks for setgid on a file owned by a group they are not in will find the kernel quietly removes that bit. The kernel may refuse setuid or setgid in other situations too; chmod reports whatever the system actually stored.",
        'Numeric modes leave a directory\'s setuid and setgid bits as they were. Change them with symbolic modes (u+s, g-s), or force a numeric mode to clear them by writing it with an extra leading zero (00755), a minus sign (-6000) or an equals sign (=755).',
      ]],
      ['RESTRICTED DELETION FLAG OR STICKY BIT', [
        'What this single bit means depends on the file type. On a directory it is the restricted deletion flag: only the owner of an entry, or the owner of the directory, may delete or rename that entry. Shared writable directories such as /tmp normally have it. On regular files, some old systems used it as the sticky bit, keeping the program text in swap so it would start faster.',
      ]],
    ],
    examples: [
      ['chmod +x deploy.sh', 'Let everyone execute a script, within the limits of the umask.'],
      ['chmod 644 index.html', 'Read and write for the owner, read only for group and others.'],
      ['chmod u=rwx,g=rx,o= bin', 'Set exact bits by symbol: rwx for owner, r-x for group, none for others.'],
      ['chmod -R go-w shared/', 'Take away write access for group and others throughout a tree.'],
    ],
    seeAlso: ['chmod(2)'],
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
      'chown assigns a new owning user, a new group, or both, to each FILE. How the first argument is read:',
      ['OWNER', 'the user (name or numeric ID) becomes the owner; the group stays the same'],
      ['OWNER:GROUP', 'both the owner and the group change; no spaces are allowed around the colon'],
      ['OWNER:', "the user becomes the owner and the group becomes that user's login group"],
      [':GROUP', 'only the group changes, which is what chgrp does'],
      [': or empty', 'nothing changes'],
    ],
    options: ownershipOptions('copy the owner and group of RFILE instead of taking OWNER:GROUP; RFILE is always resolved through symbolic links', [
      ['--from=CURRENT_OWNER:CURRENT_GROUP', 'only touch files whose present owner and group match these; leave either half out to accept any value for it'],
    ]),
    sections: [
      ['NOTES', [
        TRAVERSAL,
        "A missing owner or group is left unchanged, except that a ':' after a symbolic OWNER with no GROUP selects that user's login group. Both OWNER and GROUP may be names or numbers.",
      ]],
    ],
    examples: [
      ['chown root /u', 'Make root the owner of /u.'],
      ['chown root:staff /u', 'Make root the owner of /u and staff its group.'],
      ['chown -hR root /u', 'Make root the owner of /u and everything below it.'],
    ],
    seeAlso: ['chown(2)'],
  },
  {
    name: 'chgrp',
    section: '1',
    summary: 'change group ownership',
    synopsis: [
      'chgrp [OPTION]... GROUP FILE...',
      'chgrp [OPTION]... --reference=RFILE FILE...',
    ],
    description: ['Assign GROUP as the group of every FILE, or with --reference, give each FILE the same group as RFILE.'],
    options: ownershipOptions('copy the group of RFILE instead of taking a GROUP; if RFILE is a symbolic link, its target is used'),
    sections: [['NOTES', [TRAVERSAL]]],
    examples: [
      ['chgrp staff /u', 'Make staff the group of /u.'],
      ['chgrp -hR staff /u', 'Make staff the group of /u and everything below it.'],
    ],
    seeAlso: ['chown(1)', 'chown(2)'],
  },
];
