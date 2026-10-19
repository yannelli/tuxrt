import type { Node, Pattern } from './ast.ts';
import { FORMATS } from './formats.ts';
import { CompileError } from './value.ts';

type Names = { name: string; next: Names } | null;

const has = (l: Names, name: string): boolean => (l ? l.name === name || has(l.next, name) : false);
const push = (l: Names, ...names: string[]): Names => names.reduce<Names>((acc, name) => ({ name, next: acc }), l);

function children(n: Node): (Node | null)[] {
  switch (n.k) {
    case 'index': return [n.t, n.i];
    case 'slice': return [n.t, n.from, n.to];
    case 'iter': return [n.t];
    case 'neg': return [n.e];
    case 'try': return [n.body, n.handler];
    case 'arr': return [n.e];
    case 'obj': return n.entries.flatMap((e) => [e.key, e.val]);
    case 'if': return [n.cond, n.then, n.else];
    case 'str': return n.parts.filter((p) => typeof p !== 'string');
    case 'pipe': case 'comma': case 'and': case 'or': case 'alt': case 'bin': case 'assign': return [n.l, n.r];
    default: return [];
  }
}

/** Resolves every function, variable and label reference, as jq does before running anything. */
export function check(root: Node, builtins: Set<string>, globals: string[]): CompileError[] {
  const errs: CompileError[] = [];

  function pattern(p: Pattern, fns: Names, vars: Names): Names {
    if (p.k === 'var') return push(vars, p.name);
    if (p.k === 'arr') return p.items.reduce((acc, item) => pattern(item, fns, acc), vars);
    for (const e of p.entries) {
      walk(e.key, fns, vars);
      if (e.bind) vars = push(vars, e.bind);
      if (e.pat) vars = pattern(e.pat, fns, vars);
    }
    return vars;
  }

  function walk(n: Node | null, fns: Names, vars: Names): void {
    if (!n) return;
    switch (n.k) {
      case 'call': {
        const key = `${n.name}/${n.args.length}`;
        if (!has(fns, key) && !builtins.has(key)) errs.push(new CompileError(`${key} is not defined`, n.pos));
        for (const a of n.args) walk(a, fns, vars);
        return;
      }
      case 'var':
        if (!has(vars, n.name)) errs.push(new CompileError(`$${n.name} is not defined`, n.pos));
        return;
      case 'break':
        if (!has(vars, `*${n.name}`)) errs.push(new CompileError(`$*label-${n.name} is not defined`, n.pos));
        return;
      case 'fmt':
      case 'str': {
        const fmt = n.k === 'fmt' ? n.name : n.fmt;
        if (fmt !== null && !FORMATS.has(fmt)) errs.push(new CompileError(`${fmt} is not a valid format`, 0));
        break;
      }
      case 'bind':
        walk(n.src, fns, vars);
        walk(n.body, fns, n.alts.reduce((acc, alt) => pattern(alt, fns, acc), pattern(n.pat, fns, vars)));
        return;
      case 'reduce':
      case 'foreach': {
        walk(n.src, fns, vars);
        walk(n.init, fns, vars);
        const inner = pattern(n.pat, fns, vars);
        walk(n.update, fns, inner);
        if (n.k === 'foreach') walk(n.extract, fns, inner);
        return;
      }
      case 'label':
        walk(n.body, fns, push(vars, `*${n.name}`));
        return;
      case 'def': {
        const self = push(fns, `${n.fn.name}/${n.fn.params.length}`);
        const bare = n.fn.params.map((p) => p.replace(/^\$/, ''));
        const valueParams = n.fn.params.filter((p) => p.startsWith('$')).map((p) => p.slice(1));
        walk(n.fn.body, push(self, ...bare.map((p) => `${p}/0`)), push(vars, ...valueParams));
        walk(n.body, self, vars);
        return;
      }
    }
    for (const c of children(n)) walk(c, fns, vars);
  }

  walk(root, null, push(null, ...globals));
  return errs;
}
