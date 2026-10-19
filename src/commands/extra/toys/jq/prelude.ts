import type { FuncDef } from './ast.ts';
import { fn } from './define.ts';
import { defineFn, setVar } from './scope.ts';
import { parseDefs } from './parser.ts';
import { natives, type Env, type Runtime } from './registry.ts';
import type { Value } from './value.ts';
import './control.ts';
import './data.ts';
import './dates.ts';
import './entries.ts';
import './math.ts';
import './regex.ts';
import './strings.ts';

/** Builtins jq itself defines in jq (adapted from jq 1.7.1's builtin.jq). */
const SOURCE = `
def values: select(. != null);
def nulls: select(. == null);
def booleans: select(type == "boolean");
def numbers: select(type == "number");
def strings: select(type == "string");
def arrays: select(type == "array");
def objects: select(type == "object");
def iterables: select(type|. == "array" or . == "object");
def scalars: select(type|. != "array" and . != "object");
def map_values(f): .[] |= f;
def with_entries(f): to_entries | map(f) | from_entries;
def recurse(f; cond): def r: ., (f | select(cond) | r); r;
def any: reduce .[] as $x (false; . or $x);
def all: reduce .[] as $x (true; . and $x);
def any(f): reduce (.[] | f) as $x (false; . or $x);
def all(f): reduce (.[] | f) as $x (true; . and $x);
def any(g; cond): isempty(first(g | cond or empty)) | not;
def all(g; cond): isempty(first(g | cond and empty));
def in(xs): . as $x | xs | has($x);
def inside(xs): . as $x | xs | contains($x);
def combinations: if length == 0 then [] else .[0][] as $x | (.[1:] | combinations) as $w | [$x] + $w end;
def combinations(n): . as $dot | [range(n)] | map($dot) | combinations;
def walk(f): def w: if type == "object" then map_values(w) elif type == "array" then map(w) else . end | f; w;
def first: .[0];
def last: .[-1];
def nth($n): .[$n];
def nth($n; f): if $n < 0 then error("Out of bounds negative array index") else last(limit($n + 1; f)) end;
def index($i): indices($i) | .[0];
def rindex($i): indices($i) | .[-1:][0];
def paths: path(..) | select(length > 0);
def paths(node_filter): . as $dot | paths | select(. as $p | $dot | getpath($p) | node_filter);
def leaf_paths: paths(scalars);
def del(f): delpaths([path(f)]);
def pick(pathexps): . as $top | reduce path(pathexps) as $p (null; setpath($p; $top | getpath($p)));
def to_array: if type == "array" then . else [.] end;
def toarray: to_array;
def abs: if type == "number" and . < 0 then -. else . end;
def add(f): reduce f as $x (null; . + $x);
def finites: select(isinfinite or isnan | not);
def normals: select(isnormal);
def scan($re; $flags): match($re; "g" + $flags) | if (.captures | length > 0) then [.captures | .[] | .string] else .string end;
def scan($re): scan($re; null);
def splits($re; flags): split($re; flags) | .[];
def splits($re): splits($re; null);
def sub(re; str): sub(re; str; "");
def gsub(re; str): sub(re; str; "g");
def gsub(re; str; flags): sub(re; str; flags + "g");
def todate: strftime("%Y-%m-%dT%H:%M:%SZ");
def todateiso8601: todate;
def fromdateiso8601: strptime("%Y-%m-%dT%H:%M:%SZ") | mktime;
def fromdate: fromdateiso8601;
def date: todate;
def dateadd(u; n): . + n;
def datesub(u; n): . - n;
def transpose: if . == [] then [] else . as $in | (map(length) | max) as $max
  | [range(0; $max) as $j | [range(0; $in | length) as $i | $in[$i][$j]]] end;
def tostream: path(def r: (.[]? | r), .; r) as $p | getpath($p) | reduce path(.[]?) as $q ([$p, .]; [$p + $q]);
def fromstream(f): { x: null, e: false } as $init
  | foreach f as $i ($init;
      if .e then $init else . end
      | if $i | length == 2
        then setpath(["e"]; $i[0] | length == 0) | setpath(["x"] + $i[0]; $i[1])
        else setpath(["e"]; $i[0] | length == 1) end;
      if .e then .x else empty end);
def truncate_stream(stream): . as $n | null | stream | . as $input
  | if (.[0] | length) > $n then setpath([0]; .[0][$n:]) else empty end;
def IN(s): any(s == .; .);
def IN(src; s): any(src == s; .);
def INDEX(stream; idx_expr): reduce stream as $row ({}; .[$row | idx_expr | tostring] |= $row);
def INDEX(idx_expr): INDEX(.[]; idx_expr);
def debug(msg): (msg | debug | empty), .;
def halt_error: halt_error(5);
def have_literal_numbers: true;
def have_decnum: false;
`;

let defs: FuncDef[] | null = null;

function preludeDefs(): FuncDef[] {
  defs ??= parseDefs(SOURCE);
  return defs;
}

export function builtinKeys(): string[] {
  return [...new Set([...natives.keys(), ...preludeDefs().map((d) => `${d.name}/${d.params.length}`)])];
}

fn('builtins', 0, () => builtinKeys());

/** Root scope: global variables ($ENV, $ARGS, --arg names), then the jq-defined builtins. */
export function rootEnv(rt: Runtime, globals: [string, Value][]): Env {
  let env: Env = { vars: null, funcs: null, rt };
  for (const [name, value] of globals) env = setVar(env, name, value);
  for (const d of preludeDefs()) env = defineFn(d, env);
  return env;
}
