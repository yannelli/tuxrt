import type { Builtin } from '../types.ts';

export const moreBuiltinDocs: Record<string, Builtin> = {
  let: {
    synopsis: 'let arg [arg ...]',
    summary: 'evaluate arithmetic expressions',
    text: 'Evaluate each arg as an arithmetic expression (see ARITHMETIC EVALUATION in bash(1)). Quote an expression that contains spaces or shell operators. Returns 1 if the last expression comes out as 0, and 0 otherwise.',
  },
  local: {
    synopsis: 'local [option] [name[=value] ... | - ]',
    summary: 'define local variables',
    text: 'Create a variable called name, optionally with value, that is visible only in the current function and the functions it calls. Any option that declare accepts may be used to set attributes. A name of - saves the shell options, so changes made with set inside the function are undone when it returns. With no operands, print the local variables on standard output.\n\nOnly allowed inside a function. Returns 0 unless used outside a function, given an invalid name, or applied to a readonly variable.',
  },
  logout: {
    synopsis: 'logout [n]',
    summary: 'exit a login shell',
    text: 'Leave a login shell with status n. Fails when the shell is not a login shell.',
  },
  printf: {
    synopsis: 'printf [-v var] format [arguments]',
    summary: 'print arguments using a format',
    text: 'Lay out the arguments according to format and print the result on standard output, or store it in the variable var when -v var is given.\n\nformat mixes three kinds of content: ordinary characters, copied as they are; backslash escapes, translated and then copied; and conversion specifications such as %s and %d, each of which consumes the next argument. On top of the conversions of printf(1), bash adds %b (expand backslash escapes found in the argument), %q (quote the argument so the shell can read it back), %Q (like %q, but any precision applies to the argument before quoting), and %(datefmt)T (format a time with strftime(3) using datefmt; the argument is seconds since the epoch, and -1 means now). When arguments remain after format is used up, format is applied again; missing arguments count as 0 or an empty string.\n\nReturns 0 on success, and non-zero for an invalid option or a failed write or assignment.',
  },
  pwd: {
    synopsis: 'pwd [-LP]',
    summary: 'print the current working directory',
    text: 'Print the absolute path of the current directory. With -P, or when set -o physical is on, the path contains no symbolic links. With -L, symbolic links used to reach the directory may appear in it.\n\nReturns 0 unless the directory name cannot be read or an option is invalid.',
  },
  read: {
    synopsis: 'read [-ers] [-a aname] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]',
    summary: 'read a line into variables',
    text: 'Read one line from standard input, or from descriptor fd with -u, split it into words at IFS characters, and assign the words to the names in order. When there are more words than names, the last name gets all the leftover words and the separators between them; when there are fewer, the remaining names are set to empty. A backslash makes the next character literal, and a backslash at the end of a line continues it onto the next. With no names, the whole line goes into REPLY.\n\n-a aname stores the words in the indexed array aname, from index 0. -d delim stops at the first character of delim instead of at a newline. -e reads the line with readline editing, and -i text pre-fills the readline buffer with text. -n nchars stops after nchars characters or at a newline, whichever comes first; -N nchars reads exactly nchars characters and ignores delimiters. -p prompt shows prompt on standard error, without a newline, when reading from a terminal. -r takes backslashes literally. -s hides what is typed on a terminal. -t timeout gives up if a full line has not arrived within timeout seconds, which may be fractional. -u fd reads from descriptor fd.\n\nReturns 0, unless end of file is reached, the read times out (status above 128), an assignment fails, or the descriptor given to -u is invalid.',
  },
  readonly: {
    synopsis: 'readonly [-aAf] [name[=value] ...] or readonly -p',
    summary: 'mark shell variables as unchangeable',
    text: 'Make each name readonly, so any later assignment to it fails. name=value sets the value at the same time. -f applies to functions instead of variables, -a limits the names to indexed arrays, and -A to associative arrays. With no names, or with -p, list all readonly names in a form the shell can read back.\n\nReturns 0 unless an option is invalid, a name is not a valid variable name, or -f is given a name that is not a function.',
  },
  return: {
    synopsis: 'return [n]',
    summary: 'return from a shell function',
    text: 'Stop the current function and give n back to the caller as its status; without n, use the status of the last command run in the function. In a script being run by . or source, outside any function, return stops that script and yields n or the status of its last command.\n\nFails when n is not a number, or when used outside both a function and a sourced script. If a RETURN trap is set, it runs before control goes back to the caller.',
  },
  set: {
    synopsis: 'set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]',
    summary: 'set shell options and positional parameters',
    text: 'With no arguments, print every shell variable and its value in a form the shell can read back. With options, switch shell behaviors on (-) or off (+). Arguments left over after the options replace the positional parameters $1, $2, and so on. $- shows which single-letter flags are on.\n\nFrequently used flags: -e makes the shell exit when a pipeline, list, or compound command fails, unless the failure is tested by a condition or is not the last part of a && or || chain. -f turns globbing off. -m enables job control. -n parses commands without running them. -u makes expanding an unset variable an error. -v echoes input lines as they are read. -x traces each simple command with its expanded arguments, prefixed by PS4. -C (noclobber) keeps > from overwriting existing files. -o option-name sets an option by its long name, such as errexit, noglob, nounset, xtrace, vi, emacs, or pipefail (a pipeline then takes the status of the rightmost command that failed, or 0 if none did); -o alone shows all current settings. -- makes the remaining arguments the positional parameters, clearing them if there are none; a lone - turns off -x and -v.\n\nReturns true unless an option is invalid.',
  },
  shift: {
    synopsis: 'shift [n]',
    summary: 'shift positional parameters',
    text: 'Drop the first n positional parameters and renumber the rest, so what was $n+1 becomes $1. n defaults to 1 and should be between 0 and $#; 0 changes nothing. If n is larger than $#, the parameters are left alone.\n\nReturns 0 on success, and a value above zero if n is negative or larger than $#.',
  },
  source: {
    synopsis: 'source filename [arguments]',
    summary: 'run a file in this shell',
    text: 'Another name for the . builtin: run the commands in filename in the current shell and return the status of the last one.',
  },
  test: {
    synopsis: 'test expr',
    summary: 'evaluate conditional expression',
    text: 'Evaluate expr and return 0 if it is true or 1 if it is false. Every operator and operand must be a separate argument, so spaces are required around them. test takes no options and does not treat -- as the end of options.\n\nFile checks: -e file exists, -f regular file, -d directory, -L symbolic link, -r, -w, and -x readable, writable, executable, -s file is not empty, and file1 -nt file2 when file1 is newer. String checks: -z string is empty, -n string is not empty, string1 = string2 and string1 != string2 for equality, and string1 < string2 when string1 sorts first. Integer checks: arg1 OP arg2, with OP one of -eq, -ne, -lt, -le, -gt, -ge. Combine checks with ! expr (not), ( expr ) for grouping, expr1 -a expr2 (and), and expr1 -o expr2 (or).\n\nReturns 2 when the expression or an argument is invalid.',
  },
  time: {
    synopsis: 'time [-p] pipeline',
    summary: "report time consumed by pipeline's execution",
    text: "Run pipeline and, when it finishes, report the elapsed real time and the user and system CPU time it used. time is a reserved word rather than a builtin, so it measures the whole pipeline. The report goes to the shell's standard error; to capture it, wrap the command in braces, as in { time command; } 2>file. -p prints the report in the portable POSIX layout. TIMEFORMAT can be set to change the layout.\n\nReturns the status of pipeline.",
  },
  trap: {
    synopsis: 'trap [-lp] [[arg] sigspec ...]',
    summary: 'trap signals and other events',
    text: 'Make the shell run the command arg whenever it receives one of the listed signals. If arg is - (or is left out and there is a single sigspec), those signals go back to their original behavior. If arg is an empty string, the shell and the commands it starts ignore those signals. With no arguments, or with -p, print the traps currently set. -l prints signal names with their numbers. A sigspec is a signal number or a signal name; names ignore case and the SIG prefix is optional.\n\nSome sigspecs are events rather than signals: EXIT (or 0) runs arg when the shell exits, DEBUG runs arg before every simple command, RETURN runs arg each time a function or a script run by . or source finishes, and ERR runs arg whenever a pipeline, list, or compound command fails, under the same rules that make set -e exit. Signals that were already ignored when the shell started cannot be trapped or reset.\n\nReturns false for an invalid sigspec and true otherwise.',
  },
  true: {
    synopsis: 'true',
    summary: 'return a successful result',
    text: 'Do nothing and succeed with status 0.',
  },
  type: {
    synopsis: 'type [-afptP] name [name ...]',
    summary: 'display information about command type',
    text: 'Tell how each name would be interpreted if it were used as a command. -t prints just one word, alias, keyword, function, builtin, or file, and prints nothing if name is not found. -p prints the path of the file that would run, but only when -t would say file. -P searches PATH for each name even when -t would not say file. -a lists every match, including aliases, keywords, and functions unless -p is also given. -f ignores functions, as command does.\n\nReturns true if every name was found and false otherwise.',
  },
  typeset: {
    synopsis: 'typeset [-aAfFgiIlnrtux] [-p] [name[=value] ...]',
    summary: 'set variable values and attributes',
    text: 'Identical to declare and takes the same options. It exists for compatibility with the Korn shell; declare is the preferred name.',
  },
  umask: {
    synopsis: 'umask [-p] [-S] [mode]',
    summary: 'display or set file mode mask',
    text: 'Set the file creation mask to mode. A mode that starts with a digit is read as octal; anything else is a symbolic mask of the kind chmod(1) accepts. Without mode, print the current mask, in octal by default or symbolically with -S. With -p and no mode, the mask is printed as a umask command that can be reused as input.\n\nReturns 0 when the mask was changed or simply printed, and false otherwise.',
  },
  unalias: {
    synopsis: 'unalias [-a] name [name ...]',
    summary: 'remove alias definitions',
    text: 'Delete the alias for each name. -a deletes every alias. Fails if a name is not a defined alias.',
  },
  unset: {
    synopsis: 'unset [-f] [-v] [-n] [name ...]',
    summary: 'remove shell variables and functions',
    text: 'Remove each name as a variable or function. -v treats the names as variables and -f as functions. With -n, a nameref variable itself is removed instead of the variable it points to. With no option, a variable of that name is removed if there is one, and otherwise a function. Readonly variables cannot be removed. Removed names also vanish from the environment of later commands. Unsetting RANDOM, SECONDS, LINENO, or similar special variables turns them into ordinary ones, even if they are set again.\n\nReturns true unless a name is readonly or cannot be unset.',
  },
  wait: {
    synopsis: 'wait [-fn] [-p var] [id ...]',
    summary: 'wait for jobs to finish',
    text: 'Pause until the given child processes finish and return the status of the last one. Each id is a process ID or a jobspec; for a job, every process in its pipeline is waited for. With no id, wait for all background jobs and return 0. -n waits for whichever single job from the ids (or any job, if none are given) finishes first and returns its status. -p var stores in var the ID of the job whose status is returned. -f, with job control on, waits until each id has really terminated rather than just changed state.\n\nReturns 127 if an id does not exist, a value above 128 if a signal interrupts the wait, and otherwise the status of the last process or job waited for.',
  },
};
