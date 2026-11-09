// avarice cancel <runId> [--wait]
// Cancels a run in any non-terminal state (plan 03-24; AUT-12, owner decision 3 of 2026-11-08). With nobody holding the run lease it ends any host the run left
// running, withdraws every open decision (reason `cancel`) and moves the run to `cancelled`. With a supervisor holding the lease it records a cancel request: the
// supervisor stops the unit in flight and cancels at its next check, and the command returns at once, or with `--wait` follows the run to `cancelled`. The run clone
// and its branch are kept for inspection and nothing in the user's checkout is touched (S-20); `cancelled` is terminal, so `resume` only reports it stopped.
//
// Like `decide`, it refuses inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run, before the profile is
// resolved, so a refusal creates nothing (CS-11), and then for a profile that is not the user's own. Exit 0 cancelled or requested; 3 a run that has ended already, or a
// `--wait` that did not reach `cancelled`; 64 a usage error, an unknown run or a refusal; 70 an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { cancelRun, completeCancel } from '../../app/cancel.ts';
import type { AppDeps } from '../../app/deps.ts';
import { isRunTerminal } from '../../domain/run-lifecycle.ts';
import type { PortError } from '../../domain/result.ts';
import type { RunRow } from '../../ports/ledger.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { ownsProfile, refuseOutsideTerminal, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, resultLine } from '../render/style.ts';

const EXIT_NOT_CANCELLED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const RUN_ID = /^run_[0-9A-Za-z]{4,64}$/;
const WAIT_MAX_MS = 24 * 60 * 60_000;
const WAIT_POLL_MS = 200;
const USAGE = 'usage: avarice cancel <runId> [--wait]';

export const booleanFlags: readonly string[] = ['wait'];

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk: no data root, no store, no row, no event (CS-11).
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = context === undefined ? 'needs an interactive terminal' : refuseOutsideTerminal(env, context);
  if (refused !== undefined) return refused;
  const id = args.positionals[0];
  if (id === undefined || args.positionals.length !== 1) return `exactly one run ID is required\n${USAGE}`;
  if (!RUN_ID.test(id)) return `a run ID (run_...) is required\n${USAGE}`;
  return undefined;
}

const withdrawnText = (n: number): string => `${n} decision${n === 1 ? '' : 's'} withdrawn`;

const leaseIsLive = (run: RunRow, nowMs: number): boolean => run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fail(deps: AppDeps, io: Io, runId: string, error: PortError): number {
  switch (error.kind) {
    case 'not_found':
      io.err(`${errorLine('cancel', `no run ${runId} (${describeError(error)})`)}\n`);
      return EXIT_USAGE;
    case 'invalid':
      io.err(`${errorLine('cancel', describeError(error))}\n`);
      return EXIT_USAGE;
    case 'conflict': {
      // A run that has ended cannot be cancelled: say which end it reached.
      const read = deps.ledger.getRun(runId);
      io.err(`${errorLine('cancel', read.ok && isRunTerminal(read.value.state) ? `run ${runId} is already ${read.value.state}` : `not applied: ${describeError(error)}`)}\n`);
      return EXIT_NOT_CANCELLED;
    }
    default:
      io.err(`${errorLine('cancel', `run ${runId} was not cancelled: ${describeError(error)}`)}\n`);
      return EXIT_INTERNAL;
  }
}

// After a request a supervisor holds: follow the run to `cancelled`. A supervisor that died with the request standing leaves the run with no live lease, and the
// command finishes the cancel itself.
async function waitForCancel(deps: AppDeps, io: Io, runId: string): Promise<number> {
  const giveUpAt = Date.now() + WAIT_MAX_MS;
  for (;;) {
    const read = deps.ledger.getRun(runId);
    if (!read.ok) return fail(deps, io, runId, read.error);
    const run = read.value;
    if (isRunTerminal(run.state)) {
      io.out(`${resultLine(`run ${runId}`, run.state)}\n`);
      return run.state === 'cancelled' ? 0 : EXIT_NOT_CANCELLED;
    }
    if (!leaseIsLive(run, deps.clock.nowMs())) {
      const done = await completeCancel(deps, runId);
      if (!done.ok) return fail(deps, io, runId, done.error);
      if (done.value.kind === 'cancelled') {
        io.out(`${resultLine(`run ${runId}`, 'cancelled')}\n`);
        return 0;
      }
    }
    if (Date.now() >= giveUpAt) {
      io.err(`${errorLine('cancel', `run ${runId} was still not cancelled after the wait`)}\n`);
      return EXIT_NOT_CANCELLED;
    }
    await pause(WAIT_POLL_MS);
  }
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const runId = args.positionals[0] as string;
  // Only the user who owns the profile cancels a run; the others are refused without a write.
  if (!ownsProfile(deps.profile.dataRoot)) {
    io.err(`${errorLine('cancel', 'only the user who owns the profile cancels a run')}\n`);
    return EXIT_USAGE;
  }
  // usage() has already refused AVARICE_RUN, a pipe and a run's process tree, and the profile was just shown to be the user's own.
  const result = await cancelRun(deps, runId, responderName(), deps.clock.nowMs());
  if (!result.ok) return fail(deps, io, runId, result.error);
  if (result.value.kind === 'cancelled') {
    io.out(`${resultLine(`run ${runId}`, 'cancelled')}; ${withdrawnText(result.value.withdrawn)}\n`);
    return 0;
  }
  io.out(`${resultLine(`run ${runId}`, 'cancel requested')}\n`);
  if (args.flags['wait'] !== true) return 0;
  return waitForCancel(deps, io, runId);
}
