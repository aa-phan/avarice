// Who is answering (plan 03-15; D-14, D-18, CS-11). The responder identity rule that `contract amend` uses first and that `decide`, `cancel` and
// `schedule` reuse: a command that widens a run or answers for the owner records the OS user it ran as, and works only for the owner's own
// profile. The refusal of a run, of a pipe and of a run's process tree sits next to this file's helpers (refuseOutsideTerminal).
import { statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { inRunProcessTree } from '../adapters/proc/ancestry.ts';
import type { ProcessEntry } from '../adapters/proc/ancestry.ts';
import type { Result } from '../domain/result.ts';

// What a command that must not run inside a run is told about where it runs: whether standard input and output are terminals, and a reader
// of the process ancestry (called only when the earlier checks pass, so a refusal that needs no process table never reads it).
export interface TerminalFacts {
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
}

export interface IdentityContext {
  terminal: TerminalFacts;
  ancestry(): Result<ProcessEntry[]>;
}

// The reason to refuse, or undefined: the checks apply in this order. A command that needs an owner at a terminal outside the run calls this
// from usage(), before the profile is resolved.
export function refuseOutsideTerminal(env: NodeJS.ProcessEnv, context: IdentityContext): string | undefined {
  if (env['AVARICE_RUN'] !== undefined) return 'refused inside a run (AVARICE_RUN is set)';
  if (!context.terminal.stdinIsTty || !context.terminal.stdoutIsTty) return 'needs an interactive terminal';
  if (inRunProcessTree(context.ancestry())) return "refused from inside a run's process tree";
  return undefined;
}

// The OS user the process runs as, with control characters removed so the name is safe to store and to print. `unknown` when the OS has no
// answer (a user ID with no passwd entry) or the name is empty after cleaning.
export function responderName(): string {
  let name: string;
  try {
    name = userInfo().username;
  } catch {
    return 'unknown';
  }
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return clean === '' ? 'unknown' : clean;
}

// Whether the data root belongs to the user running the process (its owner ID equals ours). False when it cannot be read, and on a platform
// with no user IDs: the answer for a profile that cannot be shown to be the owner's own is no.
export function ownsProfile(dataRoot: string): boolean {
  if (typeof process.getuid !== 'function') return false;
  try {
    return statSync(dataRoot).uid === process.getuid();
  } catch {
    return false;
  }
}
