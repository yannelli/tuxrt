import type { CommandFn } from '../../types.ts';
import { listPath } from '../apt/db.ts';

/** Every toy has a boot-time /usr/bin stub, so the dpkg file list is what marks it installed. */
export function gated(pkg: string, fn: CommandFn): CommandFn {
  return (ctx) => {
    if (ctx.vfs.exists(listPath(pkg))) return fn(ctx);
    const name = ctx.name.slice(ctx.name.lastIndexOf('/') + 1);
    ctx.stderr.write(`Command '${name}' not found, but can be installed with:\n\nsudo apt install ${pkg}\n`);
    return 127;
  };
}
