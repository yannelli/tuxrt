import type { CommandTable } from '../types.ts';
import { aptCommands } from './apt/index.ts';
import { archiveCommands } from './archive/index.ts';
import { netCommands } from './net/index.ts';
import { nodeCommands } from './node/index.ts';
import { toyCommands } from './toys/index.ts';

export const extraCommands: CommandTable = {
  ...nodeCommands,
  ...aptCommands,
  ...toyCommands,
  ...netCommands,
  ...archiveCommands,
};
