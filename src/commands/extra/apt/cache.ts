import type { CommandFn } from '../../types.ts';
import { CATALOG, MAINTAINER, component } from './catalog.ts';
import { matches, notFound, policy } from './query.ts';
import { usage } from './usage.ts';

export const aptCache: CommandFn = (ctx) => {
  const [op, ...names] = ctx.args.filter((a) => !a.startsWith('-'));
  switch (op) {
    case undefined:
      ctx.stdout.write(usage('apt-cache'));
      return 1;
    case 'policy':
      return policy(ctx, ctx.stdout, names);
    case 'search':
      if (!names.length) {
        ctx.stderr.write('E: You must give at least one search pattern\n');
        return 100;
      }
      for (const p of matches(names)) ctx.stdout.write(`${p.name} - ${p.desc}\n`);
      return 0;
    case 'show': {
      const missing = names.filter((n) => !CATALOG.has(n));
      if (!names.length || missing.length) return notFound(ctx, missing);
      for (const p of names.map((n) => CATALOG.get(n)!)) {
        const pool = `pool/${component(p)}/${p.name.startsWith('lib') ? p.name.slice(0, 4) : p.name[0]}/${p.name}`;
        const file = `${p.name}_${p.version.replace(/^\d+:/, '')}_${p.arch}.deb`;
        ctx.stdout.write(
          `Package: ${p.name}\nArchitecture: ${p.arch}\nVersion: ${p.version}\nPriority: ${p.priority}\n` +
            `Section: ${p.section}\nOrigin: Ubuntu\nMaintainer: ${MAINTAINER}\nInstalled-Size: ${p.isize}\n` +
            `Filename: ${pool}/${file}\nSize: ${p.size}\nDescription: ${p.desc}\n\n`,
        );
      }
      return 0;
    }
  }
  ctx.stderr.write(`E: Invalid operation ${op}\n`);
  return 100;
};
