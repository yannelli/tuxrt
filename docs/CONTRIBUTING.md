# Writing commands for tuxrt

tuxrt is a TypeScript runtime that emulates an Ubuntu 24.04 CLI entirely in memory. Node >= 23.6 runs the `.ts` sources directly (type stripping), so there is no build step.

## Constraints

- Erasable TypeScript only: no `enum`, `namespace`, or constructor parameter properties. Imports use the `.ts` extension, and type-only imports use `import type`.
- Keep every file under 300 lines. Split a large command into its own file or a subdirectory.
- No runtime dependencies. Node built-ins such as `node:crypto`, `node:zlib`, and `node:vm` are allowed.
- Comments explain a non-obvious "why" only, and stay at two lines or fewer.

## Anatomy of a command

```ts
import type { CommandTable } from '../types.ts';
import { command, parseArgs, readInputs, fail } from '../util.ts';

export const myCommands: CommandTable = {
  rev: {
    desc: 'reverse lines characterwise',
    fn: command(async (ctx) => {
      const { opts, operands } = parseArgs(ctx.args, { flags: 'z', long: { help: 'help' } });
      return readInputs(ctx, operands, (text) => { /* ... */ ctx.stdout.write(out); });
    }),
  },
};
```

- `ctx`: `{ name, args, stdin, stdout, stderr, shell, vfs, signal, env }` (see `src/commands/types.ts`).
- `ctx.stdin` is a streaming `Reader`. Use `readAll(ctx.stdin)` from `src/shell/io.ts`, or `lineReader(ctx.stdin).next()` to read line by line (needed by `head` so `yes | head` terminates).
- `ctx.stdout.write(s)` throws `BrokenPipe` once the downstream reader has gone. Let it propagate.
- `ctx.stdout.isTTY` is true only on the interactive terminal; use it to decide on colors.
- Long-running loops must `await` periodically and stop when `ctx.signal.aborted` is true (Ctrl-C, `kill`). Use `sleep(ms, ctx.signal)` from util.
- Paths: resolve user paths with `ctx.shell.abs(p)`, then call `ctx.vfs` (`src/vfs/vfs.ts`). VFS methods throw `FsError` (`code`, `path`, Linux message). An uncaught `FsError` prints `name: path: message` and exits 1. Use `fsFail(ctx, path, e, 'cannot stat')` for coreutils-style messages.
- Permissions are enforced. `ctx.vfs.cred` is the calling user (root has uid 0). Users and groups live in `/etc/passwd` and `/etc/group`; see `src/vfs/users.ts`.
- `command(fn)` wraps the body so `UsageError` thrown by `parseArgs` prints usage and exits 2.
- To run another command (for `xargs`, `sudo`, `find -exec`, or `timeout`), call `dispatch(argv, ctx.shell, io)` from `src/shell/simple.ts`.
- The machine profile (kernel, CPU, memory) is in `src/vfs/machine.ts`, and the process table is `ctx.shell.kernel.procs`.

## Tests

Use `node:test` with the helpers in `test/helpers.ts`:

```ts
import { sh, machine } from './helpers.ts';
const r = await sh('printf "b\\na\\n" | sort');  // { stdout, stderr, code }
```

Run the checks with `npx tsc --noEmit` and `node --test test/<file>.test.ts`.
