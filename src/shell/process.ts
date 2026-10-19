export interface Proc {
  pid: number;
  ppid: number;
  uid: number;
  cmd: string;
  start: number;
  tty: string;
  job?: AbortController;
}

export const SIGNALS: Record<string, number> = {
  HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, CONT: 18, STOP: 19,
};

export function parseSignal(spec: string): number | undefined {
  const name = spec.replace(/^-/, '').replace(/^SIG/i, '').toUpperCase();
  if (/^\d+$/.test(name)) return Number(name) <= 64 ? Number(name) : undefined;
  return SIGNALS[name];
}

/** The emulated kernel's process table: system daemons plus every command the shell spawns. */
export class ProcessTable {
  readonly procs = new Map<number, Proc>();
  private nextPid = 1200;

  constructor(bootTime: number) {
    const daemons: [number, string][] = [
      [1, '/sbin/init'], [2, '[kthreadd]'], [312, '/lib/systemd/systemd-journald'], [348, '/lib/systemd/systemd-udevd'],
      [512, '/lib/systemd/systemd-networkd'], [530, '/lib/systemd/systemd-resolved'], [601, '/usr/sbin/cron -f'],
      [615, '/usr/sbin/rsyslogd -n -iNONE'], [702, 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups'],
    ];
    for (const [pid, cmd] of daemons) this.procs.set(pid, { pid, ppid: pid === 1 ? 0 : 1, uid: 0, cmd, start: bootTime, tty: '?' });
  }

  spawn(cmd: string, uid: number, ppid: number, job?: AbortController): Proc {
    const proc: Proc = { pid: this.nextPid++, ppid, uid, cmd, start: Date.now(), tty: 'pts/0', job };
    this.procs.set(proc.pid, proc);
    return proc;
  }

  exit(pid: number): void {
    this.procs.delete(pid);
  }

  /** Delivers a signal. Returns false if no such process. */
  kill(pid: number, signal: number): boolean {
    const proc = this.procs.get(pid);
    if (!proc) return false;
    if (signal !== 0 && signal !== SIGNALS.CONT && signal !== SIGNALS.STOP) proc.job?.abort(signal);
    return true;
  }
}
