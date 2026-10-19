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
  figlet: { desc: 'render text as big ASCII letters', fn: gated('figlet', figlet) },
  sl: { desc: 'a train for people who mistype ls', fn: gated('sl', sl) },
  neofetch: { desc: 'Show system info beside a distro logo', fn: gated('neofetch', neofetch) },
  jq: { desc: 'Command-line JSON processor', fn: jq },
};
