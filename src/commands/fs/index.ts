import type { CommandTable } from '../types.ts';
import { copyCommands } from './copy.ts';
import { dirCommands } from './dirs.ts';
import { fileCommands } from './file.ts';
import { findCommands } from './find/index.ts';
import { linkCommands } from './link.ts';
import { lsCommands } from './ls.ts';
import { moveCommands } from './move.ts';
import { nameCommands } from './names.ts';
import { permCommands } from './perms.ts';
import { rmCommands } from './rm.ts';
import { statCommands } from './stat.ts';
import { touchCommands } from './touch.ts';
import { treeCommands } from './tree.ts';
import { usageCommands } from './usage.ts';

export const fsCommands: CommandTable = {
  ...lsCommands, ...dirCommands, ...rmCommands, ...touchCommands, ...copyCommands, ...moveCommands,
  ...linkCommands, ...permCommands, ...statCommands, ...nameCommands, ...usageCommands, ...treeCommands,
  ...fileCommands, ...findCommands,
};
