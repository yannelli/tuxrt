import type { CommandTable } from '../../types.ts';
import { gzipCommand } from './gzip.ts';
import { tarCommand } from './tar/index.ts';
import { unzipCommand } from './zip/unzip.ts';
import { zipCommand } from './zip/zip.ts';

export const archiveCommands: CommandTable = {
  gzip: { fn: gzipCommand('gzip'), desc: 'compress or expand files' },
  gunzip: { fn: gzipCommand('gunzip'), desc: 'compress or expand files' },
  zcat: { fn: gzipCommand('zcat'), desc: 'compress or expand files' },
  tar: { fn: tarCommand, desc: 'an archiving utility' },
  zip: { fn: zipCommand, desc: 'package and compress (archive) files' },
  unzip: { fn: unzipCommand, desc: 'list, test and extract compressed files in a ZIP archive' },
};
