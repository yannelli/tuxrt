import { evaluate } from '../../shell/arith.ts';
import { lineReader } from '../../shell/io.ts';
import { shellQuote } from '../../shell/quote.ts';
import type { Shell, ShellOptions } from '../../shell/shell.ts';
import type { CommandTable, Ctx } from '../types.ts';
import { bfail } from '../util.ts';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LONG_OPTS: Record<string, keyof ShellOptions> = { errexit: 'errexit', nounset: 'nounset', xtrace: 'xtrace', noglob: 'noglob', pipefail: 'pipefail' };
const SHORT_OPTS: Record<string, keyof ShellOptions> = { e: 'errexit', u: 'nounset', x: 'xtrace', f: 'noglob' };

function assignArgs(ctx: Ctx, onEach: (name: string, value: string | undefined) => void): number {
  let status = 0;
  for (const a of ctx.args.filter((x) => !x.startsWith('-'))) {
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    if (!NAME.test(name)) status = bfail(ctx, `\`${a}': not a valid identifier`);
    else onEach(name, eq === -1 ? undefined : a.slice(eq + 1));
  }
  return status;
}

function printVars(ctx: Ctx, names: Iterable<string>, prefix: (name: string) => string): void {
  for (const name of [...names].sort()) {
    const v = ctx.shell.vars.get(name);
    ctx.stdout.write(v === undefined ? `${prefix(name)}${name}\n` : `${prefix(name)}${name}="${v.replace(/(["\\$`])/g, '\\$1')}"\n`);
  }
}

function exportCmd(ctx: Ctx): number {
  const { shell } = ctx;
  if (!ctx.args.filter((a) => !a.startsWith('-')).length) {
    printVars(ctx, shell.exported, () => 'declare -x ');
    return 0;
  }
  const unexport = ctx.args.includes('-n');
  return assignArgs(ctx, (name, value) => {
    if (unexport) shell.exported.delete(name);
    else shell.export(name, value);
  });
}

function unset(ctx: Ctx): number {
  const fns = ctx.args.includes('-f');
  for (const name of ctx.args.filter((a) => !a.startsWith('-'))) {
    if (fns) ctx.shell.functions.delete(name);
    else if (ctx.shell.vars.has(name)) ctx.shell.unset(name);
    else ctx.shell.functions.delete(name);
  }
  return 0;
}

function set(ctx: Ctx): number {
  const { shell } = ctx;
  if (!ctx.args.length) {
    for (const [k, v] of [...shell.vars].sort()) ctx.stdout.write(`${k}=${shellQuote(v)}\n`);
    return 0;
  }
  const args = [...ctx.args];
  while (args.length && /^[-+]/.test(args[0])) {
    const a = args.shift()!;
    if (a === '--' || a === '-') {
      shell.positional = args.splice(0);
      return 0;
    }
    const on = a[0] === '-';
    if (a.slice(1) === 'o') {
      const name = args.shift();
      if (!name) {
        for (const [k, key] of Object.entries(LONG_OPTS)) ctx.stdout.write(`${k.padEnd(15)}\t${shell.options[key] ? 'on' : 'off'}\n`);
        continue;
      }
      if (!(name in LONG_OPTS)) return bfail(ctx, `${name}: invalid option name`);
      shell.options[LONG_OPTS[name]] = on;
      continue;
    }
    for (const c of a.slice(1)) {
      if (!(c in SHORT_OPTS)) return bfail(ctx, `${a[0]}${c}: invalid option`, 2);
      shell.options[SHORT_OPTS[c]] = on;
    }
  }
  if (args.length) shell.positional = args;
  return 0;
}

function shift(ctx: Ctx): number {
  const n = Number(ctx.args[0] ?? 1);
  if (!Number.isInteger(n) || n < 0 || n > ctx.shell.positional.length) return 1;
  ctx.shell.positional = ctx.shell.positional.slice(n);
  return 0;
}

function local(ctx: Ctx): number {
  const scope = ctx.shell.locals.at(-1);
  if (!scope) return bfail(ctx, 'can only be used in a function');
  return assignArgs(ctx, (name, value) => {
    if (!scope.has(name)) scope.set(name, ctx.shell.vars.get(name));
    ctx.shell.set(name, value ?? '');
  });
}

function declare(ctx: Ctx): number {
  const { shell } = ctx;
  const flags = ctx.args.filter((a) => a.startsWith('-')).join('');
  if (flags.includes('f')) {
    for (const name of shell.functions.keys()) ctx.stdout.write(`declare -f ${name}\n`);
    return 0;
  }
  const operands = ctx.args.filter((a) => !a.startsWith('-'));
  if (!operands.length || flags.includes('p')) {
    const names = operands.length ? operands : [...shell.vars.keys()];
    printVars(ctx, names, (n) => (shell.exported.has(n) ? 'declare -x ' : 'declare -- '));
    return 0;
  }
  const scope = shell.locals.at(-1);
  return assignArgs(ctx, (name, value) => {
    if (scope && !flags.includes('g') && !scope.has(name)) scope.set(name, shell.vars.get(name));
    let v = value ?? shell.vars.get(name) ?? '';
    if (flags.includes('i')) v = String(arith(shell, v));
    if (flags.includes('l')) v = v.toLowerCase();
    if (flags.includes('u')) v = v.toUpperCase();
    shell.set(name, v);
    if (flags.includes('x')) shell.export(name);
  });
}

function arith(shell: Shell, expr: string): number {
  return evaluate(expr, { get: (n) => shell.get(n) ?? '', set: (n, v) => shell.set(n, v) });
}

function letCmd(ctx: Ctx): number {
  if (!ctx.args.length) return bfail(ctx, 'expression expected');
  let last = 0;
  try {
    for (const expr of ctx.args) last = arith(ctx.shell, expr);
  } catch (e) {
    return bfail(ctx, (e as Error).message);
  }
  return last === 0 ? 1 : 0;
}

async function read(ctx: Ctx): Promise<number> {
  const { shell } = ctx;
  let raw = false;
  let silent = false;
  let delim = '\n';
  let nchars = 0;
  const names: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '-r') raw = true;
    else if (a === '-s') silent = true;
    else if (a === '-p') ctx.stderr.write(ctx.args[++i] ?? '');
    else if (a === '-d') delim = ctx.args[++i]?.[0] ?? '\0';
    else if (a === '-n' || a === '-N') nchars = Number(ctx.args[++i]);
    else if (a === '-t' || a === '-u') i++;
    else names.push(a);
  }
  const reader = lineReader(ctx.stdin);
  let line = '';
  let eof = true;
  for (let chunk = await reader.next(); chunk !== null; chunk = await reader.next()) {
    line += chunk;
    const atDelim = delim === '\n' ? line.endsWith('\n') : line.includes(delim);
    if (!raw && line.endsWith('\\\n')) {
      line = line.slice(0, -2);
      continue;
    }
    if (atDelim || (nchars && line.length >= nchars)) {
      eof = false;
      break;
    }
  }
  if (delim !== '\n' && line.includes(delim)) line = line.slice(0, line.indexOf(delim));
  if (nchars) line = line.slice(0, nchars);
  line = line.replace(/\n$/, '');
  if (!raw) line = line.replace(/\\(.)/g, '$1');
  if (silent && ctx.stdin.isTTY) ctx.stderr.write('\n');
  const ifs = shell.get('IFS') ?? ' \t\n';
  const targets = names.length ? names : ['REPLY'];
  if (!names.length) shell.set('REPLY', line);
  else {
    const ws = new RegExp(`^[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+|[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g');
    let rest = ifs ? line.replace(ws, '') : line;
    targets.forEach((name, i) => {
      if (i === targets.length - 1) return shell.set(name, rest);
      const m = new RegExp(`[${ifs.replace(/[\]\\^-]/g, '\\$&')}]+`).exec(rest);
      shell.set(name, m ? rest.slice(0, m.index) : rest);
      rest = m ? rest.slice(m.index + m[0].length) : '';
    });
  }
  return eof ? 1 : 0;
}

function getopts(ctx: Ctx): number {
  const { shell } = ctx;
  const [spec, name, ...given] = ctx.args;
  if (!spec || !name) return bfail(ctx, 'usage: getopts optstring name [arg ...]', 2);
  const args = given.length ? given : shell.positional;
  let ind = Number(shell.get('OPTIND') ?? 1);
  let pos = Number(shell.get('_GETOPTS_POS') ?? 1);
  const arg = args[ind - 1];
  if (arg === undefined || arg === '--' || !arg.startsWith('-') || arg === '-') {
    if (arg === '--') shell.set('OPTIND', String(ind + 1));
    shell.set(name, '?');
    return 1;
  }
  const c = arg[pos];
  const advance = () => {
    if (++pos >= arg.length) {
      ind++;
      pos = 1;
    }
  };
  const i = spec.indexOf(c);
  if (i === -1 || c === ':') {
    if (!spec.startsWith(':')) ctx.stderr.write(`${shell.argv0}: illegal option -- ${c}\n`);
    shell.set(name, '?');
    advance();
  } else if (spec[i + 1] === ':') {
    const value = pos + 1 < arg.length ? arg.slice(pos + 1) : args[ind];
    ind += pos + 1 < arg.length ? 1 : 2;
    pos = 1;
    shell.set(name, c);
    shell.set('OPTARG', value ?? '');
  } else {
    shell.set(name, c);
    advance();
  }
  shell.set('OPTIND', String(ind));
  shell.set('_GETOPTS_POS', String(pos));
  return 0;
}

export const varBuiltins: CommandTable = {
  export: { fn: exportCmd, builtin: true, desc: 'Set export attribute for shell variables' },
  unset: { fn: unset, builtin: true, desc: 'Remove variables or functions' },
  set: { fn: set, builtin: true, desc: 'Change shell options or positional args' },
  shift: { fn: shift, builtin: true, desc: 'Shift positional parameters' },
  local: { fn: local, builtin: true, desc: 'Define local variables' },
  declare: { fn: declare, builtin: true, desc: 'Set variable values and attributes' },
  typeset: { fn: declare, builtin: true, desc: 'Set variable values and attributes' },
  readonly: { fn: declare, builtin: true, desc: 'Mark shell variables as unchangeable' },
  let: { fn: letCmd, builtin: true, desc: 'Evaluate arithmetic expressions' },
  read: { fn: read, builtin: true, desc: 'Read a stdin line into variables' },
  getopts: { fn: getopts, builtin: true, desc: 'Parse option arguments' },
};
