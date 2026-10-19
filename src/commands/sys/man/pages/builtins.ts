import type { Builtin, Page } from '../types.ts';
import { moreBuiltinDocs } from './builtins2.ts';

export const builtinDocs: Record<string, Builtin> = {
  '.': {
    synopsis: '. filename [arguments]',
    summary: 'run a file in this shell',
    text: 'Run the commands in filename inside the current shell, so variable assignments, function definitions, and directory changes made by it persist afterward. A filename without a slash is looked up in PATH; it only needs to be readable, not executable. Outside posix mode, the current directory is also tried when the PATH search finds nothing. Any arguments become the positional parameters while filename runs; without them, the positional parameters stay as they are.\n\nReturns the status of the last command run from filename (0 if it ran nothing), or failure if filename cannot be found or read.',
  },
  ':': {
    synopsis: ': [arguments]',
    summary: 'null command',
    text: 'Do nothing beyond expanding the arguments and carrying out any redirections. Handy as a placeholder or for side effects, as in : ${VAR:=default}. Always returns 0.',
  },
  '[': {
    synopsis: '[ expr ]',
    summary: 'evaluate conditional expression',
    text: 'Works like test, except that the final argument must be a literal ] closing the bracket.\n\nReturns 0 if expr is true, 1 if it is false, and 2 if expr is malformed.',
  },
  alias: {
    synopsis: 'alias [-p] [name[=value] ...]',
    summary: 'define or display aliases',
    text: 'With no arguments, or with -p, list every alias as alias name=value, in a form the shell can read back. Each name=value argument defines an alias; if value ends in a space, the word that follows the alias is also checked for an alias. Each bare name prints the current definition of that alias.\n\nSucceeds unless some name has no alias defined.',
  },
  bg: {
    synopsis: 'bg [jobspec ...]',
    summary: 'move jobs to the background',
    text: 'Let each stopped job jobspec continue in the background, as though it had been started with &. Without jobspec, the current job is used.\n\nReturns 0, unless job control is off, a jobspec does not exist, or a job was started without job control.',
  },
  break: {
    synopsis: 'break [n]',
    summary: 'exit for, while, or until loops',
    text: 'Leave the innermost for, while, until, or select loop. With n, leave n nested loops at once. n must be 1 or more; a value larger than the nesting depth leaves all of them.\n\nReturns 0 unless n is less than 1.',
  },
  cd: {
    synopsis: 'cd [-L|[-P [-e]] [-@]] [dir]',
    summary: 'change the shell working directory',
    text: "Make dir the new working directory. Without dir, go to $HOME. A dir of - stands for $OLDPWD, the previous directory, so cd - switches back and forth between two places. When dir does not start with a slash, the colon-separated directories in CDPATH are searched for it. If the new directory was found through a non-empty CDPATH entry, or the argument was -, cd prints the absolute path it moved to.\n\n-L, the default, treats the path logically: .. drops the last component of the path as written, and symbolic links are resolved after that. -P works with the physical layout instead: symbolic links are resolved first, so .. leads to the real parent directory. Adding -e to -P makes cd fail if the current directory cannot be determined after a successful change. -@, where the system supports it, presents a file's extended attributes as a directory.\n\nReturns 0 if the directory was changed and non-zero otherwise.",
  },
  command: {
    synopsis: 'command [-pVv] command [arg ...]',
    summary: 'run a command, bypassing functions',
    text: 'Run command with the given args, skipping any shell function of the same name, so only builtins and programs found in PATH are considered. -p searches a built-in default PATH that is sure to contain the standard utilities. -v prints one word: the name or path that would be run. -V prints a fuller description.\n\nWith -v or -V, returns 0 if command was found and 1 if not. Otherwise returns 127 if command cannot be found or an error occurred, and the status of command if it ran.',
  },
  compgen: {
    synopsis: 'compgen [-abcdefgjksuv] [-o option] [-A action] [-G globpat] [-W wordlist] [-F function] [-C command] [-X filterpat] [-P prefix] [-S suffix] [word]',
    summary: 'generate possible completion matches',
    text: 'Print to standard output the completions that the options produce for word. Any option of complete is accepted except -p and -r. If word is given, only candidates matching it are shown.\n\nCandidate sources: -a aliases, -b builtins, -c commands, -d directories, -e exported variables, -f files, -g groups, -j jobs, -k reserved words, -u users, -v variables, and -A action to name a source. -W wordlist splits wordlist on IFS and offers the pieces, -G globpat offers files matching a pattern, -X filterpat drops candidates that match, and -P prefix and -S suffix are attached to every result.\n\nFails on an invalid option or when nothing matched.',
  },
  continue: {
    synopsis: 'continue [n]',
    summary: 'resume for, while, or until loops',
    text: 'Skip to the next iteration of the innermost for, while, until, or select loop. With n, continue the nth enclosing loop instead. n must be 1 or more; a value larger than the nesting depth means the outermost loop.\n\nReturns 0 unless n is less than 1.',
  },
  declare: {
    synopsis: 'declare [-aAfFgiIlnrtux] [-p] [name[=value] ...]',
    summary: 'set variable values and attributes',
    text: 'Create variables, give them values, and change their attributes. Without names, print variables and their values. -p prints the attributes and value of each name; with no names, it lists every variable that has the attributes given. -f limits the output to functions, and -F shows only function names and attributes. Inside a function, declare makes each name local, like local does, unless -g asks for a global variable. -I lets a new local variable start with the value and attributes of the variable of the same name in an enclosing scope.\n\nAttribute flags: -a indexed array, -A associative array, -i integer (assignments are computed as arithmetic), -l lowercase on assignment, -u uppercase on assignment, -n nameref (the variable stands for another variable, named by its value), -r readonly, -t trace, -x export. Writing + instead of - removes an attribute, except that +a and +A cannot destroy an array and +r cannot lift readonly.\n\nReturns 0 unless an option is invalid, a readonly variable is assigned, -f is used with name=value, or -f names a function that does not exist.',
  },
  echo: {
    synopsis: 'echo [-neE] [arg ...]',
    summary: 'write arguments to the standard output',
    text: 'Print the args separated by single spaces, then a newline. -n leaves out the newline. -e turns on backslash escape processing, and -E turns it off even on systems where it is on by default. echo does not accept -- as the end of options; it prints it like any other argument.\n\nEscapes understood with -e: \\a bell, \\b backspace, \\c stop printing here, \\e escape character, \\f form feed, \\n newline, \\r carriage return, \\t tab, \\v vertical tab, \\\\ literal backslash, \\0nnn octal byte, \\xHH hex byte, \\uHHHH and \\UHHHHHHHH Unicode characters.\n\nReturns 0 unless writing fails.',
  },
  eval: {
    synopsis: 'eval [arg ...]',
    summary: 'execute arguments as a shell command',
    text: 'Join the args with spaces into one string, then parse and run that string as a shell command. This lets a script build a command in a variable and execute it. The status of eval is that of the command it ran, or 0 when there is nothing to run.',
  },
  exec: {
    synopsis: 'exec [-cl] [-a name] [command [argument ...]]',
    summary: 'replace the shell with the given command',
    text: 'With command: the shell process turns into command, without forking, and command receives the given arguments. -l puts a dash in front of argument zero, the way login(1) starts shells. -c starts command with an empty environment. -a name passes name as argument zero. If command cannot be run, a non-interactive shell exits unless the execfail option is set.\n\nWithout command: the redirections apply to the current shell itself, so exec 2>log sends all later error messages to log. Returns 0, or 1 if a redirection fails.',
  },
  exit: {
    synopsis: 'exit [n]',
    summary: 'exit the shell',
    text: 'End the shell with status n, or with the status of the last command if n is left out. Any trap set on EXIT runs first.',
  },
  export: {
    synopsis: 'export [-fn] [name[=value] ...] or export -p',
    summary: 'set export attribute for shell variables',
    text: 'Mark each name so that it is handed down in the environment of every command started afterward. name=value also assigns the value. -f exports functions instead of variables, and -n takes the export mark away. With no names, or with -p, list all exported variables in a form the shell can read back.\n\nReturns 0 unless an option is invalid, a name is not a valid variable name, or -f is given a name that is not a function.',
  },
  false: {
    synopsis: 'false',
    summary: 'return an unsuccessful result',
    text: 'Do nothing and fail with status 1.',
  },
  fg: {
    synopsis: 'fg [jobspec]',
    summary: 'move job to the foreground',
    text: 'Bring jobspec to the foreground and make it the current job. Without jobspec, the current job is used.\n\nReturns the status of the job brought to the foreground. Fails if job control is off, or if jobspec names no valid job or a job started without job control.',
  },
  getopts: {
    synopsis: 'getopts optstring name [arg ...]',
    summary: 'parse option arguments',
    text: "Parse a script's options one at a time, usually inside a while loop. optstring lists the option letters to accept; a letter followed by a colon takes an argument, which may be attached to it or given as the next word. On each call getopts stores the option letter in the variable name and the index of the next argument to examine in OPTIND. For an option that takes an argument, the argument goes into OPTARG. OPTIND is 1 when the shell or script starts and is never reset automatically. The positional parameters are parsed unless args are given, in which case those are parsed instead.\n\nIf optstring starts with a colon, errors are reported quietly: an unknown option sets name to ? and puts the letter in OPTARG, and a missing argument sets name to : and puts the letter in OPTARG. Without the leading colon, both cases set name to ?, unset OPTARG, and print a message, unless OPTERR is 0.\n\nReturns true while an option, known or unknown, is found, and false at the end of the options or on an error.",
  },
  hash: {
    synopsis: 'hash [-lr] [-p pathname] [-dt] [name ...]',
    summary: 'remember or display program locations',
    text: 'bash remembers where it found each command so it does not have to search PATH again. hash name searches PATH for name now and records the result, replacing any earlier entry. -p pathname records pathname as the location of name without searching. -r empties the whole table, and -d removes the entries for the given names. -t prints the recorded path of each name, and -l prints entries in a form usable as input. With no arguments, or only -l, the table is listed.\n\nSucceeds unless a name cannot be found or an option is invalid.',
  },
  help: {
    synopsis: 'help [-dms] [pattern ...]',
    summary: 'display information about builtin commands',
    text: 'Show documentation for builtin commands. Each pattern selects the builtins whose names match it, and their full help is printed; with no pattern, a list of all builtins and compound commands is shown. -d gives a one-line description, -m lays the text out like a man page, and -s prints only the usage line.\n\nReturns 0 unless no command matches a pattern.',
  },
  history: {
    synopsis: 'history [-c] [-d offset] [n] or history -anrw [filename] or history -ps arg [arg ...]',
    summary: 'display or manipulate the history list',
    text: "With no options, print the history list with line numbers; with n, only the last n entries. When HISTTIMEFORMAT is set and not empty, it is used as a strftime(3) format to show when each entry was made.\n\n-c empties the list. -d offset removes one entry; a negative offset counts from the end. -a appends the lines entered in this session to the history file. -n loads lines from the history file that have not been read yet. -r reads the whole history file and adds it to the list. -w overwrites the history file with the current list. -p runs history expansion on each arg and prints the result without saving it. -s adds the args to the list as one entry. The history file is filename if given, otherwise HISTFILE.\n\nReturns 0 unless an option is invalid, the history file cannot be read or written, the -d offset is out of range, or a -p expansion fails.",
  },
  jobs: {
    synopsis: 'jobs [-lnprs] [jobspec ...] or jobs -x command [args]',
    summary: 'display status of jobs',
    text: "List the jobs this shell is managing. -l adds process IDs, -n shows only jobs whose status changed since you were last told about them, -p prints only the process ID of each job's process group leader, -r limits the list to running jobs, and -s to stopped ones. Naming a jobspec restricts the output to that job. Returns 0 unless an option or jobspec is invalid.\n\nWith -x, each jobspec found in command or args is replaced by its process group ID, then command runs with those args and its status is returned.",
  },
  kill: {
    synopsis: 'kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]',
    summary: 'send a signal to a job',
    text: 'Send a signal to the processes or jobs given by pid or jobspec. Pick the signal with -s and a name, -n and a number, or directly as -sigspec. Names ignore case and may leave off the SIG prefix, so -9, -KILL, and -SIGKILL all mean the same. With no signal given, SIGTERM is sent. -l lists the signal names; with arguments, it shows the signal name for each one. -L is the same as -l.\n\nReturns true if at least one signal was delivered, and false on any error or invalid option.',
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
      `The commands built into bash are: ${Object.keys(builtinDocs).join(', ')}.`,
      'Builtins that take options also accept -- to end option processing, unless their entry says otherwise. :, true, false, test, and [ take no options and give -- no special meaning. exit, logout, return, break, continue, let, and shift take arguments that start with - as ordinary operands, without needing --.',
      'In an interactive shell, help name prints a quick summary of any builtin.',
    ],
    sections: [['BASH BUILTIN COMMANDS', Object.values(builtinDocs).map((b): [string, string] => [b.synopsis, b.text])]],
    seeAlso: ['bash(1)', 'sh(1)'],
  },
];
