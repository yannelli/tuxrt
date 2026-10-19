import type { CommandTable } from '../types.ts';
import { basicCommands } from './basic.ts';
import { cmpCommands } from './cmp.ts';
import { cutCommands } from './cut.ts';
import { diffCommands } from './diff.ts';
import { dumpCommands } from './dump.ts';
import { grepCommands } from './grep/index.ts';
import { headTailCommands } from './headtail.ts';
import { layoutCommands } from './layout.ts';
import { sedCommands } from './sed/index.ts';
import { seqCommands } from './seq.ts';
import { sortCommands } from './sort.ts';
import { trCommands } from './tr.ts';
import { uniqCommands } from './uniq.ts';
import { wcCommands } from './wc.ts';
import { wrapCommands } from './wrap.ts';

export const textCommands: CommandTable = {
  ...basicCommands, ...headTailCommands, ...wcCommands, ...sortCommands, ...uniqCommands, ...cutCommands, ...trCommands,
  ...layoutCommands, ...wrapCommands, ...seqCommands, ...diffCommands, ...cmpCommands, ...dumpCommands, ...grepCommands,
  ...sedCommands,
};
