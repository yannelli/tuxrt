import type { Builtin, Page } from '../types.ts';
import { moreBuiltinDocs } from './builtins2.ts';

export const builtinDocs: Record<string, Builtin> = {
  '.': {
    synopsis: '. filename [arguments]',
    summary: 'execute commands from a file in the current shell',
    text: 'Read and execute commands from filename in the current shell environment and return the exit status of the last command executed from filename. If filename does not contain a slash, the directories in PATH are searched for it; the file need not be executable. When bash is not in posix mode, the current directory is searched if no file is found in PATH. If any arguments are supplied, they become the positional parameters while filename is executed; otherwise the positional parameters are unchanged.\n\nThe return status is the status of the last command executed within the script (0 if no commands are executed), and false if filename is not found or cannot be read.',
  },
  ':': {
    synopsis: ': [arguments]',
    summary: 'null command',
    text: 'No effect; the command does nothing beyond expanding arguments and performing any specified redirections. The return status is zero.',
  },
  '[': {
    synopsis: '[ expr ]',
    summary: 'evaluate conditional expression',
    text: 'A synonym for test, except that the last argument must be a literal ], to match the opening [.\n\nReturns a status of 0 (true) or 1 (false) depending on the evaluation of the conditional expression expr, or 2 if an invalid expression is given.',
  },
  alias: {
    synopsis: 'alias [-p] [name[=value] ...]',
    summary: 'define or display aliases',
    text: 'Alias with no arguments or with the -p option prints the list of aliases in the form alias name=value on standard output. When arguments are supplied, an alias is defined for each name whose value is given. A trailing space in value causes the next word to be checked for alias substitution when the alias is expanded. For each name in the argument list for which no value is supplied, the name and value of the alias is printed.\n\nAlias returns true unless a name is given for which no alias has been defined.',
  },
  bg: {
    synopsis: 'bg [jobspec ...]',
    summary: 'move jobs to the background',
    text: "Resume each suspended job jobspec in the background, as if it had been started with &. If jobspec is not present, the shell's notion of the current job is used.\n\nbg returns 0 unless run when job control is disabled or, when run with job control enabled, any specified jobspec was not found or was started without job control.",
  },
  break: {
    synopsis: 'break [n]',
    summary: 'exit for, while, or until loops',
    text: 'Exit from within a for, while, until, or select loop. If n is specified, break n levels. n must be >= 1. If n is greater than the number of enclosing loops, all enclosing loops are exited.\n\nThe return value is 0 unless n is not greater than or equal to 1.',
  },
  cd: {
    synopsis: 'cd [-L|[-P [-e]] [-@]] [dir]',
    summary: 'change the shell working directory',
    text: 'Change the current directory to dir. If dir is not supplied, the value of the HOME shell variable is the default. If dir is -, it is converted to $OLDPWD before the directory change is attempted. The variable CDPATH defines the search path for the directory containing dir; if dir begins with a slash, CDPATH is not used. If a non-empty directory name from CDPATH is used, or if - is the first argument, and the directory change is successful, the absolute pathname of the new working directory is written to the standard output.\n\nThe -P option uses the physical directory structure by resolving symbolic links while traversing dir and before processing instances of .. in dir. The -L option (the default) follows symbolic links, resolving the link after processing instances of .. in dir. If -e is supplied with -P and the current working directory cannot be determined after a successful directory change, cd returns an unsuccessful status. On systems that support it, -@ presents the extended attributes associated with a file as a directory.\n\nThe return value is true if the directory was successfully changed; false otherwise.',
  },
  command: {
    synopsis: 'command [-pVv] command [arg ...]',
    summary: 'execute a simple command or display information about commands',
    text: 'Run command with args suppressing the normal shell function lookup. Only builtin commands or commands found in the PATH are executed. If -p is given, the search for command is performed using a default value for PATH that is guaranteed to find all of the standard utilities. If -v is supplied, a single word indicating the command or filename used to invoke command is printed; -V produces a more verbose description.\n\nIf -V or -v is supplied, the exit status is 0 if command was found, and 1 if not. If neither option is supplied and an error occurred or command cannot be found, the exit status is 127. Otherwise, the exit status of command is returned.',
  },
  compgen: {
    synopsis: 'compgen [-abcdefgjksuv] [-o option] [-A action] [-G globpat] [-W wordlist] [-F function] [-C command] [-X filterpat] [-P prefix] [-S suffix] [word]',
    summary: 'display possible completions depending on the options',
    text: 'Generate possible completion matches for word according to the options, which may be any option accepted by the complete builtin with the exception of -p and -r, and write the matches to the standard output. If word is specified, only those completions matching word are displayed.\n\nCommon options: -a aliases, -b builtins, -c commands, -d directories, -e exported variables, -f files, -g groups, -j jobs, -k reserved words, -u users, -v variables. -A action selects a set by name, -W wordlist splits wordlist using IFS, -G globpat expands a pattern, -X filterpat removes matching entries, and -P prefix and -S suffix are added to each match.\n\nThe return value is true unless an invalid option is supplied, or no matches were generated.',
  },
  continue: {
    synopsis: 'continue [n]',
    summary: 'resume for, while, or until loops',
    text: 'Resume the next iteration of the enclosing for, while, until, or select loop. If n is specified, resume at the nth enclosing loop. n must be >= 1. If n is greater than the number of enclosing loops, the last enclosing loop (the top-level loop) is resumed.\n\nThe return value is 0 unless n is not greater than or equal to 1.',
  },
  declare: {
    synopsis: 'declare [-aAfFgiIlnrtux] [-p] [name[=value] ...]',
    summary: 'set variable values and attributes',
    text: 'Declare variables and/or give them attributes. If no names are given then display the values of variables. The -p option displays the attributes and values of each name; with no names, it displays all variables having the specified attributes. -f restricts the display to functions; -F displays only function names and attributes. -g creates global variables when used in a function. -I makes local variables inherit the attributes and value of a variable with the same name at a surrounding scope.\n\nAttributes: -a indexed array, -A associative array, -i integer (values are evaluated arithmetically on assignment), -l convert to lowercase on assignment, -n make name a reference to the variable named by its value, -r readonly, -t trace, -u convert to uppercase on assignment, -x export. Using + instead of - turns off the attribute, except that +a and +A may not be used to destroy arrays and +r will not remove the readonly attribute. When used in a function, declare makes each name local, as with local, unless -g is supplied.\n\nThe return value is 0 unless an invalid option is encountered, an attempt is made to assign a value to a readonly variable, an attempt is made to define a function using -f foo=bar, or an attempt is made to display a non-existent function with -f.',
  },
  echo: {
    synopsis: 'echo [-neE] [arg ...]',
    summary: 'write arguments to the standard output',
    text: 'Output the args, separated by spaces, followed by a newline. If -n is specified, the trailing newline is suppressed. If -e is given, interpretation of backslash-escaped characters is enabled. The -E option disables the interpretation of these escape characters, even on systems where they are interpreted by default. echo does not interpret -- to mean the end of options.\n\nEscapes recognized with -e: \\a alert, \\b backspace, \\c suppress further output, \\e escape, \\f form feed, \\n new line, \\r carriage return, \\t horizontal tab, \\v vertical tab, \\\\ backslash, \\0nnn octal value, \\xHH hexadecimal value, \\uHHHH and \\UHHHHHHHH Unicode characters.\n\nThe return status is 0 unless a write error occurs.',
  },
  eval: {
    synopsis: 'eval [arg ...]',
    summary: 'execute arguments as a shell command',
    text: 'The args are read and concatenated together into a single command. This command is then read and executed by the shell, and its exit status is returned as the value of eval. If there are no args, or only null arguments, eval returns 0.',
  },
  exec: {
    synopsis: 'exec [-cl] [-a name] [command [argument ...]]',
    summary: 'replace the shell with the given command',
    text: 'If command is specified, it replaces the shell. No new process is created. The arguments become the arguments to command. If -l is supplied, the shell places a dash at the beginning of the zeroth argument passed to command, as login(1) does. -c causes command to be executed with an empty environment. If -a is supplied, the shell passes name as the zeroth argument. If command cannot be executed, a non-interactive shell exits, unless the execfail shell option is enabled.\n\nIf command is not specified, any redirections take effect in the current shell, and the return status is 0. If there is a redirection error, the return status is 1.',
  },
  exit: {
    synopsis: 'exit [n]',
    summary: 'exit the shell',
    text: 'Cause the shell to exit with a status of n. If n is omitted, the exit status is that of the last command executed. A trap on EXIT is executed before the shell terminates.',
  },
  export: {
    synopsis: 'export [-fn] [name[=value] ...] or export -p',
    summary: 'set export attribute for shell variables',
    text: 'The supplied names are marked for automatic export to the environment of subsequently executed commands. If -f is given, the names refer to functions. If no names are given, or if -p is supplied, a list of all exported variables is printed in a form that may be reused as input. -n removes the export property from each name. If a variable name is followed by =value, the value of the variable is set to value.\n\nexport returns an exit status of 0 unless an invalid option is encountered, one of the names is not a valid shell variable name, or -f is supplied with a name that is not a function.',
  },
  false: {
    synopsis: 'false',
    summary: 'return an unsuccessful result',
    text: 'Does nothing, returns a non-zero status (1).',
  },
  fg: {
    synopsis: 'fg [jobspec]',
    summary: 'move job to the foreground',
    text: "Resume jobspec in the foreground, and make it the current job. If jobspec is not present, the shell's notion of the current job is used.\n\nThe return value is that of the command placed into the foreground, or failure if run when job control is disabled or, when run with job control enabled, if jobspec does not specify a valid job or specifies a job that was started without job control.",
  },
  getopts: {
    synopsis: 'getopts optstring name [arg ...]',
    summary: 'parse option arguments',
    text: 'getopts is used by shell procedures to parse positional parameters. optstring contains the option characters to be recognized; if a character is followed by a colon, the option is expected to have an argument, which may be separated from it by white space. Each time it is invoked, getopts places the next option in the shell variable name and the index of the next argument to be processed into the variable OPTIND. OPTIND is initialized to 1 each time the shell or a shell script is invoked, and is not reset automatically. When an option requires an argument, getopts places that argument into the variable OPTARG. getopts parses the positional parameters, or the args if any are given.\n\nIf the first character of optstring is a colon, silent error reporting is used: an invalid option sets name to ? and places the option character in OPTARG, and a missing argument sets name to : and places the option character in OPTARG. Otherwise invalid options and missing arguments set name to ?, unset OPTARG, and print a diagnostic, unless OPTERR is set to 0.\n\ngetopts returns true if an option, specified or unspecified, is found. It returns false if the end of options is encountered or an error occurs.',
  },
  hash: {
    synopsis: 'hash [-lr] [-p pathname] [-dt] [name ...]',
    summary: 'remember or display program locations',
    text: 'Each time hash is invoked, the full pathname of the command name is determined by searching the directories in $PATH and remembered. Any previously remembered pathname is discarded. If -p is supplied, no path search is performed, and pathname is used as the full filename of the command. -r causes the shell to forget all remembered locations. -d forgets the remembered location of each name. -t prints the full pathname to which each name corresponds. -l displays output in a format that may be reused as input. If no arguments are given, or if only -l is supplied, information about remembered commands is printed.\n\nThe return status is true unless a name is not found or an invalid option is supplied.',
  },
  help: {
    synopsis: 'help [-dms] [pattern ...]',
    summary: 'display information about builtin commands',
    text: 'Display helpful information about builtin commands. If pattern is specified, help gives detailed help on all commands matching pattern; otherwise a list of the builtins and shell compound commands is printed. -d displays a short description of each pattern; -m displays the description of each pattern in a manpage-like format; -s displays only a short usage synopsis for each pattern.\n\nThe return status is 0 unless no command matches pattern.',
  },
  history: {
    synopsis: 'history [-c] [-d offset] [n] or history -anrw [filename] or history -ps arg [arg ...]',
    summary: 'display or manipulate the history list',
    text: 'With no options, display the command history list with line numbers. An argument of n lists only the last n lines. If HISTTIMEFORMAT is set and not null, it is used as a format string for strftime(3) to display the time stamp associated with each entry.\n\nOptions: -c clears the history list; -d offset deletes the history entry at position offset (negative offsets count back from the end); -a appends the new history lines from this session to the history file; -n reads history lines not already read from the history file; -r reads the history file and appends its contents to the history list; -w writes the current history list to the history file, overwriting its contents; -p performs history substitution on the args and displays the result without storing it; -s stores the args in the history list as a single entry. If filename is supplied, it is used as the history file; otherwise HISTFILE is used.\n\nThe return value is 0 unless an invalid option is encountered, an error occurs while reading or writing the history file, an invalid offset is supplied to -d, or the history expansion supplied to -p fails.',
  },
  jobs: {
    synopsis: 'jobs [-lnprs] [jobspec ...] or jobs -x command [args]',
    summary: 'display status of jobs',
    text: "The first form lists the active jobs. -l lists process IDs in addition to the normal information; -n displays only jobs that have changed status since the user was last notified; -p lists only the process ID of the job's process group leader; -r displays only running jobs; -s displays only stopped jobs. If jobspec is given, output is restricted to information about that job. The return status is 0 unless an invalid option is encountered or an invalid jobspec is supplied.\n\nIf -x is supplied, jobs replaces any jobspec found in command or args with the corresponding process group ID, and executes command passing it args, returning its exit status.",
  },
  kill: {
    synopsis: 'kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]',
    summary: 'send a signal to a job',
    text: 'Send the signal named by sigspec or signum to the processes named by pid or jobspec. sigspec is either a case-insensitive signal name such as SIGKILL (with or without the SIG prefix) or a signal number; signum is a signal number. If sigspec is not present, SIGTERM is assumed. An argument of -l lists the signal names; if arguments are supplied with -l, the names of the signals corresponding to the arguments are listed. -L is equivalent to -l.\n\nkill returns true if at least one signal was successfully sent, or false if an error occurs or an invalid option is encountered.',
  },
  ...moreBuiltinDocs,
};

export const builtinPages: Page[] = [
  {
    name: 'bash-builtins',
    section: '7',
    summary: 'bash built-in commands, see bash(1)',
    aliases: ['builtins'],
    synopsis: [],
    description: [
      `bash defines the following built-in commands: ${Object.keys(builtinDocs).join(', ')}.`,
      'Unless otherwise noted, each builtin command documented in this section as accepting options preceded by - accepts -- to signify the end of the options. The :, true, false, and test/[ builtins do not accept options and do not treat -- specially. The exit, logout, return, break, continue, let, and shift builtins accept and process arguments beginning with - without requiring --.',
      'In an interactive shell, help name prints a summary of the builtin name.',
    ],
    sections: [['BASH BUILTIN COMMANDS', Object.values(builtinDocs).map((b): [string, string] => [b.synopsis, b.text])]],
    seeAlso: ['bash(1)', 'sh(1)'],
    footer: ['GNU Bash 5.2', '2022 September 19'],
  },
];
