import type { CommandTable } from '../types.ts';
import { aptCommands } from './apt/index.ts';
import { archiveCommands } from './archive/index.ts';
import { netCommands } from './net/index.ts';
import { toyCommands } from './toys/index.ts';

export const extraCommands: CommandTable = {
  ...aptCommands,
  ...toyCommands,
  ...netCommands,
  ...archiveCommands,
};
