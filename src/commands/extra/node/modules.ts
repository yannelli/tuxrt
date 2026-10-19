import { types } from 'node:util';
import vm from 'node:vm';
import { dirname, normalize } from '../../../vfs/path.ts';
import { builtinNames, createBuiltin } from './builtins.ts';
import { cleanStack, toNodeError, typeError } from './errors.ts';
import { isEsmError, rewriteDynamicImport, toCommonJs } from './esm.ts';
import type { NodeRuntime } from './runtime.ts';

const WRAPPER = '(function (exports, require, module, __filename, __dirname) {';
const ASYNC_WRAPPER = '(async function (exports, require, module, __filename, __dirname) {';
const EXTENSIONS = ['.js', '.json', '.cjs', '.mjs'];

type Require = ((id: unknown) => unknown) & { resolve: (id: unknown) => string; cache: object; main?: Module };

export class Module {
  id: string;
  filename: string;
  path: string;
  exports: unknown;
  loaded = false;
  children: Module[] = [];
  paths: string[];
  parent: Module | null;
  require!: Require;

  constructor(filename: string, parent: Module | null, exports: unknown) {
    this.id = this.filename = filename;
    this.path = dirname(filename);
    this.parent = parent;
    this.exports = exports;
    const dirs: string[] = [];
    for (let d = this.path; ; d = dirname(d)) {
      if (!d.endsWith('/node_modules')) dirs.push(`${d === '/' ? '' : d}/node_modules`);
      if (d === '/') break;
    }
    this.paths = dirs;
  }
}

const isAwaitError = (e: unknown) => e instanceof SyntaxError && /await is only valid|Unexpected reserved word/.test(e.message);

/** Tries alternative compilations after a SyntaxError; the original error wins if none applies. */
function retry<T>(original: unknown, attempts: (() => T | undefined)[]): T {
  for (const attempt of attempts) {
    try {
      const result = attempt();
      if (result !== undefined) return result;
    } catch {}
  }
  throw original;
}

/** CommonJS loader over the VFS: resolution, wrapper compilation, module cache and built-ins. */
export class ModuleSystem {
  readonly cache: Record<string, Module> = Object.create(null);
  main?: Module;
  private readonly rt: NodeRuntime;
  private readonly builtins = new Map<string, unknown>();

  constructor(rt: NodeRuntime) {
    this.rt = rt;
  }

  newModule(filename: string, parent: Module | null): Module {
    const mod = new Module(filename, parent, new this.rt.realm.Object());
    mod.require = this.makeRequire(mod);
    return mod;
  }

  makeRequire(mod: Module): Require {
    const req = ((id: unknown) => this.load(this.checkId(id), mod)) as Require;
    req.resolve = (id: unknown) => this.resolve(this.checkId(id), mod);
    req.cache = this.cache;
    req.main = this.main;
    return req;
  }

  /** Compiles a CommonJS wrapper; `allowAsync` lets top-level await turn it into an async function. */
  compile(source: string, filename: string, allowAsync: boolean): (...args: unknown[]) => unknown {
    this.rt.sources.set(filename, source);
    const body = rewriteDynamicImport(source.replace(/^#!.*/, ''));
    const build = (prefix: string, code: string) =>
      new vm.Script(`${prefix}\n${code}\n})`, { filename, lineOffset: -1 }).runInContext(this.rt.context, { displayErrors: false });
    if (filename.endsWith('.mjs')) return build(ASYNC_WRAPPER, toCommonJs(body));
    try {
      return build(WRAPPER, body);
    } catch (e) {
      return retry(e, [
        () => (allowAsync && isAwaitError(e) ? build(ASYNC_WRAPPER, body) : undefined),
        () => (/\b(import|export)\b/.test(body) ? build(allowAsync ? ASYNC_WRAPPER : WRAPPER, toCommonJs(body)) : undefined),
      ]);
    }
  }

  /** Compiles -e/-p/stdin code as a global script; top-level await wraps it in an async IIFE. */
  compileEval(code: string, filename: string, print: boolean): { script: vm.Script; async: boolean } {
    this.rt.sources.set(filename, code);
    const src = rewriteDynamicImport(code);
    const script = (s: string, lineOffset = 0) => new vm.Script(s, { filename, lineOffset });
    const asAsync = (s: string) => ({ script: script(print ? `(async () => (\n${s}\n))()` : `(async () => {\n${s}\n})()`, -1), async: true });
    try {
      return { script: script(src), async: false };
    } catch (e) {
      return retry(e, [
        () => (isAwaitError(e) ? asAsync(src) : undefined),
        () => {
          if (!/\b(import|export)\b/.test(src)) return undefined;
          const cjs = toCommonJs(src);
          return /\bawait\b/.test(src) ? asAsync(cjs) : { script: script(cjs), async: false };
        },
      ]);
    }
  }

  /** Compiles and runs a file as the main module; may return a promise when it uses top-level await. */
  runMain(filename: string): { value: unknown; async: boolean } {
    const mod = this.newModule(filename, null);
    mod.id = '.';
    this.main = mod.require.main = mod;
    this.cache[filename] = mod;
    const fn = this.compile(this.read(filename), filename, true);
    const value = fn.call(mod.exports, mod.exports, mod.require, mod, filename, mod.path);
    mod.loaded = true;
    return { value, async: types.isAsyncFunction(fn) };
  }

  /** The module that -e/-p/stdin code sees as `module`, rooted at the current directory. */
  evalModule(filename: string): Module {
    const mod = this.newModule(`${this.rt.cwd === '/' ? '' : this.rt.cwd}/${filename}`, null);
    mod.id = filename;
    return mod;
  }

  load(id: string, parent: Module): unknown {
    const name = this.builtinName(id);
    if (name) return this.builtin(name);
    const filename = this.resolve(id, parent);
    const cached = this.cache[filename];
    if (cached) return cached.exports;
    const mod = this.newModule(filename, parent);
    parent.children.push(mod);
    this.cache[filename] = mod;
    try {
      const source = this.read(filename);
      if (filename.endsWith('.json')) mod.exports = this.parseJson(source, filename);
      else this.compile(source, filename, false).call(mod.exports, mod.exports, mod.require, mod, filename, mod.path);
      mod.loaded = true;
    } catch (e) {
      delete this.cache[filename];
      throw e;
    }
    return mod.exports;
  }

  resolve(id: string, parent: Module | null): string {
    if (this.builtinName(id)) return id;
    const { vfs } = this.rt.ctx;
    const kind = (p: string) => this.rt.asUser(() => vfs.tryLookup(p)?.kind);
    const asFile = (p: string) => [p, ...EXTENSIONS.map((e) => p + e)].find((c) => kind(c) === 'file');
    const asDir = (p: string): string | undefined => {
      if (kind(p) !== 'dir') return undefined;
      if (kind(`${p}/package.json`) === 'file') {
        const main = (this.parseJson(this.read(`${p}/package.json`), `${p}/package.json`) as { main?: string }).main;
        const target = main && normalize(main, p);
        const found = target && (asFile(target) ?? asFile(`${target}/index`));
        if (found) return found;
      }
      return asFile(`${p}/index`);
    };
    const base = parent ? parent.path : this.rt.cwd;
    const candidates = /^(\.\.?(\/|$)|\/)/.test(id) ? [normalize(id, base)] : (parent?.paths ?? [`${base}/node_modules`]).map((d) => `${d}/${id}`);
    for (const c of candidates) {
      const found = asFile(c) ?? asDir(c);
      if (found) return found;
    }
    const stack: string[] = [];
    for (let m = parent; m; m = m.parent) stack.push(m.filename);
    const msg = `Cannot find module '${id}'${stack.length ? `\nRequire stack:\n- ${stack.join('\n- ')}` : ''}`;
    const err = Object.assign(new this.rt.realm.Error(msg), { code: 'MODULE_NOT_FOUND', requireStack: this.rt.realm.Array.from(stack) });
    err.stack = cleanStack(err.stack ?? '');
    throw err;
  }

  builtinName(id: string): string | undefined {
    const name = id.replace(/^node:/, '');
    return builtinNames.includes(name) ? name : undefined;
  }

  builtin(name: string): unknown {
    if (!this.builtins.has(name)) this.builtins.set(name, createBuiltin(this.rt, name));
    return this.builtins.get(name);
  }

  private checkId(id: unknown): string {
    if (typeof id === 'string' && id) return id;
    throw typeError(this.rt.realm, 'ERR_INVALID_ARG_VALUE', `The argument 'id' must be a non-empty string. Received ${JSON.stringify(id)}`);
  }

  private read(filename: string): string {
    try {
      return this.rt.asUser(() => this.rt.ctx.vfs.readFile(filename));
    } catch (e) {
      throw toNodeError(this.rt.realm, e, 'open', filename);
    }
  }

  private parseJson(source: string, filename: string): unknown {
    try {
      return this.rt.realm.JSON.parse(source.replace(/^﻿/, ''));
    } catch (e) {
      (e as Error).message = `${filename}: ${(e as Error).message}`;
      throw e;
    }
  }
}
