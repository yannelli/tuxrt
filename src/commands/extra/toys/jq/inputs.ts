import { ParseError, parseJson } from './json.ts';
import { isObj, type Value } from './value.ts';

/** A whole file, or stdin pulled chunk by chunk (`read` returns null at end of input, undefined when nothing is buffered yet). */
export type Source = { name: string; text: string } | { name: string; read: () => string | null | undefined };

/** Returned by Inputs.next when stdin has nothing buffered; the caller refills it and asks again. */
export const PENDING = Symbol('pending');
type Read = () => string | null | undefined;

/** Stdin ran past what a single-threaded host buffers before `input`, `inputs` or --slurp start reading it. */
export class UnbufferedInput extends Error {
  constructor() {
    super('stdin is larger than this platform can buffer for input, inputs or --slurp');
  }
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
  line = 0;
  filename: Value = null;
  private readonly iter: Generator<Value | typeof PENDING>;
  private readonly stream: boolean;

  constructor(sources: Source[], raw: boolean, slurp: boolean, stream = false) {
    this.stream = stream;
    this.iter = slurp ? this.slurped(sources, raw) : this.each(sources, raw);
  }

  next(): Value | undefined | typeof PENDING {
    const r = this.iter.next();
    return r.done ? undefined : r.value;
  }

  private *values(src: Source, raw: boolean): Generator<Value | typeof PENDING> {
    const name = src.name === '-' ? '<stdin>' : src.name;
    this.filename = src.name === '-' ? null : src.name;
    if (!('text' in src)) return yield* raw ? this.streamLines(src.read, name) : this.streamJson(src.read, name);
    if (raw) {
      const lines = src.text.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      for (let i = 0; i < lines.length; i++) {
        this.line = i + 1;
        this.loc = `${name}:${i + 1}`;
        yield lines[i];
      }
      return;
    }
    const line = lineCounter(src.text);
    for (const { value, end } of parseJson(src.text)) {
      this.line = line(end);
      this.loc = `${name}:${this.line}`;
      if (this.stream) yield* events(value, []);
      else yield value;
    }
  }

  private *streamLines(read: Read, name: string): Generator<Value | typeof PENDING> {
    let buf = '';
    for (let chunk = read(); ; chunk = read()) {
      if (chunk === undefined) {
        yield PENDING;
        continue;
      }
      if (chunk !== null) buf += chunk;
      for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
        this.loc = `${name}:${++this.line}`;
        yield buf.slice(0, nl);
        buf = buf.slice(nl + 1);
      }
      if (chunk !== null) continue;
      if (buf) {
        this.loc = `${name}:${++this.line}`;
        yield buf;
      }
      return;
    }
  }

  /** Like jq's line-buffered reader: only complete lines are parsed, so values appear as soon as their line ends. */
  private *streamJson(read: Read, name: string): Generator<Value | typeof PENDING> {
    let buf = '';
    let eof = false;
    let lines = 0;
    let want = 1;
    for (;;) {
      while (!eof && buf.length < want) {
        const chunk = read();
        if (chunk === undefined) yield PENDING;
        else if (chunk === null) eof = true;
        else buf += chunk;
      }
      const cut = eof ? buf.length : buf.lastIndexOf('\n') + 1;
      const window = buf.slice(0, cut);
      let used = 0;
      try {
        for (const { value, end } of parseJson(window)) {
          this.line = lines + count(window, 0, end) + (window.indexOf('\n', end) !== -1 ? 1 : 0);
          this.loc = `${name}:${this.line}`;
          used = end;
          if (this.stream) yield* events(value, []);
          else yield value;
        }
        used = cut;
      } catch (e) {
        if (!(e instanceof ParseError) || eof || !e.message.includes('at EOF')) throw e;
      }
      lines += count(buf, 0, used);
      buf = buf.slice(used);
      if (eof) return;
      want = buf.length + 1;
    }
  }

  private *each(sources: Source[], raw: boolean): Generator<Value | typeof PENDING> {
    for (const src of sources) yield* this.values(src, raw);
  }

  private *slurped(sources: Source[], raw: boolean): Generator<Value | typeof PENDING> {
    if (raw) {
      yield sources.map((s) => ('text' in s ? s.text : drain(s.read))).join('');
      return;
    }
    const all: Value[] = [];
    for (const src of sources) {
      for (const v of this.values(src, false)) {
        if (v === PENDING) throw new UnbufferedInput();
        all.push(v);
      }
    }
    yield all;
  }
}

function count(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

function drain(read: Read): string {
  let out = '';
  for (let chunk = read(); chunk !== null; chunk = read()) {
    if (chunk === undefined) throw new UnbufferedInput();
    out += chunk;
  }
  return out;
}
