import type { Page } from '../types.ts';

const STATUS: [string, string][] = [
  ['0', 'The program completed successfully.'],
  ['1', 'Bad usage or syntax, or a broken configuration file.'],
  ['2', 'An error happened while running.'],
];

const CHILD_FAILED: [string, string] = ['3', 'A child process exited with a non-zero status.'];
const NOT_FOUND: [string, string] = ['16', 'Nothing matched the given names or keywords.'];

const HELP: [string, string] = ['-?, --help', 'Show usage help, then exit.'];
const VERSION: [string, string] = ['-V, --version', 'Show the version, then exit.'];
const CONFIG: [string, string] = ['-C file, --config-file=file', 'Read file as the user configuration in place of ~/.manpath.'];

const COMMON: [string, string][] = [
  ['-d, --debug', 'Show debugging output.'],
  ['-v, --verbose', 'Show extra warnings.'],
  ['-r, --regex', 'Read each name as an extended regular expression. apropos does this by default.'],
  ['-w, --wildcard', 'Read each name as a shell wildcard pattern, which has to match the entire page name.'],
];

const SEARCH: [string, string][] = [
  ['-l, --long', 'Print full lines instead of cutting them at the terminal width.'],
  ['-s list, --sections=list, --section=list', 'Restrict the search to the listed sections, separated by colons or commas. A plain section like 3 also covers subsections such as 3perl.'],
  ['-m system[,...], --systems=system[,...]', 'Include the manual trees of other operating systems, when they are installed.'],
  ['-M path, --manpath=path', 'Search this colon separated path in place of $MANPATH or the built-in default.'],
  ['-L locale, --locale=locale', 'Choose translated pages for locale rather than for the current locale.'],
  CONFIG,
  HELP,
  ['--usage', 'Show a one-line usage synopsis, then exit.'],
  VERSION,
];

export const manualPages: Page[] = [
  {
    name: 'man',
    section: '1',
    summary: 'an interface to the system reference manuals',
    synopsis: [
      'man [man options] [[section] page ...] ...',
      'man -k [apropos options] regexp ...',
      'man -K [man options] [section] term ...',
      'man -f [whatis options] page ...',
      'man -l [man options] file ...',
      'man -w|-W [man options] page ...',
    ],
    description: [
      'man shows pages from the system reference manual. A page argument is normally the name of a command, function or file; man looks it up and sends the formatted page to a pager. Naming a section restricts the lookup to that section. Without one, sections are tried in a fixed order (the SECTION setting in /etc/manpath.config) and only the first hit is shown, even when another section has a page of the same name.',
      'Sections are numbered as follows:',
      ['1', 'Programs and shell commands'],
      ['2', 'System calls (kernel entry points)'],
      ['3', 'Library functions'],
      ['4', 'Special files, mostly under /dev'],
      ['5', 'File formats and conventions, such as /etc/passwd'],
      ['6', 'Games'],
      ['7', 'Overviews, conventions and miscellany, such as man(7) and groff(7)'],
      ['8', 'System administration commands, usually for root'],
      ['9', 'Kernel routines (non-standard)'],
      'Pages share a common layout with headings like NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXIT STATUS, ENVIRONMENT, FILES, EXAMPLES and SEE ALSO. In a synopsis, bold words are typed literally and underlined words stand for a value you supply. Square brackets, as in [-abc], enclose optional parts; -a|-b separates choices that exclude each other; and ... after an argument means it may repeat.',
    ],
    options: [
      ['-a, --all', 'Display all matching pages in sequence rather than stopping at the first.'],
      ['-f, --whatis', 'Act as whatis(1), printing the one-line description of each page when there is one.'],
      ['-k, --apropos', 'Act as apropos(1), matching the keywords as regular expressions against page names and short descriptions.'],
      ['-K, --global-apropos', 'Look for term inside the full text of every page. This is slow, so limit it to a section when you can.'],
      ['-l, --local-file', 'Format the named files directly instead of searching the manual. Use - to read standard input.'],
      ['-w, --where, --path, --location', 'Print where the source of each page that would be shown lives, and display nothing.'],
      ['-W, --where-cat, --location-cat', 'Print where the preformatted cat file of each page that would be shown lives.'],
      ['-s list, -S list, --sections=list', 'Look only in the listed sections, separated by colons or commas. Takes precedence over MANSECT.'],
      ['-M path, --manpath=path', 'Search the colon separated path for pages in place of MANPATH or the built-in default.'],
      ['-P pager, --pager=pager', 'Display pages with pager. Takes priority over MANPAGER and PAGER; less is used otherwise.'],
      ['-L locale, --locale=locale', 'Prefer pages for locale over the locale taken from the environment.'],
      HELP,
      VERSION,
    ],
    sections: [
      ['EXIT STATUS', [
        ...STATUS,
        CHILD_FAILED,
        ['16', 'One or more of the requested pages, files or keywords could not be found.'],
      ]],
      ['ENVIRONMENT', [
        ['MANPATH', 'Search path for manual pages, when set.'],
        ['MANPAGER, PAGER', 'Pager used for display. MANPAGER wins over PAGER; with neither set, less is used.'],
        ['MANSECT', 'Colon separated list of sections that controls which are searched and in which order.'],
        ['MANWIDTH', 'Line width for formatting. When unset, the terminal width is used, or 80 if that is unknown.'],
      ]],
      ['FILES', [
        ['/etc/manpath.config', 'Configuration for man-db.'],
        ['/usr/share/man', 'The system-wide page tree.'],
      ]],
    ],
    examples: [
      ['man ls', 'Read the page for ls.'],
      ['man 5 passwd', 'Read the section 5 page describing the passwd file instead of the passwd command.'],
      ['man -a intro', 'Read each intro page, one after another.'],
      ['man -k printf', 'List pages whose name or description matches printf, like apropos printf.'],
      ['man -f smail', 'Print the descriptions of pages named smail, like whatis smail.'],
    ],
    seeAlso: ['apropos(1)', 'groff(1)', 'less(1)', 'manpath(1)', 'nroff(1)', 'troff(1)', 'whatis(1)', 'zsoelim(1)', 'manpath(5)', 'man(7)', 'catman(8)', 'mandb(8)'],
  },
  {
    name: 'whatis',
    section: '1',
    summary: 'display one-line manual page descriptions',
    synopsis: ['whatis [-dlv?V] [-r|-w] [-s list] [-m system[,...]] [-M path] [-L locale] [-C file] name ...'],
    description: [
      'Every manual page carries a one-line description. whatis looks for pages whose name equals each name argument and prints those descriptions. Use -r or -w to match by pattern instead.',
      'Lookups use the indexes maintained by mandb(8). When a page you expect is not listed, the indexes may be out of date.',
    ],
    options: [...COMMON, ...SEARCH],
    sections: [['EXIT STATUS', [...STATUS, NOT_FOUND]]],
    examples: [
      ['whatis ls', 'Show what ls is.'],
      ['whatis -s 5 passwd', 'Describe only the passwd page in section 5.'],
    ],
    seeAlso: ['apropos(1)', 'man(1)', 'mandb(8)'],
  },
  {
    name: 'apropos',
    section: '1',
    summary: 'search the manual page names and descriptions',
    synopsis: ['apropos [-dalv?V] [-e|-w|-r] [-s list] [-m system[,...]] [-M path] [-L locale] [-C file] keyword ...'],
    description: [
      'apropos searches the names and one-line descriptions of manual pages for each keyword and prints whatever matches. Keywords are regular expressions by default, and a page qualifies when any one of them matches.',
      'Lookups use the indexes maintained by mandb(8).',
    ],
    options: [
      ...COMMON,
      ['-e, --exact', 'Require each keyword to equal a page name or a complete word in the description.'],
      ['-a, --and', 'Show only pages matched by all keywords, not just one.'],
      ...SEARCH,
    ],
    sections: [['EXIT STATUS', [...STATUS, NOT_FOUND]]],
    examples: [
      ['apropos copy', 'Find pages about copying.'],
      ['apropos -a list directory', 'Find pages that mention both list and directory.'],
      ['apropos -s 8 network', 'Restrict the search to section 8.'],
    ],
    seeAlso: ['man(1)', 'whatis(1)', 'mandb(8)'],
  },
  {
    name: 'mandb',
    section: '8',
    summary: 'create or update the manual page index caches',
    synopsis: [
      'mandb [-dqsucpt?V] [-C file] [manpath]',
      'mandb [-dqsut] [-C file] -f filename ...',
    ],
    description: [
      'mandb maintains the indexes that man(1), whatis(1) and apropos(1) consult to find pages quickly. A scheduled job and package installs normally keep them current, so running it by hand is seldom necessary.',
      'Given a manpath, mandb works on that tree only; otherwise it covers every tree in the configured search path. Existing indexes are updated in place unless a rebuild is requested.',
    ],
    options: [
      ['-d, --debug', 'Show debugging output.'],
      ['-q, --quiet', 'Suppress warnings.'],
      ['-s, --no-straycats', 'Skip stray cats, meaning formatted pages that have no source page.'],
      ['-p, --no-purge', 'Keep entries for pages that have been deleted.'],
      ['-c, --create', 'Rebuild the indexes from nothing rather than updating them.'],
      ['-u, --user-db', 'Build only per-user indexes, even when the system indexes are writable.'],
      ['-t, --test', 'Check pages for problems and leave the indexes untouched.'],
      ['-f, --filename', 'Refresh only the entries belonging to the named files.'],
      CONFIG,
      HELP,
      VERSION,
    ],
    sections: [['EXIT STATUS', [...STATUS, CHILD_FAILED]]],
    seeAlso: ['lexgrog(1)', 'man(1)', 'manpath(5)', 'catman(8)'],
  },
];
