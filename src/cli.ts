#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { binaryNames, createRegistry } from './commands/index.ts';
import { motd } from './repl/motd.ts';
import { startRepl } from './repl/repl.ts';
import { streamReader, terminalWriter } from './repl/tty.ts';
import { Runtime } from './node.ts';
import { EMPTY, readAll } from './shell/io.ts';
import { restore, snapshot } from './vfs/persist.ts';

const USAGE = `Usage: tuxrt [options] [script [args...]]

An Ubuntu 24.04 shell environment emulated entirely in memory.

Options:
  -c COMMAND      run COMMAND and exit
  -u, --user U    log in as user U (default: ubuntu; try root)
  --state FILE    load the filesystem from FILE (JSON) and save it back on exit
  -q, --quiet     skip the login banner
  -h, --help      show this help
  -V, --version   print version
`;

/** Scripts saved on Windows arrive with CRLF; normalize so a stray \r never leaks into arguments. */
function toLF(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

async function main(argv: string[]): Promise<number> {
  let command: string | undefined;
  let user: string | undefined;
  let state: string | undefined;
  let quiet = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest.length) rest.push(a);
    else if (a === '-c') command = argv[++i];
    else if (a === '-u' || a === '--user') user = argv[++i];
    else if (a === '--state') state = argv[++i];
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (a === '-h' || a === '--help') return void process.stdout.write(USAGE), 0;
    else if (a === '-V' || a === '--version') return void process.stdout.write('tuxrt 0.1.0 (Ubuntu 24.04.1 LTS emulation)\n'), 0;
    else rest.push(a);
  }

  const stdout = terminalWriter(process.stdout);
  const stderr = terminalWriter(process.stderr);
  const interactive = command === undefined && !rest.length && process.stdin.isTTY;
  const vfs = state && existsSync(state) ? restore(readFileSync(state, 'utf8'), binaryNames(createRegistry()), (d) => stderr.write(d)) : undefined;
  const rt = await Runtime.boot({ user, vfs, stderr, login: interactive });
  const save = () => state && writeFileSync(state, snapshot(rt.kernel.vfs));

  let code: number;
  if (interactive) {
    if (!quiet) stdout.write(motd(rt.shell.user));
    code = await startRepl(rt);
  } else {
    let src = command;
    if (src === undefined && rest.length) {
      src = toLF(readFileSync(rest[0], 'utf8'));
      rt.shell.argv0 = rest.shift()!;
    } else if (src !== undefined && rest.length) rt.shell.argv0 = rest.shift()!;
    rt.shell.positional = rest;
    const stdin = src === undefined || process.stdin.isTTY ? EMPTY : streamReader(process.stdin);
    src ??= toLF(await readAll(streamReader(process.stdin)));
    code = await rt.run(src, { stdin, stdout, stderr });
    if (rt.exited !== null) code = rt.exited;
  }
  save();
  return code;
}

process.exitCode = await main(process.argv.slice(2));
