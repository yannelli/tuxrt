import type { Dep, Node, Program } from './ast.ts';
import { values } from './eval.ts';
import { parseJson } from './json.ts';
import { parseModule } from './parser.ts';
import type { Env, FnLink } from './registry.ts';
import { defineFn, setVar } from './scope.ts';
import { isObj, type Obj, type Value } from './value.ts';
import { basename, dirname, normalize } from '../../../../vfs/path.ts';

export interface ModuleHost {
  /** File text, or null when the path is missing or not a regular file. */
  read(path: string): string | null;
  home: string;
  cwd: string;
  /** From -L; defaults to jq's built-in search path. */
  libraryPaths: string[];
}

/** Reported like a compile error: `jq: error: <message>`. */
export class ModuleError extends Error {}

export const DEFAULT_LIBRARY_PATHS = ['~/.jq', '$ORIGIN/../lib/jq', '$ORIGIN/../lib'];
const ORIGIN = '/usr/bin';

interface Loaded {
  prog: Program;
  exported: FnLink[];
}

export class Modules {
  /** Function keys and variable names the main program gains from its directives. */
  readonly keys: string[] = [];
  readonly vars: string[] = [];
  private readonly cache = new Map<string, Loaded>();
  private readonly loading = new Set<string>();
  private readonly host: ModuleHost;
  private readonly base: Env;

  constructor(host: ModuleHost, base: Env) {
    this.host = host;
    this.base = base;
  }

  /** A plain file at ~/.jq is included into every main program, as in jq. */
  autoInclude(env: Env): Env {
    const text = this.host.read(`${this.host.home}/.jq`);
    if (text === null) return env;
    for (const d of this.parse(`${this.host.home}/.jq`, text).defs) {
      env = defineFn(d, env);
      this.keys.push(`${d.name}/${d.params.length}`);
    }
    return env;
  }

  link(deps: Dep[], env: Env, from: string, top: boolean): Env {
    for (const dep of deps) {
      const found = this.resolve(dep, from);
      if (dep.data) {
        const data: Value = [...parseJson(found.text)].map((x) => x.value);
        const name = dep.alias!;
        env = setVar(setVar(env, name, data), `${name}::${name}`, data);
        if (top) this.vars.push(name, `${name}::${name}`);
        continue;
      }
      const mod = this.load(found.path, found.text);
      if (dep.alias === null) {
        env = this.link(mod.prog.deps, env, dirname(found.path), top);
        for (const d of mod.prog.defs) {
          env = defineFn(d, env);
          if (top) this.keys.push(`${d.name}/${d.params.length}`);
        }
        continue;
      }
      for (const l of mod.exported) {
        env = { ...env, funcs: { ...l, key: `${dep.alias}::${l.key}`, next: env.funcs } };
        if (top) this.keys.push(`${dep.alias}::${l.key}`);
      }
    }
    return env;
  }

  /** modulemeta: the module's `module {...}` object plus its deps and defs. */
  meta(name: string): Value {
    const found = this.resolve({ path: name, alias: null, data: false, meta: null, pos: 0 }, this.host.cwd);
    const { prog } = this.load(found.path, found.text);
    const entries = (n: Node | null): Obj => {
      const v = this.constant(n);
      return new Map(isObj(v) ? v : []);
    };
    const out = entries(prog.meta);
    const deps = prog.deps.map((d): Value => {
      const m = entries(d.meta);
      if (d.alias !== null) m.set('as', d.alias);
      m.set('is_data', d.data);
      m.set('relpath', d.path);
      return m;
    });
    out.set('deps', deps);
    out.set('defs', prog.defs.map((d) => `${d.name}/${d.params.length}`));
    return out;
  }

  private load(path: string, text: string): Loaded {
    const cached = this.cache.get(path);
    if (cached) return cached;
    if (this.loading.has(path)) throw new ModuleError(`circular module import: ${path}`);
    this.loading.add(path);
    const prog = this.parse(path, text);
    let env = this.link(prog.deps, this.base, dirname(path), false);
    const exported: FnLink[] = [];
    for (const d of prog.defs) {
      env = defineFn(d, env);
      exported.push(env.funcs!);
    }
    this.loading.delete(path);
    const loaded = { prog, exported };
    this.cache.set(path, loaded);
    return loaded;
  }

  private parse(path: string, text: string): Program {
    try {
      return parseModule(text);
    } catch (e) {
      throw new ModuleError(`${(e as Error).message} in module ${path}`);
    }
  }

  private constant(n: Node | null): Value {
    if (!n) return null;
    for (const v of values(n, this.base, null)) return v;
    return null;
  }

  /** jq looks for "a/b" as a/b.jq then a/b/b.jq (.json for data) in each search directory. */
  private resolve(dep: Dep, from: string): { path: string; text: string } {
    const meta = this.constant(dep.meta);
    const search = isObj(meta) ? meta.get('search') : undefined;
    const local = typeof search === 'string' ? [search] : Array.isArray(search) ? search.filter((s) => typeof s === 'string') : [];
    const dirs = [...(local as string[]).map((d) => this.expand(d, from)), ...this.host.libraryPaths.map((d) => this.expand(d, this.host.cwd))];
    const ext = dep.data ? '.json' : '.jq';
    const candidates = [`${dep.path}${ext}`, `${dep.path}/${basename(dep.path)}${ext}`];
    for (const dir of dep.path.startsWith('/') ? ['/'] : dirs) {
      for (const c of candidates) {
        const path = normalize(c, dir);
        const text = this.host.read(path);
        if (text !== null) return { path, text };
      }
    }
    throw new ModuleError(`module not found: ${dep.path}`);
  }

  private expand(dir: string, from: string): string {
    if (dir === '~' || dir.startsWith('~/')) return this.host.home + dir.slice(1);
    if (dir === '$ORIGIN' || dir.startsWith('$ORIGIN/')) return ORIGIN + dir.slice(7);
    return normalize(dir, from);
  }
}
