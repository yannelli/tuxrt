import { normalize } from '../../../../vfs/path.ts';

export type TarMode = 'c' | 'x' | 't';

export interface Operand {
  name: string;
  /** Absolute directory from the -C options seen before this operand. */
  dir: string;
}

export interface TarArgs {
  mode: TarMode | null;
  file: string | null;
  gzip: boolean;
  auto: boolean;
  verbose: number;
  preserve: boolean;
  toStdout: boolean;
  dir: string;
  /** The last -C value as typed, for diagnostics. */
  dirArg: string | null;
  excludes: string[];
  operands: Operand[];
}

export class TarUsage extends Error {}

const FLAGS = 'cxtvzpOa';
const VALUED = 'fC';
const LONG: Record<string, string> = {
  create: 'c', extract: 'x', get: 'x', list: 't', verbose: 'v', gzip: 'z', gunzip: 'z', ungzip: 'z',
  'preserve-permissions': 'p', 'same-permissions': 'p', 'to-stdout': 'O', 'auto-compress': 'a',
  file: 'f', directory: 'C', exclude: 'exclude',
};
const LONG_VALUED = new Set(['file', 'directory', 'exclude']);

const MODE_ERROR = "You may not specify more than one '-Acdtrux', '--delete' or  '--test-label' option";

function apply(a: TarArgs, key: string, value?: string): void {
  if (key === 'c' || key === 'x' || key === 't') {
    if (a.mode && a.mode !== key) throw new TarUsage(MODE_ERROR);
    a.mode = key;
  } else if (key === 'v') a.verbose++;
  else if (key === 'z') a.gzip = true;
  else if (key === 'a') a.auto = true;
  else if (key === 'p') a.preserve = true;
  else if (key === 'O') a.toStdout = true;
  else if (key === 'f') a.file = value!;
  else if (key === 'C') {
    a.dir = normalize(value!, a.dir);
    a.dirArg = value!;
  }
  else if (key === 'exclude') a.excludes.push(value!);
}

/** Parses GNU tar argv: old-style bundled first word ("czf a.tgz"), -short, and --long[=value] forms. */
export function parseTarArgs(argv: string[], cwd: string): TarArgs {
  const a: TarArgs = {
    mode: null, file: null, gzip: false, auto: false, verbose: 0, preserve: false, toStdout: false,
    dir: cwd, dirArg: null, excludes: [], operands: [],
  };
  let args = argv;
  if (args.length && args[0] && !args[0].startsWith('-')) {
    const letters = args[0];
    args = args.slice(1);
    for (const c of letters) {
      if (VALUED.includes(c)) {
        if (!args.length) throw new TarUsage(`option requires an argument -- '${c}'`);
        apply(a, c, args[0]);
        args = args.slice(1);
      } else if (FLAGS.includes(c)) apply(a, c);
      else throw new TarUsage(`invalid option -- '${c}'`);
    }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      for (const name of args.slice(i + 1)) a.operands.push({ name, dir: a.dir });
      break;
    }
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s);
      const key = Object.hasOwn(LONG, name) ? LONG[name] : undefined;
      if (!key) throw new TarUsage(`unrecognized option '${arg}'`);
      if (!LONG_VALUED.has(name)) {
        if (inline !== undefined) throw new TarUsage(`option '--${name}' doesn't allow an argument`);
        apply(a, key);
        continue;
      }
      const value = inline ?? args[++i];
      if (value === undefined) throw new TarUsage(`option '--${name}' requires an argument`);
      apply(a, key, value);
      continue;
    }
    if (arg.length < 2 || arg[0] !== '-') {
      a.operands.push({ name: arg, dir: a.dir });
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const c = arg[j];
      if (VALUED.includes(c)) {
        const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
        if (value === undefined) throw new TarUsage(`option requires an argument -- '${c}'`);
        apply(a, c, value);
        break;
      }
      if (!FLAGS.includes(c)) throw new TarUsage(`invalid option -- '${c}'`);
      apply(a, c);
    }
  }
  return a;
}
