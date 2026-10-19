import type { Page } from '../types.ts';

const FOOTER: [string, string] = ['2.12.0', '2023-09-23'];
const MANUAL = 'Manual pager utils';

const STATUS: [string, string][] = [
  ['0', 'Successful program execution.'],
  ['1', 'Usage, syntax or configuration file error.'],
  ['2', 'Operational error.'],
];

const NOT_FOUND: [string, string] = ['16', 'Nothing was found that matched the criteria specified.'];

const COMMON: [string, string][] = [
  ['-d, --debug', 'Print debugging information.'],
  ['-v, --verbose', 'Print verbose warning messages.'],
  ['-r, --regex', 'Treat each name as a regular expression (extended regex). This is the default for apropos.'],
  ['-w, --wildcard', 'Treat each name as a pattern with shell-style wildcards. A match must cover the whole name.'],
];

const SEARCH: [string, string][] = [
  ['-l, --long', 'Do not trim the output to the terminal width.'],
  ['-s list, --sections=list, --section=list', 'Only search the given manual sections, a colon or comma separated list. A section such as 3 also matches subsections such as 3perl.'],
  ['-m system[,...], --systems=system[,...]', "Also search other operating systems' manual hierarchies, if installed."],
  ['-M path, --manpath=path', 'Search the colon separated path instead of $MANPATH or the default search path.'],
  ['-L locale, --locale=locale', 'Use locale instead of the current locale to pick translated pages.'],
  ['-C file, --config-file=file', 'Use file instead of the default ~/.manpath user configuration.'],
  ['-?, --help', 'Print a help message and exit.'],
  ['--usage', 'Print a short usage message and exit.'],
  ['-V, --version', 'Display version information.'],
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
      'man is the program that displays the system manual. Each page argument is usually the name of a program, function or file. man finds the matching page and shows it in a pager. If a section is given, only that section is searched; otherwise the sections are searched in a fixed order (set by SECTION in /etc/manpath.config) and the first page found is shown, even if pages with the same name exist in other sections.',
      'The manual is divided into numbered sections:',
      ['1', 'Executable programs or shell commands'],
      ['2', 'System calls (functions provided by the kernel)'],
      ['3', 'Library calls (functions within program libraries)'],
      ['4', 'Special files (usually found in /dev)'],
      ['5', 'File formats and conventions, e.g. /etc/passwd'],
      ['6', 'Games'],
      ['7', 'Miscellaneous (including macro packages and conventions), e.g. man(7), groff(7), man-pages(7)'],
      ['8', 'System administration commands (usually only for root)'],
      ['9', 'Kernel routines [Non standard]'],
      'A page has a fixed set of headings, such as NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXIT STATUS, ENVIRONMENT, FILES, EXAMPLES and SEE ALSO. In a SYNOPSIS, bold text is typed exactly as shown, underlined text is replaced with a suitable argument, [-abc] marks optional arguments, -a|-b marks alternatives that cannot be combined, and an argument followed by ... can be repeated.',
    ],
    options: [
      ['-a, --all', 'Show every matching page, one after another, instead of only the first one found.'],
      ['-f, --whatis', 'Same as whatis(1): print the one-line description of each page, if available.'],
      ['-k, --apropos', 'Same as apropos(1): search the short descriptions and page names for the keywords as regular expressions.'],
      ['-K, --global-apropos', 'Search the full text of all manual pages for the term. This is slow; narrow it with a section if possible.'],
      ['-l, --local-file', 'Treat each page argument as a file name and format it directly, without searching the manual. A - means standard input.'],
      ['-w, --where, --path, --location', 'Print the location of the source files that would be displayed, without showing them.'],
      ['-W, --where-cat, --location-cat', 'Print the location of the preformatted cat files that would be displayed.'],
      ['-s list, -S list, --sections=list', 'Search only the listed sections, given as a colon or comma separated list. Overrides MANSECT.'],
      ['-M path, --manpath=path', 'Use the colon separated path as the manual search path instead of MANPATH or the default.'],
      ['-P pager, --pager=pager', 'Use pager to display output. It overrides MANPAGER and PAGER. The default is less.'],
      ['-L locale, --locale=locale', 'Look for pages in this locale instead of the one taken from the environment.'],
      ['-?, --help', 'Print a help message and exit.'],
      ['-V, --version', 'Display version information.'],
    ],
    sections: [
      ['EXIT STATUS', [
        ...STATUS,
        ['3', 'A child process returned a non-zero exit status.'],
        ['16', "At least one of the pages/files/keywords didn't exist or wasn't matched."],
      ]],
      ['ENVIRONMENT', [
        ['MANPATH', 'If set, used as the path to search for manual pages.'],
        ['MANPAGER, PAGER', 'The program used to display pages. MANPAGER takes precedence over PAGER; if neither is set, less is used.'],
        ['MANSECT', 'A colon separated list of sections that sets which sections are searched and in what order.'],
        ['MANWIDTH', 'If set, pages are formatted for this line width. Otherwise the terminal width is used, with a fallback of 80.'],
      ]],
      ['FILES', [
        ['/etc/manpath.config', 'man-db configuration file.'],
        ['/usr/share/man', 'A global manual page hierarchy.'],
      ]],
    ],
    examples: [
      ['man ls', 'Display the manual page for the program ls.'],
      ['man 5 passwd', 'Display the page for the passwd file format from section 5, rather than the passwd command.'],
      ['man -a intro', 'Display every available intro page in turn.'],
      ['man -k printf', 'Search the short descriptions and names for printf and list the matches. Same as apropos printf.'],
      ['man -f smail', 'Look up the pages named smail and print their descriptions. Same as whatis smail.'],
    ],
    seeAlso: ['apropos(1)', 'groff(1)', 'less(1)', 'manpath(1)', 'nroff(1)', 'troff(1)', 'whatis(1)', 'zsoelim(1)', 'manpath(5)', 'man(7)', 'catman(8)', 'mandb(8)'],
    footer: FOOTER,
    manual: MANUAL,
  },
  {
    name: 'whatis',
    section: '1',
    summary: 'display one-line manual page descriptions',
    synopsis: ['whatis [-dlv?V] [-r|-w] [-s list] [-m system[,...]] [-M path] [-L locale] [-C file] name ...'],
    description: [
      'Each manual page has a short description. whatis searches the page names for each name argument and prints the description of every page that matches. Names are matched exactly unless -r or -w is used.',
      'It uses the index databases built by mandb(8). If a page is missing from the output, the databases may need updating.',
    ],
    options: [...COMMON, ...SEARCH],
    sections: [['EXIT STATUS', [...STATUS, NOT_FOUND]]],
    examples: [
      ['whatis ls', 'Print the one-line description of ls.'],
      ['whatis -s 5 passwd', 'Describe only the section 5 page for passwd.'],
    ],
    seeAlso: ['apropos(1)', 'man(1)', 'mandb(8)'],
    footer: FOOTER,
    manual: MANUAL,
  },
  {
    name: 'apropos',
    section: '1',
    summary: 'search the manual page names and descriptions',
    synopsis: ['apropos [-dalv?V] [-e|-w|-r] [-s list] [-m system[,...]] [-M path] [-L locale] [-C file] keyword ...'],
    description: [
      'Each manual page has a short description. apropos searches the page names and descriptions for each keyword and prints every match. By default each keyword is a regular expression, and a page matches if any keyword matches its name or description.',
      'It uses the index databases built by mandb(8).',
    ],
    options: [
      ...COMMON,
      ['-e, --exact', 'Each keyword must match a page name or a whole word of its description exactly.'],
      ['-a, --and', 'Only show pages that match every keyword, instead of any of them.'],
      ...SEARCH,
    ],
    sections: [['EXIT STATUS', [...STATUS, NOT_FOUND]]],
    examples: [
      ['apropos copy', 'List pages whose name or description mentions copy.'],
      ['apropos -a list directory', 'List pages that mention both list and directory.'],
      ['apropos -s 8 network', 'Search only the system administration section.'],
    ],
    seeAlso: ['man(1)', 'whatis(1)', 'mandb(8)'],
    footer: FOOTER,
    manual: MANUAL,
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
      'mandb builds or refreshes the index databases that man(1), whatis(1) and apropos(1) use for fast lookups. It is normally run by a periodic job or after packages install pages, so it rarely needs to be run by hand.',
      'With a manpath argument it only processes that hierarchy; otherwise it handles every hierarchy in the configured search path. By default it updates existing databases incrementally.',
    ],
    options: [
      ['-d, --debug', 'Print debugging information.'],
      ['-q, --quiet', 'Produce no warnings.'],
      ['-s, --no-straycats', 'Do not look for or add information about stray cats (formatted pages without a source page).'],
      ['-p, --no-purge', 'Do not remove entries for pages that no longer exist.'],
      ['-c, --create', 'Build the databases from scratch instead of updating them.'],
      ['-u, --user-db', 'Only create user databases, even with write access to the system ones.'],
      ['-t, --test', 'Check pages for correctness without updating the databases.'],
      ['-f, --filename', 'Update only the entries for the given files.'],
      ['-C file, --config-file=file', 'Use file instead of the default ~/.manpath user configuration.'],
      ['-?, --help', 'Show the usage message, then exit.'],
      ['-V, --version', 'Show the version, then exit.'],
    ],
    sections: [['EXIT STATUS', [...STATUS, ['3', 'A child process returned a non-zero exit status.']]]],
    seeAlso: ['lexgrog(1)', 'man(1)', 'manpath(5)', 'catman(8)'],
    footer: FOOTER,
    manual: MANUAL,
  },
];
