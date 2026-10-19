import { ARCHIVE, CATALOG, ESSENTIAL, component, sizeToStr, suite, type Pkg } from './catalog.ts';
import { fileCount, loadDb, paragraph, purgeFiles, saveDb, unpack, type Db } from './db.ts';
import { MAN_DB, READING, confirm, summary, wrapList, type AptRun } from './run.ts';

function unknown(a: AptRun, names: string[], db: Db): boolean {
  const missing = names.filter((n) => !CATALOG.has(n) && !db.has(n));
  for (const n of missing) a.ctx.stderr.write(`E: Unable to locate package ${n}\n`);
  return missing.length > 0;
}

export function install(a: AptRun, names: string[]): number {
  const { ctx, out } = a;
  const db = loadDb(ctx.vfs);
  out.write(READING);
  if (unknown(a, names, db)) return 100;
  const wanted = [...new Set(names)];
  for (const n of wanted.filter((n) => db.has(n))) out.write(`${n} is already the newest version (${db.get(n)!.Version}).\n`);
  const fresh = wanted.filter((n) => !db.has(n)).sort().map((n) => CATALOG.get(n)!);
  if (fresh.length) out.write(`The following NEW packages will be installed:\n${wrapList(fresh.map((p) => p.name))}`);
  out.write(summary(fresh.length, 0));
  if (!fresh.length) return 0;

  const download = fresh.reduce((sum, p) => sum + p.size, 0);
  const disk = fresh.reduce((sum, p) => sum + p.isize * 1024, 0);
  out.write(`Need to get ${sizeToStr(download)}B of archives.\n`);
  out.write(`After this operation, ${sizeToStr(disk)}B of additional disk space will be used.\n`);
  fresh.forEach((p, i) => {
    const where = `${ARCHIVE} ${suite(p.version)}/${component(p)} amd64`;
    out.write(`Get:${i + 1} ${where} ${p.name} ${p.arch} ${p.version} [${sizeToStr(p.size)}B]\n`);
  });
  out.write(`Fetched ${sizeToStr(download)}B in 0s (${sizeToStr(download * 3.1)}B/s)\n`);

  const width = String(fresh.length - 1).length;
  fresh.forEach((p, i) => {
    const prefix = fresh.length > 1 ? `${String(i).padStart(width, '0')}-` : '';
    out.write(`Selecting previously unselected package ${p.name}.\n`);
    if (i === 0) out.write(`(Reading database ... ${fileCount(db)} files and directories currently installed.)\n`);
    out.write(`Preparing to unpack .../${prefix}${debName(p)} ...\nUnpacking ${p.name} (${p.version}) ...\n`);
    unpack(ctx, p);
    db.set(p.name, paragraph(p));
  });
  saveDb(ctx.vfs, db);
  for (const p of fresh) out.write(`Setting up ${p.name} (${p.version}) ...\n`);
  out.write(MAN_DB);
  return 0;
}

function debName(p: Pkg): string {
  return `${p.name}_${p.version.replace(':', '%3a')}_${p.arch}.deb`;
}

export async function remove(a: AptRun, names: string[]): Promise<number> {
  const { ctx, out } = a;
  const db = loadDb(ctx.vfs);
  out.write(READING);
  if (unknown(a, names, db)) return 100;
  const wanted = [...new Set(names)];
  for (const n of wanted.filter((n) => !db.has(n))) out.write(`Package '${n}' is not installed, so not removed\n`);
  const targets = wanted.filter((n) => db.has(n)).sort();
  if (targets.length) out.write(`The following packages will be REMOVED:\n${wrapList(targets.map((n) => (a.purge ? `${n}*` : n)))}`);
  const essential = targets.filter((n) => ESSENTIAL.has(n));
  if (essential.length) {
    out.write('WARNING: The following essential packages will be removed.\n');
    out.write(`This should NOT be done unless you know exactly what you are doing!\n${wrapList(essential)}`);
  }
  out.write(summary(0, targets.length));
  if (!targets.length) return 0;
  if (essential.length) {
    ctx.stderr.write('E: Removing essential system-critical packages is not permitted. This might break the system.\n');
    return 100;
  }

  const freed = targets.reduce((sum, n) => sum + Number(db.get(n)!['Installed-Size'] ?? 0) * 1024, 0);
  out.write(`After this operation, ${sizeToStr(freed)}B disk space will be freed.\n`);
  if (!(await confirm(a))) return 1;
  out.write(`(Reading database ... ${fileCount(db)} files and directories currently installed.)\n`);
  for (const n of targets) {
    out.write(`Removing ${n} (${db.get(n)!.Version}) ...\n`);
    purgeFiles(ctx, n);
    db.delete(n);
  }
  saveDb(ctx.vfs, db);
  out.write(MAN_DB);
  return 0;
}
