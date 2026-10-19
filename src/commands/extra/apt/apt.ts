import { DISCARD } from '../../../shell/io.ts';
import type { CommandFn } from '../../types.ts';
import { ARCHIVE } from './catalog.ts';
import { install, remove } from './install.ts';
import { list, policy, search, show } from './query.ts';
import { READING, dirLockDenied, frontendLockDenied, summary, type AptRun } from './run.ts';
import { APT_VERSION, usage } from './usage.ts';

type Flag = 'yes' | 'purge' | 'installed' | 'upgradable' | 'quiet' | 'help' | 'version';

const LONG: Record<string, Flag | null> = {
  yes: 'yes', 'assume-yes': 'yes', purge: 'purge', installed: 'installed', upgradable: 'upgradable',
  quiet: 'quiet', help: 'help', version: 'version',
  'no-install-recommends': null, 'install-recommends': null, 'fix-broken': null, 'fix-missing': null,
};
const SHORT: Record<string, Flag | null> = { y: 'yes', q: 'quiet', h: 'help', v: 'version', f: null, m: null };

const OPS: Record<string, string[]> = {
  apt: ['list', 'search', 'show', 'policy', 'install', 'remove', 'purge', 'autoremove', 'update', 'upgrade', 'full-upgrade', 'clean', 'autoclean'],
  'apt-get': ['install', 'remove', 'purge', 'autoremove', 'update', 'upgrade', 'dist-upgrade', 'full-upgrade', 'clean', 'autoclean'],
};
const NEEDS_ROOT = new Set(['install', 'remove', 'purge', 'autoremove', 'upgrade', 'full-upgrade', 'dist-upgrade']);

const WARNING = '\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n';

function parseOptions(args: string[]) {
  const flags = new Set<Flag>();
  const operands: string[] = [];
  let quiet = 0;
  for (const arg of args) {
    const names = arg.startsWith('--') ? [arg.slice(2)] : arg.startsWith('-') && arg.length > 1 ? [...arg.slice(1)] : null;
    if (!names) {
      operands.push(arg);
      continue;
    }
    for (const name of names) {
      const table = arg.startsWith('--') ? LONG : SHORT;
      if (!(name in table)) return { error: `E: Command line option '${name}' [from ${arg}] is not understood in combination with the other options.\n` };
      const flag = table[name];
      if (flag === 'quiet') quiet++;
      if (flag) flags.add(flag);
    }
  }
  return { flags, operands, quiet };
}

export function aptMain(tool: 'apt' | 'apt-get'): CommandFn {
  return async (ctx) => {
    const parsed = parseOptions(ctx.args);
    if (parsed.error !== undefined) {
      ctx.stderr.write(parsed.error);
      return 100;
    }
    const { flags, operands, quiet } = parsed;
    if (flags.has('version')) {
      ctx.stdout.write(`${APT_VERSION}\n`);
      return 0;
    }
    const [op, ...names] = operands;
    if (flags.has('help') || !op) {
      ctx.stdout.write(usage(tool));
      return flags.has('help') ? 0 : 1;
    }
    if (!OPS[tool].includes(op)) {
      ctx.stderr.write(`E: Invalid operation ${op}\n`);
      return 100;
    }
    if (tool === 'apt' && !ctx.stdout.isTTY) ctx.stderr.write(WARNING);
    const root = ctx.vfs.cred.uid === 0;
    if (NEEDS_ROOT.has(op) && !root) return frontendLockDenied(ctx);
    const a: AptRun = {
      ctx,
      tool,
      out: quiet > 1 ? DISCARD : ctx.stdout,
      yes: flags.has('yes'),
      purge: flags.has('purge') || op === 'purge',
      installed: flags.has('installed'),
      upgradable: flags.has('upgradable'),
    };
    switch (op) {
      case 'list':
        return list(a, names);
      case 'search':
        return search(a, names);
      case 'show':
        return show(a, names);
      case 'policy':
        return policy(ctx, a.out, names);
      case 'install':
        return install(a, names);
      case 'remove':
      case 'purge':
        return remove(a, names);
      case 'update':
        return update(a, root);
      case 'clean':
      case 'autoclean':
        if (!root) return dirLockDenied(ctx, '/var/cache/apt/archives/');
        if (op === 'autoclean') a.out.write(READING);
        return 0;
      default:
        a.out.write(`${READING}${op === 'autoremove' ? '' : 'Calculating upgrade... Done\n'}${summary()}`);
        return 0;
    }
  };
}

function update(a: AptRun, root: boolean): number {
  if (!root) {
    a.out.write('Reading package lists... Done\n');
    return dirLockDenied(a.ctx, '/var/lib/apt/lists/');
  }
  a.out.write(
    `Hit:1 ${ARCHIVE} noble InRelease\n` +
      `Get:2 ${ARCHIVE} noble-updates InRelease [126 kB]\n` +
      `Get:3 ${ARCHIVE} noble-backports InRelease [126 kB]\n` +
      'Get:4 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\n' +
      'Fetched 378 kB in 1s (312 kB/s)\n',
  );
  a.out.write(a.tool === 'apt' ? `${READING}All packages are up to date.\n` : 'Reading package lists... Done\n');
  return 0;
}
