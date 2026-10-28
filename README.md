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

It runs the same on Linux, macOS and Windows on Node 24 or later. Development runs the `.ts` sources directly; the published package is compiled JavaScript (`npm run build` writes `dist/`).

```sh
npm start                          # interactive login shell (tab completion, history, Ctrl-C, Ctrl-D)
npx tuxrt                          # same, from the built package
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

### Agent harness

`AgentShell` gives an agent one persistent machine behind a `bash` tool:

```ts
import { AgentShell, BASH_TOOL, nodeHostFs } from 'tuxrt';

const shell = await AgentShell.create({
  mounts: { '/home/ubuntu/workspace': nodeHostFs('./workspace') }, // the real directory, read and written live
  timeoutMs: 120_000, // per call; the model may ask for up to maxTimeoutMs (600 s)
  maxOutput: 30_000,  // characters of stdout and of stderr kept per call
});

// Register BASH_TOOL with the model (`input_schema`; use BASH_INPUT_SCHEMA as OpenAI `parameters`), then per call:
const { output } = await shell.run(toolCall.input); // { command, timeout?, restart? } -> text for the tool result
```

- **Session state.** The cwd, variables and functions carry over between calls. `restart: true` or `exit` gives a fresh shell on the same files.
- **Results.** `output` combines stdout and stderr. It ends with `[exit code N]`, `[killed: timed out after Ns]` or `[output truncated after N characters]` when one applies. A command that floods output stops at the cap, the way `yes | head` does.
- **Persistence.** `shell.snapshot()` returns the filesystem as JSON, and `AgentShell.create({ state })` resumes from it. Mounted host directories are not part of the snapshot.
- **Mounts.** `HostFs` is a small synchronous interface: `lstat`, `readdir`, `readFile`, `writeFile`, `mkdir`, `unlink`, `rmdir`, `rename`, plus optional `readlink`, `symlink`, `chmod` and `utimes`. On iOS, implement it with Swift functions exposed to the `JSContext`. `nodeHostFs(dir)` is the Node version, and it refuses any path or host symlink that leads outside `dir`. Symlinks inside a mount resolve within the machine, not on the host.
- **Lower level.** `Runtime` offers `rt.exec(cmd, { stdin, timeoutMs, maxOutput })` and `rt.mount(path, hostFs)`.

### Any JavaScript engine

The core is plain ECMAScript 2020 with no Node, DOM or `node:` imports, enforced by `tsconfig.core.json`. It runs on Node, Bun, Deno, browsers, JavaScriptCore (iOS and macOS, including a Swift `JSContext`), Hermes and QuickJS. On Node, the `node` export condition adds real sockets and resolvers, native deflate, process stats, a worker-thread `jq`, and the `node` command. Every other engine gets `tuxrt/portable`, or `tuxrt/bundle`, a single IIFE file that defines a global `tuxrt` for hosts that evaluate scripts.

The engine only needs `setTimeout`. Each of the following globals is used when present:

- `fetch`: curl and wget, plus DNS over HTTPS (Cloudflare) for `dig` and `ping`.
- `crypto.getRandomValues` and `performance.now`.
- `TextEncoder` and `URL`. tuxrt ships pure-JS fallbacks for both, along with deflate and the hash functions.

Hosts can replace any piece:

```js
// e.g. after JSContext.evaluateScript(tuxrt.js) in Swift, with native bridges for timers and HTTP
tuxrt.configurePlatform({
  setTimeout: hostSetTimeout,
  clearTimeout: hostClearTimeout,
  http: hostHttp,
});
const rt = await tuxrt.Runtime.boot();
```

See `Platform` in `src/platform/index.ts` for the full interface (clock, randomness, timers, HTTP, DNS, TCP probe, extra commands).

Without threads, `jq` runs on the caller's thread. Streaming and Ctrl-C work between outputs, but a filter that loops forever without output can't be interrupted, and recursion depth is limited by the engine's stack.

## What is emulated

- **Filesystem.** An inode-based VFS with files, directories, symlinks, hard links, modes, owners, and setuid/sticky bits. Permissions are enforced (`/etc/shadow`, `/root`, and `/etc` are closed to `ubuntu`). It has a full Ubuntu layout (`/etc/os-release`, `/etc/passwd`, `/home/ubuntu`, `/tmp` with mode 1777, `/bin -> usr/bin`), plus live `/proc` (`cpuinfo`, `meminfo`, `uptime`, `version`) and `/dev` (`null`, `zero`, `urandom`, `tty`).
- **Shell.** A bash-compatible lexer, parser, and interpreter:
  - Constructs: pipelines (streaming, with SIGPIPE semantics), `&&`, `||`, `;`, `&`, subshells, `{ }` groups, `if`, `for`, `while`, `until`, `case`, functions with `local`, `[[ ]]` with globs and `=~`, and `!`.
  - Expansions: parameters (`${x:-y}`, `${x#p}`, `${x//a/b}`, `${x^^}`, `${#x}`, `${x:1:2}`), `$(...)` and backticks, `$((...))`, brace expansion, tilde, globbing, IFS word splitting, `$'...'`, and the special parameters (`$? $$ $! $# $@ $0 $RANDOM`).
  - Redirections: `> >> < 2>&1 &> <<EOF <<- <<<`.
  - Builtins: aliases, `set -euxo pipefail`, `read`, `getopts`, `printf`, `test`, `eval`, `source`, and `exec`.
- **Processes.** A process table with system daemons. Each command runs as a process visible to `ps`. Background jobs work with `jobs`, `fg`, `wait`, and `kill %1`, and Ctrl-C reaches running commands.
- **Users.** `sudo`, `su`, `sudo -i`, `useradd`, `passwd`, `id`, and `groups`, backed by `/etc/passwd` and `/etc/group`. Members of the `sudo` group can use sudo without a password, as on an Ubuntu cloud image, and root's password is locked.
- **Network.** `curl` and `wget` make real HTTP requests. `ping` and `ping6` resolve names with real DNS and report a real round-trip time. On Node the time comes from a TCP connect, because ICMP needs raw sockets that Node does not offer on every OS. Engines with only `fetch` time an HTTP request instead. `traceroute` emulates the gateway hop and measures the destination for real. `dig`, `host`, and `nslookup` query real DNS.
- **Archives.** `tar` (ustar, `-z`), `gzip`/`gunzip`/`zcat`, and `zip`/`unzip` produce and read real archive bytes.
- **Docs.** `man`, `whatis`, `apropos`, and `mandb` render roff pages the way man-db does. There are hand-written pages for the core commands, and pages generated from the registry for everything else.
- **Packages.** `apt` and `dpkg` simulate installs. `cowsay` and `jq` come preinstalled, while `figlet`, `sl`, and `neofetch` appear after `sudo apt install`.
- **JavaScript.** `node` runs scripts inside the machine. `fs`, `os`, `path`, and `child_process` are backed by the VFS and the shell, and `process.platform` is `linux` on every host.
- **Commands.** Run `compgen -c` or `ls /usr/bin` to see the full list. Programs live in `/usr/bin` as ELF stubs, so `PATH`, `which`, `cp /usr/bin/ls ~/myls`, and executable scripts with shebangs (`#!/bin/bash`, `#!/usr/bin/env node`) all behave as they would on Linux.

## Layout

```
src/vfs/        filesystem, Ubuntu rootfs bootstrap, procfs/devfs, users, snapshots
src/shell/      lexer, parser, expansions, interpreter, redirections, jobs, processes
src/commands/   builtins/ fs/ text/ awk/ sys/ extra/ (one CommandTable per group)
src/repl/       interactive terminal: prompt, completion, TTY stdin
src/platform/   host abstraction: portable defaults, HTTP/DNS over fetch, URL fallback; node/ adapter
src/lib/        pure-JS deflate/inflate and MD5/SHA digests
src/runtime.ts  portable API;  src/node.ts  Node entry;  src/cli.ts  CLI
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for how to add a command.

## Development

```sh
npm install            # dev-only: typescript, @types/node, esbuild
npm test               # node:test suites on the Node platform
npm run test:portable  # the same suites on the plain-ECMAScript platform
npm run typecheck      # includes the no-Node core check
```

## Limitations

- Everything in the VFS is a string, and binary data is stored as latin1.
- Full-screen TUIs (`vim`, `nano`, `htop`, `less`) are not implemented, and `man` prints without a pager.
- `ping` and `traceroute` approximate ICMP with TCP connects, as described above.
- `node` uses `node:vm` for isolation from the host filesystem, which makes it a convenience sandbox rather than a security boundary.
- Bash arrays and `trap` are not implemented.

## License

[MIT](LICENSE) © Ryan Yannelli. Ubuntu is a trademark of Canonical Ltd. tuxrt emulates its command-line behavior and is not affiliated with or endorsed by Canonical.
