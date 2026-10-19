import { parseOne } from './json.ts';
import type { Value } from './value.ts';

export class CliError extends Error {}

export interface Options {
  filter: string | null;
  files: string[];
  flags: Set<string>;
  indent: number;
  /** Named globals; files are read later for --slurpfile/--rawfile. */
  named: { name: string; value?: Value; file?: string; raw?: boolean }[];
  positional: Value[];
  libraryPaths: string[];
}

const SHORT: Record<string, string> = {
  s: 'slurp', r: 'raw-output', j: 'join-output', a: 'ascii-output', c: 'compact-output', n: 'null-input', R: 'raw-input',
  C: 'color-output', M: 'monochrome-output', S: 'sort-keys', e: 'exit-status', h: 'help', V: 'version', f: 'from-file',
};
const FLAGS = new Set([...Object.values(SHORT), 'raw-output0', 'tab', 'seq', 'unbuffered', 'args', 'jsonargs', 'stream', 'build-configuration']);

export const HINT = 'Use jq --help for help with command-line options,\nor see the jq manpage, or online docs  at https://jqlang.github.io/jq\n';

export const HELP = `Usage:\tjq [OPTIONS] FILTER [FILES...]
\tjq [OPTIONS] --args FILTER [ARGUMENTS...]
\tjq [OPTIONS] --jsonargs FILTER [JSON_VALUES...]

jq is a tool for processing JSON inputs, applying the given filter to
its JSON text inputs and producing the filter's results as JSON on
standard output.

The simplest filter is ., which copies jq's input to its output
unmodified except for formatting. For more advanced filters see
the jq(1) manpage ("man jq") and/or https://jqlang.github.io/jq/.

Example:

\t$ echo '{"foo": 0}' | jq .
\t{
\t  "foo": 0
\t}

Command options:
  -n, --null-input          use \`null\` as the single input value;
  -R, --raw-input           read each line as string instead of JSON;
  -s, --slurp               read all inputs into an array and use it as
                            the single input value;
  -c, --compact-output      compact instead of pretty-printed output;
  -r, --raw-output          output strings without escapes and quotes;
      --raw-output0         implies -r and output NUL after each output;
  -j, --join-output         implies -r and output without newline after
                            each output;
  -a, --ascii-output        output strings by only ASCII characters
                            using escape sequences;
  -S, --sort-keys           sort keys of each object on output;
  -C, --color-output        colorize JSON output;
  -M, --monochrome-output   disable colored output;
      --tab                 use tabs for indentation;
      --indent n            use n spaces for indentation (max 7 spaces);
      --unbuffered          flush output stream after each output;
      --seq                 parse input/output as application/json-seq;
  -f, --from-file file      load filter from the file;
      --arg name value      set $name to the string value;
      --argjson name value  set $name to the JSON value;
      --slurpfile name file set $name to an array of JSON values read
                            from the file;
      --rawfile name file   set $name to string contents of file;
      --args                consume remaining arguments as positional
                            string values;
      --jsonargs            consume remaining arguments as positional
                            JSON values;
  -e, --exit-status         set exit status code based on the output;
  -V, --version             show the version;
  -h, --help                show the help;
  --                        terminates argument processing;

Named arguments are also available as $ARGS.named[], while
positional arguments are available as $ARGS.positional[].
`;

function json(text: string, what: string): Value {
  try {
    return parseOne(text);
  } catch {
    throw new CliError(`Invalid JSON text passed to --${what}`);
  }
}

/** jq's own argument rules: options anywhere, bundled short flags, two-value --arg forms. */
export function parseCli(args: string[]): Options {
  const o: Options = { filter: null, files: [], flags: new Set(), indent: 2, named: [], positional: [], libraryPaths: [] };
  let mode: 'files' | 'args' | 'jsonargs' = 'files';
  let done = false;
  const take = (i: number, n: number, opt: string, usage: string): string[] => {
    if (i + n >= args.length) throw new CliError(`--${opt} takes ${n === 1 ? 'one parameter' : 'two parameters'} (e.g. --${opt} ${usage})`);
    return args.slice(i + 1, i + 1 + n);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (done || a === '-' || !a.startsWith('-')) {
      if (o.filter === null) o.filter = a;
      else if (mode === 'files') o.files.push(a);
      else o.positional.push(mode === 'args' ? a : json(a, 'jsonargs'));
      continue;
    }
    if (a === '--') {
      done = true;
      continue;
    }
    if (!a.startsWith('--')) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'L') {
          o.libraryPaths.push(j + 1 < a.length ? a.slice(j + 1) : take(i++, 1, 'library-path', 'dir')[0]);
          break;
        }
        if (SHORT[c]) o.flags.add(SHORT[c]);
        else throw new CliError(`Unknown option: ${a}`);
      }
      continue;
    }
    const name = a.slice(2);
    if (name === 'arg' || name === 'argjson') {
      const [n, v] = take(i, 2, name, 'varname value');
      o.named.push({ name: n, value: name === 'arg' ? v : json(v, 'argjson') });
      i += 2;
    } else if (name === 'slurpfile' || name === 'rawfile') {
      const [n, f] = take(i, 2, name, 'varname filename');
      o.named.push({ name: n, file: f, raw: name === 'rawfile' });
      i += 2;
    } else if (name === 'indent') {
      const n = Number(take(i, 1, name, '2')[0]);
      if (!Number.isInteger(n) || n < 0) throw new CliError('--indent takes a number');
      if (n > 7) throw new CliError('Cannot indent more than 7 characters');
      o.indent = n;
      i++;
    } else if (name === 'library-path') o.libraryPaths.push(take(i++, 1, name, 'dir')[0]);
    else if (FLAGS.has(name)) {
      o.flags.add(name);
      if (name === 'args' || name === 'jsonargs') mode = name;
    } else throw new CliError(`Unknown option: ${a}`);
  }
  return o;
}
