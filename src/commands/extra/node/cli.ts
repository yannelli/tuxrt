import { readAll } from '../../../shell/io.ts';
import type { Ctx } from '../../types.ts';
import { NODE_VERSION } from './errors.ts';
import { NodeRuntime, type Main } from './runtime.ts';

const HELP = `Usage: node [options] [ script.js ] [arguments]

Options:
  -                           script read from stdin (default if no file name is
                              provided, interactive mode if a tty)
  --                          indicate the end of node options
  -c, --check                 syntax check script without executing
  -e, --eval=...              evaluate script
  -h, --help                  print node command line options
  -i, --interactive           always enter the REPL even if stdin does not appear
                              to be a terminal
  -p, --print [...]           evaluate script and print result
  -r, --require=...           CommonJS module to preload (option can be repeated)
  -v, --version               print Node.js version

Documentation can be found at https://nodejs.org/
`;

// Accepted for compatibility; they change nothing in the sandbox.
const IGNORED =
  /^--(no-warnings|no-deprecation|enable-source-maps|(no-)?experimental-[\w-]+(=.*)?|trace-[\w-]+|max-old-space-size=.*|stack-size=.*|input-type=.*|title=.*|unhandled-rejections=.*|preserve-symlinks(-main)?|throw-deprecation|pending-deprecation)$/;

function bad(ctx: Ctx, msg: string): number {
  ctx.stderr.write(`${ctx.name}: ${msg}\n`);
  return 9;
}

export async function nodeMain(ctx: Ctx): Promise<number> {
  const args = ctx.args;
  let code: string | undefined;
  let print = false;
  let check = false;
  let interactive = false;
  const preload: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '-' || !a.startsWith('-')) break;
    const [flag, inline] = a.startsWith('--') ? (a.split(/=(.*)/s) as [string, string?]) : [a, undefined];
    const value = () => inline ?? args[++i];
    switch (flag) {
      case '-v':
      case '--version':
        ctx.stdout.write(`${NODE_VERSION}\n`);
        return 0;
      case '-h':
      case '--help':
        ctx.stdout.write(HELP);
        return 0;
      case '-e':
      case '--eval':
      case '-pe':
      case '-ep':
        print ||= flag.length === 3;
        code = value();
        if (code === undefined) return bad(ctx, `${a} requires an argument`);
        break;
      case '-p':
      case '--print':
        print = true;
        if (inline !== undefined || (args[i + 1] !== undefined && !args[i + 1].startsWith('-'))) code = value();
        break;
      case '-c':
      case '--check':
        check = true;
        break;
      case '-i':
      case '--interactive':
        interactive = true;
        break;
      case '-r':
      case '--require': {
        const id = value();
        if (id === undefined) return bad(ctx, `${a} requires an argument`);
        preload.push(id);
        break;
      }
      default:
        if (!IGNORED.test(a)) return bad(ctx, `bad option: ${a}`);
    }
  }
  const rest = args.slice(i);
  const script = code === undefined && rest[0] !== undefined && rest[0] !== '-' ? ctx.shell.abs(rest[0]) : undefined;
  const argv = script ? ['/usr/bin/node', script, ...rest.slice(1)] : ['/usr/bin/node', ...rest.filter((a, n) => n > 0 || a !== '-')];
  const rt = new NodeRuntime(ctx, argv);
  let main: Main;
  if (code !== undefined) main = { kind: 'eval', code, filename: '[eval]', print, preload };
  else if (script) main = { kind: 'file', path: script, preload, check };
  else if (interactive || (ctx.stdin.isTTY && rest[0] !== '-')) main = { kind: 'repl', preload };
  else main = { kind: 'eval', code: await readAll(ctx.stdin), filename: '[stdin]', print, preload };
  return rt.run(main);
}
