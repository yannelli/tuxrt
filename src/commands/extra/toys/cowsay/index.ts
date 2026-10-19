import { readAll } from '../../../../shell/io.ts';
import type { CommandFn, Ctx } from '../../../types.ts';
import { lines } from '../../../util.ts';
import { balloon, expandTabs, wrap } from './bubble.ts';
import { COWPATH, cowNames, findCow, renderCow, type Face } from './cows.ts';

const VALUED = 'efTW';
const FLAGS = 'bdghlnpstwy';

/** Eye and tongue presets in cowsay's precedence order: a later flag overrides an earlier one. */
const MODES: [string, string, string?][] = [
  ['b', '=='], ['d', 'xx', 'U '], ['g', '$$'], ['p', '@@'], ['s', '**', 'U '], ['t', '--'], ['w', 'OO'], ['y', '..'],
];

/** Perl's Getopt::Std: options stop at the first non-option and unknown letters only warn. */
function getopts(ctx: Ctx, args: string[]): { opts: Record<string, string>; words: string[] } {
  const opts: Record<string, string> = {};
  let i = 0;
  for (; i < args.length && /^-./s.test(args[i]); i++) {
    const arg = args[i];
    if (arg === '--') {
      i++;
      break;
    }
    for (let j = 1; j < arg.length; j++) {
      const c = arg[j];
      if (VALUED.includes(c)) {
        opts[c] = j + 1 < arg.length ? arg.slice(j + 1) : (args[++i] ?? '');
        break;
      }
      if (FLAGS.includes(c)) opts[c] = '1';
      else ctx.stderr.write(`Unknown option: ${c}\n`);
    }
  }
  return { opts, words: args.slice(i) };
}

function face(opts: Record<string, string>, think: boolean): Face {
  let eyes = (opts.e ?? 'oo').slice(0, 2);
  let tongue = (opts.T ?? '  ').slice(0, 2);
  for (const [flag, e, t] of MODES) {
    if (!opts[flag]) continue;
    eyes = e;
    tongue = t ?? tongue;
  }
  return { thoughts: think ? 'o' : '\\', eyes, tongue };
}

/** Serves both cowsay and cowthink: like the Perl original, the program name picks the balloon style. */
export const cowsay: CommandFn = async (ctx) => {
  const prog = ctx.name.slice(ctx.name.lastIndexOf('/') + 1);
  const { opts, words } = getopts(ctx, ctx.args);
  if (opts.h) {
    ctx.stderr.write(
      `cow{say,think} version 3.03, (c) 1999 Tony Monroe\nUsage: ${prog} [-bdgpstwy] [-h] [-e eyes] [-f cowfile]\n` +
        '          [-l] [-n] [-T tongue] [-W wrapcolumn] [message]\n',
    );
    return 1;
  }
  if (opts.l) {
    ctx.stdout.write(`Cow files in ${COWPATH}:\n${wrap(cowNames().join(' '), 76).join('\n')}\n`);
    return 0;
  }
  const cow = findCow(opts.f ?? 'default');
  if (cow === undefined) {
    ctx.stderr.write(`${prog}: Could not find ${opts.f} cowfile!\n`);
    return 1;
  }
  const columns = Math.max(2, Number.parseInt(opts.W ?? '40', 10) || 0);
  const input = lines(words.length ? words.join(' ') : await readAll(ctx.stdin));
  const msg = opts.n ? input.map(expandTabs) : input.flatMap((l) => wrap(l, columns));
  const think = /think/i.test(prog);
  ctx.stdout.write(balloon(msg.length ? msg : [''], think) + renderCow(cow, face(opts, think)));
  return 0;
};
