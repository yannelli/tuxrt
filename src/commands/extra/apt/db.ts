import { installStubs } from '../../../vfs/bootstrap.ts';
import type { VFS } from '../../../vfs/vfs.ts';
import type { Ctx } from '../../types.ts';
import { BASE, CATALOG, ESSENTIAL, MAINTAINER, type Pkg } from './catalog.ts';

export type Para = Record<string, string>;
export type Db = Map<string, Para>;

const STATUS = '/var/lib/dpkg/status';
const INFO = '/var/lib/dpkg/info';

export const listPath = (name: string) => `${INFO}/${name}.list`;

export function paragraph(p: Pkg): Para {
  return {
    Package: p.name,
    Status: 'install ok installed',
    ...(ESSENTIAL.has(p.name) ? { Essential: 'yes' } : {}),
    Priority: p.priority,
    Section: p.section,
    'Installed-Size': String(p.isize),
    Maintainer: MAINTAINER,
    Architecture: p.arch,
    Version: p.version,
    Description: p.desc,
  };
}

export function parseParas(text: string): Para[] {
  const out: Para[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const para: Para = {};
    let last = '';
    for (const line of block.split('\n')) {
      if (/^\s/.test(line) && last) para[last] += `\n${line}`;
      else if (line.includes(':')) {
        last = line.slice(0, line.indexOf(':'));
        para[last] = line.slice(last.length + 1).trim();
      }
    }
    if (para.Package) out.push(para);
  }
  return out;
}

export function formatPara(para: Para): string {
  return Object.entries(para).map(([k, v]) => `${k}: ${v}\n`).join('');
}

/** Installed packages. A pristine machine has no status file yet, so the base set stands in for it. */
export function loadDb(vfs: VFS): Db {
  const text = vfs.exists(STATUS) ? vfs.readFile(STATUS) : null;
  const paras = text === null ? BASE.map((n) => paragraph(CATALOG.get(n)!)) : parseParas(text);
  return new Map(paras.map((p) => [p.Package, p]));
}

export function saveDb(vfs: VFS, db: Db): void {
  vfs.mkdir(INFO, true);
  const names = [...db.keys()].sort();
  vfs.writeFile(STATUS, names.map((n) => `${formatPara(db.get(n)!)}\n`).join(''));
}

/** Database size shown by dpkg's "(Reading database ...)" line. */
export function fileCount(db: Db): number {
  return 74_000 + db.size * 47;
}

export function providedBins(ctx: Ctx, p: Pkg | undefined): string[] {
  return (p?.bins ?? []).filter((b) => ctx.shell.kernel.commands.has(b));
}

/** dpkg -L order: "/." then every path with its parent directories, sorted. */
export function fileList(name: string, bins: string[], doc: boolean): string[] {
  const paths = new Set(['/.']);
  const files = bins.map((b) => `/usr/bin/${b}`);
  if (doc) files.push(`/usr/share/doc/${name}/copyright`);
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 2; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  return [...paths].sort();
}

export function packageFiles(ctx: Ctx, name: string): string[] {
  const list = listPath(name);
  if (ctx.vfs.exists(list)) return ctx.vfs.readFile(list).split('\n').filter(Boolean);
  return fileList(name, providedBins(ctx, CATALOG.get(name)), false);
}

export function unpack(ctx: Ctx, p: Pkg): void {
  const bins = providedBins(ctx, p);
  installStubs(ctx.vfs, bins);
  const doc = `/usr/share/doc/${p.name}`;
  ctx.vfs.mkdir(doc, true);
  ctx.vfs.writeFile(`${doc}/copyright`, `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: ${p.name}\n`);
  ctx.vfs.mkdir(INFO, true);
  ctx.vfs.writeFile(listPath(p.name), `${fileList(p.name, bins, true).join('\n')}\n`);
}

export function purgeFiles(ctx: Ctx, name: string): void {
  const { vfs } = ctx;
  for (const path of packageFiles(ctx, name)) {
    const node = vfs.tryLookup(path, false);
    if (node && node.kind !== 'dir') vfs.unlink(path);
  }
  const doc = `/usr/share/doc/${name}`;
  if (vfs.isDir(doc) && !vfs.readdir(doc).length) vfs.rmdir(doc);
  if (vfs.exists(listPath(name))) vfs.unlink(listPath(name));
}
