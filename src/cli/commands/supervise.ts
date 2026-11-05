// avarice supervise <runId>
// The supervisor of one run: `start` spawns it detached (D-18), and an operator can start it by hand to continue a run. It takes the
// run lease, runs the checkpointed stages until the run stops, and releases the lease. Exit 0 when the run is `ready_for_review`,
// 3 for any other stop state, a state with no stage yet, or a lease another supervisor still holds, 64 for a usage error or an
// unknown run, 70 for an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { runSupervisor } from '../../app/run-service.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, resultLine, stripControl } from '../render/style.ts';

const EXIT_NOT_READY = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

const USAGE = 'usage: avarice supervise <runId>';

export const booleanFlags: readonly string[] = [];

// Checked before the profile is resolved, so a usage error leaves nothing on disk.
export function usage(args: ParsedArgs): string | undefined {
  if (args.positionals.length !== 1 || args.positionals[0] === '') return `exactly one run ID is required\n${USAGE}`;
  return undefined;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const runId = args.positionals[0];
  if (runId === undefined) {
    io.err(`${errorLine('supervise', usage(args) ?? USAGE)}\n`);
    return EXIT_USAGE;
  }
  const outcome = await runSupervisor(deps, runId);
  if (!outcome.ok) {
    const e = outcome.error;
    if (e.kind === 'not_found') {
      io.err(`${errorLine('supervise', `no run ${runId} (${describeError(e)})`)}\n`);
      return EXIT_USAGE;
    }
    if (e.kind === 'conflict') {
      io.err(`${errorLine('supervise', `run ${runId} is held by another supervisor; its lease must expire first (${describeError(e)})`)}\n`);
      return EXIT_NOT_READY;
    }
    io.err(`${errorLine('supervise', `run ${runId} did not finish: ${describeError(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const { state, reason, message } = outcome.value;
  io.out(`${resultLine(`run ${runId}`, state, reason)}\n`);
  if (message !== null) io.out(`${stripControl(message)}\n`);
  return state === 'ready_for_review' ? 0 : EXIT_NOT_READY;
}
