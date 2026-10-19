import type { Page } from '../types.ts';
import { adminPages } from './admin.ts';
import { admin2Pages } from './admin2.ts';
import { archivePages } from './archive.ts';
import { attrPages } from './attrs.ts';
import { awkPages } from './awk.ts';
import { bashPages } from './bash.ts';
import { builtinPages } from './builtins.ts';
import { diffPages } from './diff.ts';
import { diskPages } from './disk.ts';
import { filePages } from './files.ts';
import { findPages } from './find.ts';
import { formatPages } from './formats.ts';
import { grepPages } from './grep.ts';
import { inspectPages } from './inspect.ts';
import { manualPages } from './manual.ts';
import { miscPages } from './misc.ts';
import { netPages } from './net.ts';
import { net2Pages } from './net2.ts';
import { packagePages } from './packages.ts';
import { procPages } from './procs.ts';
import { sedPages } from './sed.ts';
import { shellUtilPages } from './shellutils.ts';
import { systemPages } from './system.ts';
import { textPages } from './text.ts';
import { text2Pages } from './text2.ts';
import { toolPages } from './tools.ts';

export const allPages: Page[] = [
  ...filePages, ...attrPages, ...diskPages, ...inspectPages, ...findPages, ...textPages, ...text2Pages, ...grepPages,
  ...sedPages, ...awkPages, ...diffPages, ...shellUtilPages, ...systemPages, ...procPages, ...adminPages, ...admin2Pages, ...manualPages,
  ...packagePages, ...archivePages, ...netPages, ...net2Pages, ...toolPages, ...bashPages, ...builtinPages, ...formatPages,
  ...miscPages,
];
