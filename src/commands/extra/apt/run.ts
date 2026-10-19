import { lineReader, type Writer } from '../../../shell/io.ts';
import type { Ctx } from '../../types.ts';

export interface AptRun {
  ctx: Ctx;
  tool: string;
  out: Writer;
  yes: boolean;
  purge: boolean;
  installed: boolean;
  upgradable: boolean;
}

export const READING = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n';
export const MAN_DB = 'Processing triggers for man-db (2.12.0-4build2) ...\n';

export function summary(installed = 0, removed = 0): string {
  return `0 upgraded, ${installed} newly installed, ${removed} to remove and 0 not upgraded.\n`;
}

/** Package names indented two spaces and wrapped at 80 columns, like apt's ShowList. */
export function wrapList(names: string[]): string {
  const lines: string[] = [];
  let cur = ' ';
  for (const n of names) {
    if (cur.length + n.length + 1 > 79 && cur.trim()) {
      lines.push(cur);
      cur = ' ';
    }
    cur += ` ${n}`;
  }
  lines.push(cur);
  return `${lines.join('\n')}\n`;
}

export function frontendLockDenied(ctx: Ctx): number {
  ctx.stderr.write(
    'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n' +
      'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n',
  );
  return 100;
}

export function dirLockDenied(ctx: Ctx, dir: string): number {
  ctx.stderr.write(`E: Could not open lock file ${dir}lock - open (13: Permission denied)\nE: Unable to lock directory ${dir}\n`);
  return 100;
}

/** apt's YnPrompt: empty answer means yes, EOF means no. */
export async function confirm(a: AptRun): Promise<boolean> {
  if (a.yes || !a.ctx.stdin.isTTY) return true;
  a.ctx.stdout.write('Do you want to continue? [Y/n] ');
  const answer = await lineReader(a.ctx.stdin).next();
  if (answer !== null && /^\s*(y|yes)?\s*$/i.test(answer)) return true;
  a.ctx.stdout.write('Abort.\n');
  return false;
}
