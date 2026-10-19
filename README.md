# tuxrt

tuxrt is an Ubuntu 24.04 command line that runs entirely in memory, written in TypeScript with zero runtime dependencies. It includes a virtual Linux filesystem, a bash-compatible shell, coreutils, users and permissions, processes and jobs, a package manager, and a sandboxed `node`. Nothing it does touches the host machine.

```
$ npm start
Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)
...
ubuntu@ubuntu:~$ mkdir -p proj/{src,test} && cd proj
ubuntu@ubuntu:~/proj$ echo 'console.log(require("os").hostname())' > src/hi.js && node src/hi.js
ubuntu
ubuntu@ubuntu:~/proj$ sudo apt install cowsay && cowsay moo | head -3
```

## Usage

Requires Node >= 23.6, which runs the `.ts` sources directly. There is no build step.

```sh
npm start                          # interactive login shell (tab completion, history, Ctrl-C, Ctrl-D)
node src/cli.ts -c 'uname -a'      # run one command
node src/cli.ts script.sh a b      # run a host script inside the machine
echo 'ls /etc | wc -l' | node src/cli.ts
node src/cli.ts --state disk.json  # persist the filesystem between sessions
node src/cli.ts -u root            # log in as root
```

### Library

```ts
import { Runtime } from 'tuxrt';

const rt = await Runtime.boot();
const { stdout, code } = await rt.exec('echo hi | tr a-z A-Z');
```

`rt.run(src, { stdin, stdout, stderr })` streams output instead of capturing it, and `rt.interrupt()` delivers SIGINT to the foreground job.

## What is emulated

- **Filesystem.** An inode-based VFS with files, directories, symlinks, hard links, modes, owners, and setuid/sticky bits. Permissions are enforced (`/etc/shadow`, `/root`, and `/etc` are closed to `ubuntu`). It has a full Ubuntu layout (`/etc/os-release`, `/etc/passwd`, `/home/ubuntu`, `/tmp` with mode 1777, `/bin -> usr/bin`), plus live `/proc` (`cpuinfo`, `meminfo`, `uptime`, `version`) and `/dev` (`null`, `zero`, `urandom`, `tty`).
- **Shell.** A bash-compatible lexer, parser, and interpreter:
  - Constructs: pipelines (streaming, with SIGPIPE semantics), `&&`, `||`, `;`, `&`, subshells, `{ }` groups, `if`, `for`, `while`, `until`, `case`, functions with `local`, `[[ ]]` with globs and `=~`, and `!`.
  - Expansions: parameters (`${x:-y}`, `${x#p}`, `${x//a/b}`, `${x^^}`, `${#x}`, `${x:1:2}`), `$(...)` and backticks, `$((...))`, brace expansion, tilde, globbing, IFS word splitting, `$'...'`, and the special parameters (`$? $$ $! $# $@ $0 $RANDOM`).
  - Redirections: `> >> < 2>&1 &> <<EOF <<- <<<`.
  - Builtins: aliases, `set -euxo pipefail`, `read`, `getopts`, `printf`, `test`, `eval`, `source`, and `exec`.
- **Processes.** A process table with system daemons. Each command runs as a process visible to `ps`. Background jobs work with `jobs`, `fg`, `wait`, and `kill %1`, and Ctrl-C reaches running commands.
- **Users.** `sudo`, `su`, `sudo -i`, `useradd`, `passwd`, `id`, and `groups`, backed by `/etc/passwd` and `/etc/group`.
- **Commands.** Run `compgen -c` or `ls /usr/bin` to see the full list. Programs live in `/usr/bin` as ELF stubs, so `PATH`, `which`, `cp /usr/bin/ls ~/myls`, and executable scripts with shebangs (`#!/bin/bash`, `#!/usr/bin/env node`) all behave as they would on Linux.

## Layout

```
src/vfs/        filesystem, Ubuntu rootfs bootstrap, procfs/devfs, users, snapshots
src/shell/      lexer, parser, expansions, interpreter, redirections, jobs, processes
src/commands/   builtins/ fs/ text/ awk/ sys/ extra/ (one CommandTable per group)
src/repl/       interactive terminal: prompt, completion, TTY stdin
src/runtime.ts  public API;  src/cli.ts  entry point
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for how to add a command.

## Development

```sh
npm install         # dev-only: typescript, @types/node
npm test            # node:test suites
npm run typecheck
```

## Limitations

- Everything in the VFS is a string, and binary data is stored as latin1.
- Full-screen TUIs (`vim`, `nano`, `htop`, `less`) are not implemented.
- `node` uses `node:vm` for isolation from the host filesystem, which makes it a convenience sandbox rather than a security boundary.
- Bash arrays and `trap` are not implemented.
