import type { CommandTable } from '../../types.ts';
import { cowsay } from './cowsay/index.ts';
import { figlet } from './figlet.ts';
import { gated } from './gated.ts';
import { jq } from './jq/index.ts';
import { neofetch } from './neofetch.ts';
import { sl } from './sl.ts';

export const toyCommands: CommandTable = {
  cowsay: { desc: 'configurable talking cow', fn: cowsay },
  cowthink: { desc: 'configurable thinking cow', fn: cowsay },
  figlet: { desc: 'display large characters made up of ordinary screen characters', fn: gated('figlet', figlet) },
  sl: { desc: 'display animations aimed to correct users who accidentally enter sl instead of ls', fn: gated('sl', sl) },
  neofetch: { desc: 'A fast, highly customizable system info script', fn: gated('neofetch', neofetch) },
  jq: { desc: 'Command-line JSON processor', fn: jq },
};
