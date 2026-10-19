import type { CommandTable } from '../types.ts';
import { bcCommands } from './bc.ts';
import { dnsCommands } from './dns.ts';
import { docCommands } from './docs.ts';
import { exprCommands } from './expr.ts';
import { hashCommands } from './hash.ts';
import { infoCommands } from './info.ts';
import { miscCommands } from './misc.ts';
import { netCommands } from './net.ts';
import { pingCommands } from './ping.ts';
import { procCommands } from './proc.ts';
import { runCommands } from './run.ts';
import { sessionCommands } from './session.ts';
import { sudoCommands } from './sudo.ts';
import { systemdCommands } from './systemd.ts';
import { timeCommands } from './time.ts';
import { topCommands } from './top.ts';
import { traceCommands } from './trace.ts';
import { userAdminCommands } from './useradm.ts';

export const sysCommands: CommandTable = {
  ...infoCommands,
  ...sessionCommands,
  ...netCommands,
  ...pingCommands,
  ...traceCommands,
  ...dnsCommands,
  ...timeCommands,
  ...runCommands,
  ...procCommands,
  ...topCommands,
  ...sudoCommands,
  ...userAdminCommands,
  ...docCommands,
  ...hashCommands,
  ...exprCommands,
  ...bcCommands,
  ...miscCommands,
  ...systemdCommands,
};
