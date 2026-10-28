import { awkCommands } from "./awk/index.ts";
import { coreBuiltins } from "./builtins/core.ts";
import { jobBuiltins } from "./builtins/jobs.ts";
import { printfBuiltins } from "./builtins/printf.ts";
import { testBuiltins } from "./builtins/test.ts";
import { varBuiltins } from "./builtins/vars.ts";
import { extraCommands } from "./extra/index.ts";
import { fsCommands } from "./fs/index.ts";
import { sysCommands } from "./sys/index.ts";
import { textCommands } from "./text/index.ts";
import type { CommandDef, CommandTable } from "./types.ts";
import { platform } from "../platform/index.ts";

const tables: CommandTable[] = [
  coreBuiltins,
  varBuiltins,
  jobBuiltins,
  testBuiltins,
  printfBuiltins,
  fsCommands,
  textCommands,
  awkCommands,
  sysCommands,
  extraCommands,
];

export function createRegistry(): Map<string, CommandDef> {
  return new Map(
    [...tables, platform.commands ?? {}].flatMap((t) => Object.entries(t)),
  );
}

/** Names that get an ELF stub in /usr/bin. */
export function binaryNames(registry: Map<string, CommandDef>): string[] {
  return [...registry].filter(([, d]) => !d.builtin || d.stub).map(([n]) => n);
}
