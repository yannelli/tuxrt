import type { CommandTable, Ctx } from '../types.ts';
import { strftime } from './datefmt.ts';
import { started } from './procinfo.ts';

interface Unit {
  name: string;
  desc: string;
  pid: number;
  cmd: string;
}

const UNITS: Unit[] = [
  { name: 'cron', desc: 'Regular background program processing daemon', pid: 601, cmd: '/usr/sbin/cron -f' },
  { name: 'rsyslog', desc: 'System Logging Service', pid: 615, cmd: '/usr/sbin/rsyslogd -n -iNONE' },
  { name: 'ssh', desc: 'OpenBSD Secure Shell server', pid: 702, cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups' },
  { name: 'systemd-journald', desc: 'Journal Service', pid: 312, cmd: '/lib/systemd/systemd-journald' },
  { name: 'systemd-networkd', desc: 'Network Configuration', pid: 512, cmd: '/lib/systemd/systemd-networkd' },
  { name: 'systemd-resolved', desc: 'Network Name Resolution', pid: 530, cmd: '/lib/systemd/systemd-resolved' },
  { name: 'systemd-udevd', desc: 'Rule-based Manager for Device Events and Files', pid: 348, cmd: '/lib/systemd/systemd-udevd' },
];

const MUTATING = new Set(['start', 'stop', 'restart', 'reload', 'try-restart', 'reload-or-restart', 'enable', 'disable', 'mask', 'unmask', 'daemon-reload', 'kill']);

const findUnit = (name: string) => UNITS.find((u) => u.name === name.replace(/\.service$/, '') || (u.name === 'ssh' && name === 'sshd'));
const isActive = (ctx: Ctx, u: Unit) => ctx.shell.kernel.procs.procs.has(u.pid);

function ago(ms: number): string {
  const s = Math.floor(ms / 1000);
  const [d, h, m] = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60)];
  if (d) return `${d} day${d > 1 ? 's' : ''} ${h}h`;
  if (h) return `${h}h ${m}min`;
  return m ? `${m}min ${s % 60}s` : `${s}s`;
}

function status(ctx: Ctx, u: Unit): boolean {
  const proc = ctx.shell.kernel.procs.procs.get(u.pid);
  const out = [
    `${proc ? '●' : '○'} ${u.name}.service - ${u.desc}`,
    `     Loaded: loaded (/usr/lib/systemd/system/${u.name}.service; enabled; preset: enabled)`,
  ];
  if (!proc) out.push('     Active: inactive (dead)');
  else {
    const since = started(proc);
    out.push(
      `     Active: active (running) since ${strftime('%a %Y-%m-%d %H:%M:%S %Z', new Date(since))}; ${ago(Date.now() - since)} ago`,
      `   Main PID: ${u.pid} (${u.cmd.split(/[\s:]/)[0].split('/').pop()})`,
      '      Tasks: 1 (limit: 4613)',
      '     Memory: 2.4M (peak: 3.1M)',
      '        CPU: 38ms',
      `     CGroup: /system.slice/${u.name}.service`,
      `             └─${u.pid} ${u.cmd.includes(' ') ? `"${u.cmd}"` : u.cmd}`,
    );
  }
  ctx.stdout.write(`${out.join('\n')}\n`);
  return !!proc;
}

function listUnits(ctx: Ctx, all: boolean): number {
  const shown = UNITS.filter((u) => all || isActive(ctx, u));
  const width = Math.max(...UNITS.map((u) => u.name.length)) + 9;
  ctx.stdout.write(`  ${'UNIT'.padEnd(width)} LOAD   ACTIVE   SUB     DESCRIPTION\n`);
  for (const u of shown) {
    const [active, sub] = isActive(ctx, u) ? ['active', 'running'] : ['inactive', 'dead'];
    ctx.stdout.write(`  ${`${u.name}.service`.padEnd(width)} loaded ${active.padEnd(8)} ${sub.padEnd(7)} ${u.desc}\n`);
  }
  ctx.stdout.write('\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n');
  ctx.stdout.write(`${shown.length} loaded units listed.${all ? '' : ' Pass --all to see loaded but inactive units, too.'}\n`);
  return 0;
}

function apply(ctx: Ctx, verb: string, u: Unit): void {
  const { procs } = ctx.shell.kernel.procs;
  if (verb === 'stop' || verb === 'kill') procs.delete(u.pid);
  else if (['start', 'restart', 'reload-or-restart', 'try-restart'].includes(verb)) {
    if (verb !== 'try-restart' || procs.has(u.pid)) procs.set(u.pid, { pid: u.pid, ppid: 1, uid: 0, cmd: u.cmd, start: Date.now(), tty: '?' });
  }
}

function systemctl(ctx: Ctx): number {
  const all = ctx.args.includes('--all') || ctx.args.includes('-a');
  const [verb = 'list-units', ...names] = ctx.args.filter((a) => !a.startsWith('-'));
  if (verb === 'list-units' || verb === 'list-unit-files') return listUnits(ctx, all || verb === 'list-unit-files');
  if (MUTATING.has(verb) && ctx.shell.user.uid !== 0) {
    const target = names[0] ? `${verb} ${names[0].replace(/\.service$/, '')}.service` : 'reload daemon';
    ctx.stderr.write(`Failed to ${target}: Interactive authentication required.\n`);
    if (names[0]) ctx.stderr.write(`See system logs and 'systemctl status ${names[0].replace(/\.service$/, '')}.service' for details.\n`);
    return 1;
  }
  if (verb === 'daemon-reload') return 0;
  if (verb === 'status' && !names.length) {
    ctx.stdout.write(`● ${ctx.vfs.readFile('/etc/hostname').trim()}\n    State: running\n    Units: ${UNITS.length} loaded\n     Jobs: 0 queued\n   Failed: 0 units\n  systemd: 255.4-1ubuntu8.4\n   CGroup: /\n`);
    return 0;
  }
  if (!names.length) return (ctx.stderr.write(`Too few arguments.\n`), 1);
  let code = 0;
  for (const name of names) {
    const unit = findUnit(name);
    if (!unit) {
      ctx.stderr.write(verb === 'status' ? `Unit ${name.replace(/\.service$/, '')}.service could not be found.\n` : `Failed to ${verb} ${name}: Unit ${name.replace(/\.service$/, '')}.service not found.\n`);
      code = verb === 'status' ? 4 : 5;
    } else if (verb === 'status') code = status(ctx, unit) ? code : 3;
    else if (verb === 'is-active') code = (ctx.stdout.write(`${isActive(ctx, unit) ? 'active' : 'inactive'}\n`), isActive(ctx, unit) ? code : 3);
    else if (verb === 'is-enabled') ctx.stdout.write('enabled\n');
    else if (MUTATING.has(verb)) apply(ctx, verb, unit);
    else return (ctx.stderr.write(`Unknown command verb '${verb}'.\n`), 1);
  }
  return code;
}

function service(ctx: Ctx): number {
  const [name, action] = ctx.args;
  if (name === '--status-all') {
    for (const u of UNITS.filter((x) => !x.name.startsWith('systemd-'))) ctx.stdout.write(` [ ${isActive(ctx, u) ? '+' : '-'} ]  ${u.name}\n`);
    return 0;
  }
  if (!name || !action) return (ctx.stderr.write('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]\n'), 1);
  if (!findUnit(name)) return (ctx.stderr.write(`${name}: unrecognized service\n`), 1);
  return systemctl({ ...ctx, name: 'systemctl', args: [action, name] });
}

export const systemdCommands: CommandTable = {
  systemctl: { fn: systemctl, desc: 'Control the systemd system and service manager' },
  service: { fn: service, desc: 'run a System V init script' },
};
