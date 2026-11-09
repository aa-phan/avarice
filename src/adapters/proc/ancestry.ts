// The process ancestry reader (plan 03-15; CS-11, D-18). `contract amend` must not be reachable from a contained run, and the run's own process
// tree is the one fact a run cannot hide: the agent's shell is a descendant of the supervisor that launched it, and the supervisor's command line
// is `... supervise run_<id>`. The walk goes from a process to pid 1 with `/bin/ps` (argv, no shell, a time limit, nothing left running). A chain
// that cannot be read, or that does not end, counts as inside the tree: the refusal fails closed.
import { execFileSync } from 'node:child_process';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface ProcessEntry {
  pid: number;
  ppid: number;
  // The command line, at most COMMAND_MAX characters (see cutCommand).
  command: string;
}

export const COMMAND_MAX = 400;
export const MAX_HOPS = 64;
const PS_TIMEOUT_MS = 5_000;
const CUT_HEAD = 150;
const CUT_MARK = ' ... ';

// The supervisor is started with `[...execArgv, entry, 'supervise', runId]`: a space, `supervise`, a space and a run ID.
const SUPERVISOR_SIGNATURE = / supervise run_[0-9A-Za-z]/;

// A command line longer than COMMAND_MAX keeps its start and its end, joined by a mark. The supervisor signature is at the end of the line, so
// a long node option list or a long entry path cannot push it out of what is kept.
export function cutCommand(command: string): string {
  if (command.length <= COMMAND_MAX) return command;
  return `${command.slice(0, CUT_HEAD)}${CUT_MARK}${command.slice(command.length - (COMMAND_MAX - CUT_HEAD - CUT_MARK.length))}`;
}

function readEntry(pid: number): Result<ProcessEntry> {
  let text: string;
  try {
    text = execFileSync('/bin/ps', ['-ww', '-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot read process ${pid} (${(e as NodeJS.ErrnoException).code ?? 'ps failed'})` });
  }
  const parsed = /^\s*(\d+)\s+([\s\S]*?)\s*$/.exec(text);
  if (parsed === null) return err({ kind: 'unavailable', cause: `cannot read process ${pid} (unexpected ps output)` });
  const command = (parsed[2] as string).replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return ok({ pid, ppid: Number(parsed[1]), command: cutCommand(command) });
}

// The process `pid` and each parent above it, nearest first, up to pid 1 (or to a process with no parent). More than MAX_HOPS entries, a process
// seen twice or a process that cannot be read is an error.
export function processAncestry(pid: number): Result<ProcessEntry[]> {
  if (!Number.isInteger(pid) || pid < 1) return err({ kind: 'invalid', field: 'pid', reason: 'must be a positive integer' });
  const chain: ProcessEntry[] = [];
  const seen = new Set<number>();
  let current = pid;
  while (chain.length < MAX_HOPS) {
    if (seen.has(current)) return err({ kind: 'internal', cause: `the process chain of ${pid} loops at ${current}` });
    seen.add(current);
    const read = readEntry(current);
    if (!read.ok) return read;
    chain.push(read.value);
    if (current === 1 || read.value.ppid < 1) return ok(chain);
    current = read.value.ppid;
  }
  return err({ kind: 'internal', cause: `the process chain of ${pid} is longer than ${MAX_HOPS}` });
}

// True when any process of the chain carries the supervisor signature, and when the chain could not be read.
export function inRunProcessTree(chain: Result<ProcessEntry[]>): boolean {
  if (!chain.ok) return true;
  return chain.value.some((entry) => SUPERVISOR_SIGNATURE.test(entry.command));
}
