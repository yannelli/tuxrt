import type { Builtin } from '../types.ts';

export const moreBuiltinDocs: Record<string, Builtin> = {
  let: {
    synopsis: 'let arg [arg ...]',
    summary: 'evaluate arithmetic expressions',
    text: 'Each arg is an arithmetic expression to be evaluated (see ARITHMETIC EVALUATION in bash(1)). If the last arg evaluates to 0, let returns 1; 0 is returned otherwise.',
  },
  local: {
    synopsis: 'local [option] [name[=value] ... | - ]',
    summary: 'define local variables',
    text: 'For each argument, a local variable named name is created, and assigned value. The option can be any of the options accepted by declare. When local is used within a function, it causes the variable name to have a visible scope restricted to that function and its children. If name is -, the set of shell options is made local to the function: options changed using set inside the function are restored when the function returns. With no operands, local writes a list of local variables to the standard output.\n\nIt is an error to use local when not within a function. The return status is 0 unless local is used outside a function, an invalid name is supplied, or name is a readonly variable.',
  },
  logout: {
    synopsis: 'logout [n]',
    summary: 'exit a login shell',
    text: 'Exit a login shell with exit status n. Returns an error if not executed in a login shell.',
  },
  printf: {
    synopsis: 'printf [-v var] format [arguments]',
    summary: 'format and print arguments under control of the format',
    text: 'Write the formatted arguments to the standard output under the control of the format. The -v option causes the output to be assigned to the variable var rather than being printed to the standard output.\n\nThe format is a character string which contains three types of objects: plain characters, which are simply copied to standard output; character escape sequences, which are converted and copied to the standard output; and format specifications, each of which causes printing of the next successive argument. In addition to the standard printf(1) formats, printf interprets %b (expand backslash escape sequences in the corresponding argument), %q (output the argument in a format that can be reused as shell input), %Q (like %q, but applies any precision to the unquoted argument), and %(datefmt)T (output the date-time string resulting from using datefmt as a format string for strftime(3); the argument is seconds since the epoch, -1 is the current time). The format is reused as necessary to consume all of the arguments; missing arguments are treated as a zero value or null string.\n\nThe return value is zero on success, non-zero if an invalid option is supplied or a write or assignment error occurs.',
  },
  pwd: {
    synopsis: 'pwd [-LP]',
    summary: 'print the name of the current working directory',
    text: 'Print the absolute pathname of the current working directory. The pathname printed contains no symbolic links if the -P option is supplied or the -o physical option to the set builtin command is enabled. If the -L option is used, the pathname printed may contain symbolic links.\n\nThe return status is 0 unless an error occurs while reading the name of the current directory or an invalid option is supplied.',
  },
  read: {
    synopsis: 'read [-ers] [-a aname] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]',
    summary: 'read a line from the standard input and split it into fields',
    text: 'One line is read from the standard input, or from the file descriptor fd supplied as an argument to -u, split into words using the characters in IFS, and the first word is assigned to the first name, the second word to the second name, and so on. If there are more words than names, the remaining words and their intervening delimiters are assigned to the last name. If there are fewer words than names, the remaining names are assigned empty values. The backslash character removes any special meaning for the next character read and is used for line continuation. If no names are supplied, the line read is assigned to the variable REPLY.\n\nOptions: -a aname assigns the words to sequential indices of the array aname, starting at 0; -d delim continues until the first character of delim is read, rather than newline; -e uses readline to obtain the line; -i text places text into the editing buffer when readline is used; -n nchars returns after reading nchars characters or a newline; -N nchars returns only after reading exactly nchars characters, ignoring delimiters; -p prompt displays prompt on standard error, without a trailing newline, if input is coming from a terminal; -r disables backslash escapes and line continuation; -s does not echo input coming from a terminal; -t timeout fails if a complete line is not read within timeout seconds (fractions allowed); -u fd reads from file descriptor fd.\n\nThe exit status is zero, unless end-of-file is encountered, read times out (in which case the status is greater than 128), a variable assignment error occurs, or an invalid file descriptor is supplied as the argument to -u.',
  },
  readonly: {
    synopsis: 'readonly [-aAf] [name[=value] ...] or readonly -p',
    summary: 'mark shell variables as unchangeable',
    text: 'The given names are marked readonly; the values of these names may not be changed by subsequent assignment. If -f is supplied, the functions corresponding to the names are so marked. -a restricts the variables to indexed arrays; -A restricts the variables to associative arrays. If no name arguments are given, or if -p is supplied, a list of all readonly names is printed in a format that may be reused as input. If a variable name is followed by =value, the value of the variable is set to value.\n\nThe return status is 0 unless an invalid option is encountered, one of the names is not a valid shell variable name, or -f is supplied with a name that is not a function.',
  },
  return: {
    synopsis: 'return [n]',
    summary: 'return from a shell function',
    text: 'Causes a function to stop executing and return the value specified by n to its caller. If n is omitted, the return status is that of the last command executed in the function body. If return is used outside a function, but during execution of a script by the . (source) command, it causes the shell to stop executing that script and return either n or the exit status of the last command executed within the script.\n\nThe return status is non-zero if return is supplied a non-numeric argument, or is used outside a function and not during execution of a script by . or source. Any command associated with the RETURN trap is executed before execution resumes after the function or script.',
  },
  set: {
    synopsis: 'set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]',
    summary: 'set or unset values of shell options and positional parameters',
    text: 'Without options, display the name and value of each shell variable in a format that can be reused as input. When options are specified, they set or unset shell attributes. Any arguments remaining after option processing are assigned, in order, to the positional parameters $1, $2, ... $n. Using + rather than - turns the options off. The current set of flags may be found in $-.\n\nCommon options: -e exits immediately if a pipeline, list, or compound command exits with a non-zero status (not in conditions or non-final parts of && and || lists); -f disables pathname expansion; -m enables job control; -n reads commands but does not execute them; -u treats unset variables as an error during parameter expansion; -v prints shell input lines as they are read; -x prints a trace of simple commands and their expanded arguments, preceded by PS4; -C (noclobber) prevents output redirection from overwriting existing files. -o option-name sets an option by name, such as errexit, noglob, nounset, xtrace, vi, emacs, or pipefail (the return value of a pipeline is that of the last command to exit with a non-zero status, or zero if all succeed); -o alone prints the current settings. -- assigns the remaining arguments to the positional parameters, unsetting them if there are none; - turns off -x and -v.\n\nThe return status is always true unless an invalid option is encountered.',
  },
  shift: {
    synopsis: 'shift [n]',
    summary: 'shift positional parameters',
    text: 'The positional parameters from n+1 ... are renamed to $1 .... Parameters represented by the numbers $# down to $#-n+1 are unset. n must be a non-negative number less than or equal to $#. If n is 0, no parameters are changed. If n is not given, it is assumed to be 1. If n is greater than $#, the positional parameters are not changed.\n\nThe return status is greater than zero if n is greater than $# or less than zero; otherwise 0.',
  },
  source: {
    synopsis: 'source filename [arguments]',
    summary: 'execute commands from a file in the current shell',
    text: 'A synonym for the . builtin: read and execute commands from filename in the current shell environment and return the exit status of the last command executed from filename.',
  },
  test: {
    synopsis: 'test expr',
    summary: 'evaluate conditional expression',
    text: 'Return a status of 0 (true) or 1 (false) depending on the evaluation of the conditional expression expr. Each operator and operand must be a separate argument. test does not accept any options, nor does it accept and ignore an argument of -- as signifying the end of options.\n\nFile tests include -e file (exists), -f file (regular file), -d file (directory), -L file (symbolic link), -r, -w, and -x file (readable, writable, executable), -s file (size greater than zero), and file1 -nt file2 (newer than). String tests: -z string (length zero), -n string (length non-zero), string1 = string2, string1 != string2, string1 < string2 (sorts before). Integer tests: arg1 OP arg2, where OP is -eq, -ne, -lt, -le, -gt, or -ge. Expressions may be combined using ! expr, ( expr ), expr1 -a expr2, and expr1 -o expr2.\n\nAn exit status of 2 indicates an invalid expression or argument.',
  },
  time: {
    synopsis: 'time [-p] pipeline',
    summary: "report time consumed by pipeline's execution",
    text: 'Execute pipeline and print a summary of the real time, user CPU time, and system CPU time spent executing pipeline when it terminates. time is a reserved word, not a builtin, so it times the whole pipeline; its report goes to the standard error of the shell, so use { time command; } 2>file to capture it. The -p option prints the summary in the portable POSIX format. The TIMEFORMAT variable may be set to a format string that specifies how the timing information should be displayed.\n\nThe return status is the return status of pipeline.',
  },
  trap: {
    synopsis: 'trap [-lp] [[arg] sigspec ...]',
    summary: 'trap signals and other events',
    text: 'The command arg is read and executed when the shell receives the signal(s) sigspec. If arg is absent (and there is a single sigspec) or -, each specified signal is reset to its original disposition. If arg is the null string, the signal specified by each sigspec is ignored by the shell and by the commands it invokes. If no arguments are supplied, or if only -p is given, trap prints the list of commands associated with each signal. The -l option prints a list of signal names and their corresponding numbers. Each sigspec is either a signal name or a signal number; names are case insensitive and the SIG prefix is optional.\n\nIf a sigspec is EXIT (0), arg is executed on exit from the shell. If a sigspec is DEBUG, arg is executed before every simple command. RETURN executes arg each time a shell function or a script run with . or source finishes. ERR executes arg whenever a pipeline, list, or compound command returns a non-zero exit status, under the same conditions that cause errexit to exit. Signals ignored upon entry to the shell cannot be trapped or reset.\n\nThe return status is false if any sigspec is invalid; otherwise trap returns true.',
  },
  true: {
    synopsis: 'true',
    summary: 'return a successful result',
    text: 'Does nothing, returns a 0 status.',
  },
  type: {
    synopsis: 'type [-afptP] name [name ...]',
    summary: 'display information about command type',
    text: 'With no options, indicate how each name would be interpreted if used as a command name. If -t is used, type prints a string which is one of alias, keyword, function, builtin, or file if name is an alias, shell reserved word, function, builtin, or executable disk file, respectively. If the name is not found, nothing is printed. If -p is used, type returns the name of the disk file that would be executed, or nothing if type -t name would not return file. -P forces a PATH search for each name, even if type -t name would not return file. -a prints all of the places that contain a command named name, including aliases, reserved words, and functions unless -p is also used. -f suppresses shell function lookup, as with command.\n\ntype returns true if all of the arguments are found, false if any are not found.',
  },
  typeset: {
    synopsis: 'typeset [-aAfFgiIlnrtux] [-p] [name[=value] ...]',
    summary: 'set variable values and attributes',
    text: 'A synonym for declare, accepting the same options. typeset is supplied for compatibility with the Korn shell; it has been deprecated in favor of the declare builtin command.',
  },
  umask: {
    synopsis: 'umask [-p] [-S] [mode]',
    summary: 'display or set file mode mask',
    text: 'The user file-creation mask is set to mode. If mode begins with a digit, it is interpreted as an octal number; otherwise it is interpreted as a symbolic mode mask similar to that accepted by chmod(1). If mode is omitted, the current value of the mask is printed. The -S option causes the mask to be printed in symbolic form; the default output is an octal number. If -p is supplied and mode is omitted, the output is in a form that may be reused as input.\n\nThe return status is 0 if the mode was successfully changed or if no mode argument was supplied, and false otherwise.',
  },
  unalias: {
    synopsis: 'unalias [-a] name [name ...]',
    summary: 'remove each name from the list of defined aliases',
    text: 'Remove each name from the list of defined aliases. If -a is supplied, all alias definitions are removed. The return value is true unless a supplied name is not a defined alias.',
  },
  unset: {
    synopsis: 'unset [-f] [-v] [-n] [name ...]',
    summary: 'unset values and attributes of shell variables and functions',
    text: 'For each name, remove the corresponding variable or function. If -v is given, each name refers to a shell variable. If -f is specified, each name refers to a shell function, and the function definition is removed. If -n is supplied and name is a variable with the nameref attribute, name is unset rather than the variable it references. If no options are supplied, each name refers to a variable; if there is no variable by that name, a function with that name, if any, is unset. Read-only variables may not be unset. Unset variables and functions are removed from the environment passed to subsequent commands. If special variables such as RANDOM, SECONDS, or LINENO are unset, they lose their special properties, even if they are subsequently reset.\n\nThe exit status is true unless a name is readonly or may not be unset.',
  },
  wait: {
    synopsis: 'wait [-fn] [-p var] [id ...]',
    summary: 'wait for job completion and return exit status',
    text: "Wait for each specified child process and return its termination status. Each id may be a process ID or a job specification; if a job spec is given, all processes in that job's pipeline are waited for. If id is not given, wait waits for all running background jobs and the return status is zero. If -n is supplied, wait waits for a single job from the list of ids or, if no ids are supplied, any job, to complete and returns its exit status. If -p is supplied, the process or job identifier of the job whose status is returned is assigned to the variable var. If -f is supplied and job control is enabled, wait forces id to terminate before returning its status.\n\nIf id specifies a non-existent process or job, the return status is 127. If wait is interrupted by a signal, the return status is greater than 128. Otherwise, the return status is the exit status of the last process or job waited for.",
  },
};
