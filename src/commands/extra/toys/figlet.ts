import { readAll } from '../../../shell/io.ts';
import type { CommandFn } from '../../types.ts';
import { lines } from '../../util.ts';

const FONT: Record<string, string> = {
  A: ' ### |#   #|#####|#   #|#   #',
  B: '#### |#   #|#### |#   #|#### ',
  C: ' ####|#    |#    |#    | ####',
  D: '#### |#   #|#   #|#   #|#### ',
  E: '#####|#    |#### |#    |#####',
  F: '#####|#    |#### |#    |#    ',
  G: ' ####|#    |#  ##|#   #| ####',
  H: '#   #|#   #|#####|#   #|#   #',
  I: '###| # | # | # |###',
  J: '  ###|    #|    #|#   #| ### ',
  K: '#   #|#  # |###  |#  # |#   #',
  L: '#    |#    |#    |#    |#####',
  M: '#   #|## ##|# # #|#   #|#   #',
  N: '#   #|##  #|# # #|#  ##|#   #',
  O: ' ### |#   #|#   #|#   #| ### ',
  P: '#### |#   #|#### |#    |#    ',
  Q: ' ### |#   #|# # #|#  # | ## #',
  R: '#### |#   #|#### |#  # |#   #',
  S: ' ####|#    | ### |    #|#### ',
  T: '#####|  #  |  #  |  #  |  #  ',
  U: '#   #|#   #|#   #|#   #| ### ',
  V: '#   #|#   #|#   #| # # |  #  ',
  W: '#   #|#   #|# # #|## ##|#   #',
  X: '#   #| # # |  #  | # # |#   #',
  Y: '#   #| # # |  #  |  #  |  #  ',
  Z: '#####|   # |  #  | #   |#####',
  0: ' ### |#  ##|# # #|##  #| ### ',
  1: ' # |## | # | # |###',
  2: ' ### |#   #|  ## | #   |#####',
  3: '#### |    #| ### |    #|#### ',
  4: '#   #|#   #|#####|    #|    #',
  5: '#####|#    |#### |    #|#### ',
  6: ' ### |#    |#### |#   #| ### ',
  7: '#####|    #|   # |  #  |  #  ',
  8: ' ### |#   #| ### |#   #| ### ',
  9: ' ### |#   #| ####|    #| ### ',
  ' ': '   |   |   |   |   ',
  '!': '#|#|#| |#',
  '?': '### |   #| ## |    | #  ',
  '.': ' | | | |#',
  ',': '  |  |  | #|# ',
  '-': '   |   |###|   |   ',
  ':': ' |#| |#| ',
};

const COLUMNS = 80;

function banner(text: string): string {
  const glyphs = [...text.toUpperCase()].filter((c) => c in FONT).map((c) => FONT[c].split('|'));
  const chunks: string[][][] = [[]];
  let width = 0;
  for (const g of glyphs) {
    if (width + g[0].length + 1 > COLUMNS && chunks.at(-1)!.length) {
      chunks.push([]);
      width = 0;
    }
    chunks.at(-1)!.push(g);
    width += g[0].length + 1;
  }
  return chunks
    .map((chunk) => [0, 1, 2, 3, 4].map((r) => `${chunk.map((g) => g[r]).join(' ').trimEnd()}\n`).join(''))
    .join('');
}

export const figlet: CommandFn = async (ctx) => {
  const texts = ctx.args.length ? [ctx.args.join(' ')] : lines(await readAll(ctx.stdin));
  for (const t of texts) ctx.stdout.write(banner(t));
  return 0;
};
