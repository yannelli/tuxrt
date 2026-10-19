import { fn } from './define.ts';
import { describe, tojson } from './dump.ts';
import { indexValue } from './paths.ts';
import { isObj, JqError, truthy, type Value } from './value.ts';

const ALIASES = ['k', 'name', 'Name', 'K'];

fn('to_entries', 0, (v) => {
  const pairs: [Value, Value][] = isObj(v) ? [...v] : Array.isArray(v) ? v.map((x, i) => [i, x]) : [];
  if (!isObj(v) && !Array.isArray(v)) throw new JqError(`${describe(v)} has no keys`);
  return pairs.map(([key, value]) => new Map([['key', key], ['value', value]]));
});

/** Native for speed; same key fallbacks as jq's `.key // .k // .name // .Name // .K // .Key`. */
fn('from_entries', 0, (v) => {
  if (!Array.isArray(v) && !isObj(v)) throw new JqError(`Cannot iterate over ${v === null ? 'null' : describe(v)}`);
  const out = new Map<string, Value>();
  for (const x of Array.isArray(v) ? v : v.values()) {
    let key = indexValue(x, 'key');
    if (key === null) key = ALIASES.map((a) => indexValue(x, a)).find(truthy) ?? indexValue(x, 'Key');
    if (!isObj(x)) throw new JqError(`Cannot check whether ${Array.isArray(x) ? 'array' : 'null'} has a string key`);
    out.set(typeof key === 'string' ? key : tojson(key), x.has('value') ? x.get('value')! : (x.get('v') ?? null));
  }
  return out;
});
