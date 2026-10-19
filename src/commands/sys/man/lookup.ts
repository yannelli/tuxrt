import { gunzipSync } from 'node:zlib';
import { toBytes } from '../../extra/bytes.ts';
import type { Ctx } from '../../types.ts';
import { builtinDocs } from './pages/builtins.ts';
import { allPages } from './pages/index.ts';
import { expand, plain } from './inline.ts';
import { toRoff } from './toroff.ts';
import type { Page } from './types.ts';

export interface Entry {
  name: string;
  section: string;
  summary: string;
  path: string;
  roff: () => string;
}

export const MANPATH = ['/usr/local/man', '/usr/local/share/man', '/usr/share/man'];
/** man-db's default SECTION order, restricted to the sections that exist here. */
export const ORDER = ['1', '8', '2', '3', '5', '4', '9', '6', '7'];

const ADMIN = new Set([
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'adduser', 'chpasswd', 'reboot', 'shutdown', 'poweroff', 'halt',
  'service', 'ip', 'lsblk', 'apt-get', 'apt-cache', 'mandb',
]);
const GENERATED: [string, string] = ['tuxrt', 'April 2024'];

let database: Map<string, Page[]> | undefined;
function db(): Map<string, Page[]> {
  if (!database) {
    database = new Map();
    for (const page of allPages) {
      for (const name of [page.name, ...(page.aliases ?? [])]) database.set(name, [...(database.get(name) ?? []), page]);
    }
  }
  return database;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.?$/, '.');
const defaultPath = (name: string, sec: string) => `/usr/share/man/man${sec}/${name}.${sec}.gz`;

/** A minimal page for a registry command that has no hand-written manual. */
function generated(ctx: Ctx, name: string): Page | undefined {
  const def = ctx.shell.kernel.commands.get(name);
  if (!def) return undefined;
  const builtin = def.builtin && !def.stub;
  const doc = builtin ? builtinDocs[name] : undefined;
  const note = `${name} is a shell builtin. Run 'help ${name}' for a short summary, or see bash-builtins(7).`;
  return {
    name,
    section: ADMIN.has(name) ? '8' : '1',
    summary: doc?.summary ?? def.desc,
    synopsis: [doc?.synopsis ?? `${name} [OPTION]... [ARGUMENT]...`],
    description: doc ? [...doc.text.split('\n\n'), note] : [sentence(def.desc), builtin ? note : `Run '${name} --help' for a summary of options.`],
    seeAlso: builtin ? ['bash(1)', 'bash-builtins(7)'] : [],
    footer: builtin ? ['GNU Bash 5.2', '2022 September 19'] : GENERATED,
    manual: builtin ? 'General Commands Manual' : undefined,
  };
}

function fromPage(page: Page, name = page.name): Entry {
  return { name, section: page.section, summary: page.summary, path: defaultPath(name, page.section), roff: () => toRoff(page) };
}

/** Reads a page file from the VFS, inflating .gz files and following a whole-file ".so" include. */
export function readPage(ctx: Ctx, path: string, root = path.replace(/\/[^/]+\/[^/]+$/, '')): string {
  const raw = ctx.vfs.readFile(path);
  let text = raw;
  if (raw.startsWith('\x1f\x8b')) {
    try {
      text = gunzipSync(toBytes(raw)).toString('utf8');
    } catch {
      text = raw;
    }
  }
  const so = /^\.so\s+(\S+)\s*$/.exec(text.trim());
  if (!so) return text;
  const target = so[1].startsWith('/') ? so[1] : `${root}/${so[1]}`;
  const found = [target, `${target}.gz`].find((p) => ctx.vfs.exists(p));
  return found ? readPage(ctx, found, root) : text;
}

/** The whatis text of a roff page: the NAME section, split at " - ". */
function nameLine(roff: string): { names: string[]; summary: string } | undefined {
  const m = /^\.SH\s+"?NAME"?\s*\n([\s\S]*?)(?=^\.S[HS]|$(?![\s\S]))/m.exec(roff);
  if (!m) return undefined;
  const text = plain(expand(m[1].split('\n').filter((l) => !/^[.']/.test(l)).join(' '), { font: 'R', prev: 'R' }));
  const [names, ...rest] = text.split(/\s+-+\s+/);
  return { names: names.split(',').map((n) => n.trim()).filter(Boolean), summary: rest.join(' - ').trim() };
}

function vfsEntries(ctx: Ctx, name?: string): Entry[] {
  const out: Entry[] = [];
  for (const root of MANPATH) {
    let dirs: string[];
    try {
      dirs = ctx.vfs.readdir(root).filter((d) => /^man\w+$/.test(d));
    } catch {
      continue;
    }
    for (const dir of dirs) {
      let files: string[];
      try {
        files = ctx.vfs.readdir(`${root}/${dir}`);
      } catch {
        continue;
      }
      for (const file of files) {
        const m = /^(.+)\.(\d\w*)(\.gz)?$/.exec(file);
        if (!m || (name !== undefined && m[1] !== name)) continue;
        const path = `${root}/${dir}/${file}`;
        let roff: string;
        try {
          roff = readPage(ctx, path);
        } catch {
          continue;
        }
        out.push({ name: m[1], section: m[2], summary: nameLine(roff)?.summary ?? '', path, roff: () => roff });
      }
    }
  }
  return out;
}

const rank = (sec: string) => {
  const i = ORDER.indexOf(sec[0]);
  return (i < 0 ? ORDER.length : i) * 100 + sec.length;
};

function dedupe(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(`${e.name}.${e.section}`) && seen.add(`${e.name}.${e.section}`));
}

/** Every page for `name`, best section first: VFS files override built-in pages, which override generated ones. */
export function lookup(ctx: Ctx, name: string, sections?: string[]): Entry[] {
  const found = dedupe([...vfsEntries(ctx, name), ...(db().get(name) ?? []).map((p) => fromPage(p, name))]);
  if (!found.length) {
    const page = generated(ctx, name);
    if (page) found.push(fromPage(page));
  }
  return found.filter((e) => !sections || sections.some((s) => e.section.startsWith(s))).sort((a, b) => rank(a.section) - rank(b.section));
}

/** All known pages, for whatis, apropos and mandb. */
export function index(ctx: Ctx): Entry[] {
  const entries = vfsEntries(ctx);
  const named = new Set(entries.map((e) => e.name));
  for (const [name, pages] of db()) entries.push(...pages.map((p) => fromPage(p, name)));
  for (const name of ctx.shell.kernel.commands.keys()) {
    if (!db().has(name) && !named.has(name)) entries.push(fromPage(generated(ctx, name)!));
  }
  return dedupe(entries).sort((a, b) => a.name.localeCompare(b.name) || rank(a.section) - rank(b.section));
}
