import { parseJson } from './json.ts';
import { isObj, type Value } from './value.ts';

export interface Source {
  name: string;
  text: string;
}

/** jq reads input a line at a time, so "(at <stdin>:N)" counts lines through the one where a value ended. */
function lineCounter(text: string): (end: number) => number {
  let pos = 0;
  let count = 0;
  return (end) => {
    const nl = text.indexOf('\n', Math.max(end - 1, pos));
    const target = nl === -1 ? text.length : nl + 1;
    for (; pos < target; pos++) if (text.charCodeAt(pos) === 10) count++;
    return count;
  };
}

/** --stream events: [path, leaf] for each leaf, then [path] when a non-empty container closes. */
function* events(v: Value, path: Value[]): Generator<Value> {
  const kids: [Value, Value][] | null = Array.isArray(v) ? v.map((x, i) => [i, x]) : isObj(v) ? [...v] : null;
  if (!kids?.length) {
    yield [path, v];
    return;
  }
  for (const [k, x] of kids) yield* events(x, [...path, k]);
  yield [[...path, kids[kids.length - 1][0]]];
}

/** The input stream shared by the main loop and the `input`/`inputs` builtins. */
export class Inputs {
  loc = '<unknown>';
  filename: Value = null;
  private readonly iter: Generator<Value>;
  private readonly stream: boolean;

  constructor(sources: Source[], raw: boolean, slurp: boolean, stream = false) {
    this.stream = stream;
    this.iter = slurp ? this.slurped(sources, raw) : this.each(sources, raw);
  }

  next(): Value | undefined {
    const r = this.iter.next();
    return r.done ? undefined : r.value;
  }

  private *values(src: Source, raw: boolean): Generator<Value> {
    const name = src.name === '-' ? '<stdin>' : src.name;
    this.filename = src.name === '-' ? null : src.name;
    if (raw) {
      const lines = src.text.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      for (let i = 0; i < lines.length; i++) {
        this.loc = `${name}:${i + 1}`;
        yield lines[i];
      }
      return;
    }
    const line = lineCounter(src.text);
    for (const { value, end } of parseJson(src.text)) {
      this.loc = `${name}:${line(end)}`;
      if (this.stream) yield* events(value, []);
      else yield value;
    }
  }

  private *each(sources: Source[], raw: boolean): Generator<Value> {
    for (const src of sources) yield* this.values(src, raw);
  }

  private *slurped(sources: Source[], raw: boolean): Generator<Value> {
    if (raw) {
      yield sources.map((s) => s.text).join('');
      return;
    }
    const all: Value[] = [];
    for (const src of sources) all.push(...this.values(src, false));
    yield all;
  }
}
