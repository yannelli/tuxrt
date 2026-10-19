import type { CommandFn } from '../../types.ts';

const SMOKE = [
  '                          (  )   (   )  ( )   ()    o    .',
  '                     (    )',
  '                 (  )',
  '              ( )',
  '',
];

const ENGINE = String.raw`         __
        |  |      _______________
    ____|  |_____|  _   _   _    |
   |  _          | |_| |_| |_|   |
   | |_|   ______|               |
   |      |      |_______________|
  _|______|______|_______________|__
 |  ___     ___     ___     ___     |>
 |_/ o \___/ o \___/ o \___/ o \____|
   \___/   \___/   \___/   \___/`.split('\n');

const COAL = String.raw`



   ______________________
  |                      |
  |______________________|
 _|______________________|_
|__________________________|
   (_)  (_)      (_)  (_)`.split('\n');

export const sl: CommandFn = (ctx) => {
  const width = Math.max(...ENGINE.map((row) => row.length));
  const train = ENGINE.map((row, i) => `${row.padEnd(width + 1)}${COAL[i]}`.trimEnd());
  ctx.stdout.write(`${[...SMOKE, ...train].join('\n')}\n`);
  return 0;
};
