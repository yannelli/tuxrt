import type { CommandTable } from '../../types.ts';
import { curl } from './curl.ts';
import { wget } from './wget.ts';

export const netCommands: CommandTable = {
  curl: { desc: 'transfer a URL', fn: curl },
  wget: { desc: 'The non-interactive network downloader.', fn: wget },
};
