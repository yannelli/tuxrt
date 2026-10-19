import type { CommandTable } from '../../types.ts';
import { aptMain } from './apt.ts';
import { aptCache } from './cache.ts';
import { dpkg } from './dpkg.ts';

export const aptCommands: CommandTable = {
  apt: { desc: 'command-line interface', fn: aptMain('apt') },
  'apt-get': { desc: 'low-level Debian package tool', fn: aptMain('apt-get') },
  'apt-cache': { desc: 'query the APT cache', fn: aptCache },
  dpkg: { desc: 'package manager for Debian', fn: dpkg },
};
