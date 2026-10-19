import { UsageError } from '../util.ts';

export interface GetoptSpec {
  flags?: string;
  values?: string;
  /** Letters whose value may only be attached (`-i.bak`, `-i`), like GNU optional arguments. */
  optional?: string;
  /** Letter that receives obsolete numeric options such as `head -5`. */
  numeric?: string;
  long?: Record<string, string>;
}

export interface Getopt {
  /** Every option in command-line order, so repeated ones (grep -e, sed -e) survive. */
  list: [string, string | true][];
  opts: Record<string, string | true>;
  operands: string[];
}

/** util.parseArgs plus ordered repeats, attached-only optional values, and `-NUM` shorthand. */
export function getopt(args: string[], spec: GetoptSpec): Getopt {
  const { flags = '', values = '', optional = '', numeric } = spec;
  const list: [string, string | true][] = [];
  const operands: string[] = [];
  const set = (k: string, v: string | true) => list.push([k, v]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      const keys = Object.keys(spec.long ?? {});
      const exact = keys.find((k) => k.replace(/=$/, '') === name);
      const prefixed = keys.filter((k) => k.startsWith(name));
      const key = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!key) throw new UsageError(prefixed.length ? `option '${a}' is ambiguous` : `unrecognized option '${a}'`);
      const target = spec.long![key];
      if (key.endsWith('=')) {
        const v = inline ?? args[++i];
        if (v === undefined) throw new UsageError(`option '--${key.slice(0, -1)}' requires an argument`);
        set(target, v);
      } else set(target, inline ?? true);
      continue;
    }
    if (a.length < 2 || a[0] !== '-') {
      operands.push(a);
      continue;
    }
    if (numeric && /^-\d+$/.test(a)) {
      set(numeric, a.slice(1));
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (optional.includes(c)) {
        set(c, a.slice(j + 1) || true);
        break;
      }
      if (values.includes(c)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (v === undefined) throw new UsageError(`option requires an argument -- '${c}'`);
        set(c, v);
        break;
      }
      if (!flags.includes(c)) throw new UsageError(`invalid option -- '${c}'`);
      set(c, true);
    }
  }
  return { list, opts: Object.fromEntries(list), operands };
}

const SIZES: Record<string, number> = { '': 1, b: 512, k: 1024, K: 1024, kB: 1000, KB: 1000, M: 1024 ** 2, MB: 1e6, G: 1024 ** 3, GB: 1e9, T: 1024 ** 4, TB: 1e12 };

/** Parses counts like "10", "-5", "+3", "2K", "1MiB". Returns null when invalid. */
export function parseCount(s: string): { n: number; sign: string } | null {
  const m = /^([-+]?)(\d+)([a-zA-Z]*)$/.exec(s);
  if (!m) return null;
  const mult = SIZES[m[3].replace(/iB$/, '')];
  return mult === undefined ? null : { n: Number(m[2]) * mult, sign: m[1] };
}
