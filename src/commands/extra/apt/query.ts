import type { Ctx } from '../../types.ts';
import { ARCHIVE, CATALOG, MAINTAINER, component, globRegex, sizeToStr, suite, type Pkg } from './catalog.ts';
import { loadDb, type Db } from './db.ts';
import type { AptRun } from './run.ts';

const sorted = () => [...CATALOG.values()].sort((x, y) => x.name.localeCompare(y.name));

const sourceLine = (p: Pkg) => `${ARCHIVE} ${suite(p.version)}/${component(p)} amd64 Packages`;

function searchRegex(term: string): RegExp {
  try {
    return new RegExp(term, 'i');
  } catch {
    return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

export function matches(terms: string[]): Pkg[] {
  const res = terms.map(searchRegex);
  return sorted().filter((p) => res.every((re) => re.test(p.name) || re.test(p.desc)));
}

export function list(a: AptRun, patterns: string[]): number {
  const db = loadDb(a.ctx.vfs);
  a.out.write('Listing... Done\n');
  if (a.upgradable) return 0;
  const names = new Set([...(a.installed ? [] : CATALOG.keys()), ...db.keys()]);
  const res = patterns.map(globRegex);
  for (const name of [...names].sort()) {
    if (res.length && !res.some((re) => re.test(name))) continue;
    const para = db.get(name);
    const version = para?.Version ?? CATALOG.get(name)!.version;
    const arch = para?.Architecture ?? CATALOG.get(name)!.arch;
    a.out.write(`${name}/${suite(version)}${para ? ',now' : ''} ${version} ${arch}${para ? ' [installed]' : ''}\n`);
  }
  return 0;
}

export function search(a: AptRun, terms: string[]): number {
  if (!terms.length) {
    a.ctx.stderr.write('E: You must give at least one search pattern\n');
    return 100;
  }
  const db = loadDb(a.ctx.vfs);
  a.out.write('Sorting... Done\nFull Text Search... Done\n');
  for (const p of matches(terms)) {
    const mark = db.has(p.name) ? ' [installed]' : '';
    a.out.write(`${p.name}/${suite(p.version)} ${p.version} ${p.arch}${mark}\n  ${p.desc}\n\n`);
  }
  return 0;
}

export function notFound(ctx: Ctx, names: string[]): number {
  for (const n of names) ctx.stderr.write(`N: Unable to locate package ${n}\n`);
  ctx.stderr.write('E: No packages found\n');
  return 100;
}

export function show(a: AptRun, names: string[]): number {
  const missing = names.filter((n) => !CATALOG.has(n));
  if (!names.length || missing.length) return notFound(a.ctx, missing);
  const db = loadDb(a.ctx.vfs);
  for (const p of names.map((n) => CATALOG.get(n)!)) {
    const fields = [
      ['Package', p.name], ['Version', p.version], ['Priority', p.priority], ['Section', p.section],
      ['Origin', 'Ubuntu'], ['Maintainer', MAINTAINER], ['Bugs', 'https://bugs.launchpad.net/ubuntu/+filebug'],
      ['Installed-Size', `${sizeToStr(p.isize * 1024)}B`], ['Download-Size', `${sizeToStr(p.size)}B`],
      ...(db.has(p.name) ? [['APT-Manual-Installed', 'yes']] : []),
      ['APT-Sources', sourceLine(p)], ['Description', p.desc],
    ];
    a.out.write(`${fields.map(([k, v]) => `${k}: ${v}\n`).join('')}\n`);
  }
  return 0;
}

export function policy(ctx: Ctx, out: { write(s: string): void }, names: string[]): number {
  const db: Db = loadDb(ctx.vfs);
  if (!names.length) {
    out.write('Package files:\n 100 /var/lib/dpkg/status\n     release a=now\n');
    for (const p of ['noble', 'noble-updates', 'noble-security', 'noble-backports']) {
      out.write(` 500 ${ARCHIVE} ${p}/main amd64 Packages\n     release o=Ubuntu,a=${p},n=${p.split('-')[0]},l=Ubuntu,c=main,b=amd64\n`);
    }
    return 0;
  }
  for (const n of names) {
    const p = CATALOG.get(n);
    if (!p) {
      ctx.stderr.write(`N: Unable to locate package ${n}\n`);
      continue;
    }
    const installed = db.has(n);
    out.write(`${n}:\n  Installed: ${installed ? db.get(n)!.Version : '(none)'}\n  Candidate: ${p.version}\n  Version table:\n`);
    out.write(`${installed ? ' *** ' : '     '}${p.version} 500\n        500 ${sourceLine(p)}\n`);
    if (installed) out.write('        100 /var/lib/dpkg/status\n');
  }
  return 0;
}
