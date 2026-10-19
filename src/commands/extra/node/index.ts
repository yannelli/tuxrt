import type { CommandTable } from '../../types.ts';
import { command } from '../../util.ts';
import { nodeMain } from './cli.ts';

export const nodeCommands: CommandTable = {
  node: { desc: 'server-side JavaScript runtime', fn: command(nodeMain) },
  nodejs: { desc: 'server-side JavaScript runtime', fn: command(nodeMain) },
};
