import type { CommandFn, Ctx } from '../../types.ts';
import { globRegex } from './catalog.ts';
import { formatPara, loadDb, packageFiles, type Para } from './db.ts';

const HEADER = `Desired=Unknown/Install/Remove/Purge/Hold
| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend
|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)
`;

/** Installed paragraphs matching any glob (all when none), plus the patterns that matched nothing. */
function select(ctx: Ctx, patterns: string[]): { paras: Para[]; unmatched: string[] } {
  const db = loadDb(ctx.vfs);
  const all = [...db.keys()].sort().map((n) => db.get(n)!);
  if (!patterns.length) return { paras: all, unmatched: [] };
  const res = patterns.map(globRegex);
  return {
    paras: all.filter((p) => res.some((re) => re.test(p.Package))),
    unmatched: patterns.filter((_, i) => !all.some((p) => res[i].test(p.Package))),
  };
}

function list(ctx: Ctx, patterns: string[]): number {
  const { paras, unmatched } = select(ctx, patterns);
  if (paras.length) {
    const rows = paras.map((p) => [p.Package, p.Version, p.Architecture, (p.Description ?? '').split('\n')[0]]);
    const width = (i: number, min: number) => Math.max(min, ...rows.map((r) => r[i].length));
    const [name, ver, arch, desc] = [width(0, 4), width(1, 7), width(2, 12), width(3, 11)];
    const line = (r: string[]) => `${r[0].padEnd(name)} ${r[1].padEnd(ver)} ${r[2].padEnd(arch)} ${r[3]}`;
    ctx.stdout.write(`${HEADER}||/ ${line(['Name', 'Version', 'Architecture', 'Description'])}\n`);
    ctx.stdout.write(`+++-${'='.repeat(name)}-${'='.repeat(ver)}-${'='.repeat(arch)}-${'='.repeat(desc)}\n`);
    for (const r of rows) ctx.stdout.write(`ii  ${line(r)}\n`);
  }
  for (const p of unmatched) ctx.stderr.write(`dpkg-query: no packages found matching ${p}\n`);
  return unmatched.length ? 1 : 0;
}

function needsName(ctx: Ctx, option: string): number {
  ctx.stderr.write(`dpkg-query: error: --${option} needs at least one package name argument\n\nUse --help for help about querying packages.\n`);
  return 2;
}

function listFiles(ctx: Ctx, names: string[]): number {
  if (!names.length) return needsName(ctx, 'listfiles');
  const db = loadDb(ctx.vfs);
  const missing = names.filter((n) => !db.has(n));
  for (const n of names.filter((n) => db.has(n))) ctx.stdout.write(`${packageFiles(ctx, n).join('\n')}\n`);
  if (!missing.length) return 0;
  for (const n of missing) ctx.stderr.write(`dpkg-query: package '${n}' is not installed\n`);
  ctx.stderr.write('Use dpkg --contents (= dpkg-deb --contents) to list archive files contents.\n');
  return 1;
}

function status(ctx: Ctx, names: string[]): number {
  if (!names.length) return needsName(ctx, 'status');
  const db = loadDb(ctx.vfs);
  const found = names.filter((n) => db.has(n));
  ctx.stdout.write(found.map((n) => formatPara(db.get(n)!)).join('\n'));
  if (found.length === names.length) return 0;
  for (const n of names.filter((n) => !db.has(n))) {
    ctx.stderr.write(`dpkg-query: package '${n}' is not installed and no information is available\n`);
  }
  ctx.stderr.write('Use dpkg --info (= dpkg-deb --info) to examine archive files.\n');
  return 1;
}

function selections(ctx: Ctx, patterns: string[]): number {
  for (const { Package: name } of select(ctx, patterns).paras) {
    ctx.stdout.write(`${name}${'\t'.repeat(Math.max(1, 6 - (name.length >> 3)))}install\n`);
  }
  return 0;
}

export const dpkg: CommandFn = (ctx) => {
  const [action, ...rest] = ctx.args;
  switch (action) {
    case '-l':
    case '--list':
      return list(ctx, rest);
    case '-L':
    case '--listfiles':
      return listFiles(ctx, rest);
    case '-s':
    case '--status':
      return status(ctx, rest);
    case '--get-selections':
      return selections(ctx, rest);
    case '--print-architecture':
      ctx.stdout.write('amd64\n');
      return 0;
    case '--version':
      ctx.stdout.write("Debian 'dpkg' package management program version 1.22.6 (amd64).\n");
      return 0;
  }
  const what = action === undefined ? 'need an action option' : `unknown option ${action}`;
  ctx.stderr.write(`dpkg: error: ${what}\n\nType dpkg --help for help about installing and deinstalling packages [*];\nUse 'apt' or 'aptitude' for user-friendly package management;\n`);
  return 2;
};
