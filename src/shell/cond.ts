import { evalTest, TestError, type TestToken } from '../commands/builtins/test.ts';
import type { CondWord } from './ast.ts';
import { expandPattern, expandWord } from './expand.ts';
import type { IO } from './io.ts';
import type { Shell } from './shell.ts';

/** [[ ... ]]: no word splitting or globbing; == / != match glob patterns; =~ matches regexes. */
export async function execCond(words: CondWord[], shell: Shell, io: IO): Promise<number> {
  const tokens: TestToken[] = [];
  for (const w of words) {
    const prev = tokens.at(-1);
    if (w.op) tokens.push({ s: w.raw, op: true });
    else if (prev?.op && ['==', '=', '!='].includes(prev.s)) tokens.push({ s: await expandPattern(w.raw, shell), op: false, pattern: true });
    else {
      const s = await expandWord(w.raw, shell);
      tokens.push({ s, op: /^-[a-zA-Z]{1,2}$/.test(w.raw) });
    }
  }
  try {
    return evalTest(tokens, shell, true) ? 0 : 1;
  } catch (e) {
    if (!(e instanceof TestError)) throw e;
    io.stderr.write(`${shell.argv0}: ${e.message}\n`);
    return 2;
  }
}
