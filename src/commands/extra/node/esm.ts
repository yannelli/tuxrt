// Best-effort ESM support: static import/export statements are rewritten to CommonJS on the
// same lines, so stack traces still point at the right place. Live bindings are not emulated.

const IMPORT = /(?<=^|;)[ \t]*import\s*(?:([\w$]+)\s*,?\s*)?(?:\*\s*as\s+([\w$]+)\s*|\{([^}]*)\}\s*)?(?:from\s*)?(['"])([^'"\n]+)\4[ \t]*;?/gm;
const EXPORT_FROM = /(?<=^|;)[ \t]*export\s*(?:\*(?:\s*as\s+([\w$]+))?|\{([^}]*)\})\s*from\s*(['"])([^'"\n]+)\3[ \t]*;?/gm;
const EXPORT_LIST = /(?<=^|;)[ \t]*export\s*\{([^}]*)\}[ \t]*;?/gm;
const EXPORT_DECL = /(?<=^|;)([ \t]*)export\s+(?!default\b)((?:async\s+)?function\s*\*?\s*([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/gm;
const EXPORT_DEFAULT = /(?<=^|;)([ \t]*)export\s+default\s+/gm;

const PRELUDE =
  "'use strict';const __esmDefault = (m) => (m && m.__esModule ? m.default : m);" +
  "const __importMeta = { url: 'file://' + __filename, filename: __filename, dirname: __dirname };";

const newlines = (s: string) => '\n'.repeat(s.split('\n').length - 1);
const pairs = (list: string) =>
  list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+as\s+/) as [string, string?]);

/** `import()` cannot be served by a vm.Script without experimental flags, so route it through require. */
export const rewriteDynamicImport = (code: string) => code.replace(/(?<![.\w$])import\s*\(/g, '__tuxrtImport(require, ');

export function isEsmError(e: unknown): boolean {
  return e instanceof SyntaxError && /import statement outside|Unexpected token 'export'|'import\.meta' outside/.test(e.message);
}

export function toCommonJs(src: string): string {
  let n = 0;
  const exported: string[] = [];
  let out = src.replace(IMPORT, (m, def: string, ns: string, named: string, q: string, spec: string) => {
    const tmp = `__mod${n++}`;
    const parts = [`const ${tmp} = require(${q}${spec}${q});`];
    if (def) parts.push(`const ${def} = __esmDefault(${tmp});`);
    if (ns) parts.push(`const ${ns} = ${tmp};`);
    for (const [name, alias] of named ? pairs(named) : []) {
      parts.push(name === 'default' ? `const ${alias} = __esmDefault(${tmp});` : `const ${alias ?? name} = ${tmp}.${name};`);
    }
    return parts.join(' ') + newlines(m);
  });
  out = out.replace(EXPORT_FROM, (m, nsAs: string, named: string, q: string, spec: string) => {
    const req = `require(${q}${spec}${q})`;
    if (named) return pairs(named).map(([name, alias]) => `exports.${alias ?? name} = ${req}.${name};`).join(' ') + newlines(m);
    return (nsAs ? `exports.${nsAs} = ${req};` : `Object.assign(exports, ${req});`) + newlines(m);
  });
  out = out.replace(EXPORT_LIST, (m, list: string) => {
    for (const [name, alias] of pairs(list)) exported.push(`exports.${alias ?? name} = ${name};`);
    return newlines(m);
  });
  out = out.replace(EXPORT_DECL, (_m, indent: string, decl: string, fn?: string, cls?: string, v?: string) => {
    const name = fn ?? cls ?? v;
    exported.push(`exports.${name} = ${name};`);
    return indent + decl;
  });
  out = out.replace(EXPORT_DEFAULT, (_m, indent: string) => `${indent}exports.default = `);
  out = out.replace(/\bimport\.meta\b/g, '__importMeta');
  const flag = exported.length || /exports\.default = /.test(out) ? "Object.defineProperty(exports, '__esModule', { value: true });" : '';
  return `${PRELUDE}${flag}${out}\n;${exported.join(' ')}`;
}
