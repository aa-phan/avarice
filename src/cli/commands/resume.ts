// avarice resume {onboardingId | runId} [--wait]
// Continues an interrupted onboarding from its committed state. Exit 0 when the project is active, 3 when
// it stopped without activating (blocked, incompatible) or another process holds the lease, 64 for a usage
// error or an unknown ID, 70 for an internal failure.
//
// A `run_` ID continues a run (plan 02-17; FR-7): the command checks that nobody holds a live lease (`lease must expire first`, exit 3, nothing
// changed), prints the state and next action it resumes from and, when an attempt was open, which one was interrupted, then spawns the detached
// supervisor (as `start` does), which takes the lease, reaps what the dead supervisor left running, reconciles, and goes on. `--wait` follows the run
// to where it stops: exit 0 at `ready_for_review`, 3 at any other stop state or when the supervisor died again, 70 when the supervisor could not
// reconcile (a failed reap, for one). A run in a stop state is only reported; no lease is taken. Any other ID takes the Phase 1 onboarding path.
import { describeError } from '../../adapters/sqlite/db.ts';
import { resumeOnboarding } from '../../app/resume.ts';
import { RECONCILE_STEP, resumeRun } from '../../app/run-resume.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, outcomeLines, resultLine, stripControl } from '../render/style.ts';
import { spawnSupervisor, supervisorEnv, waitForRun } from '../spawn-supervisor.ts';
import { renderWait } from './start.ts';

const EXIT_NOT_ACTIVE = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const RUN_ID_PREFIX = 'run_';
const WAIT_MAX_MS = 24 * 60 * 60_000;

export const booleanFlags: readonly string[] = ['wait'];

function usage(io: Io, message: string): number {
  io.err(`${errorLine('resume', message)}\nusage: avarice resume <onboardingId | runId> [--wait]\n`);
  return EXIT_USAGE;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const id = args.positionals[0];
  if (id === undefined || id === '' || args.positionals.length !== 1) return usage(io, 'exactly one onboarding or run ID is required');
  if (id.startsWith(RUN_ID_PREFIX)) return resumeRunCommand(deps, io, id, args.flags['wait'] === true);
  return resumeOnboardingCommand(deps, io, id);
}

async function resumeOnboardingCommand(deps: AppDeps, io: Io, onboardingId: string): Promise<number> {
  const outcome = await resumeOnboarding(deps, onboardingId);
  if (!outcome.ok) {
    const e = outcome.error;
    if (e.kind === 'not_found') {
      io.err(`${errorLine('resume', describeError(e))}\n`);
      return EXIT_USAGE;
    }
    if (e.kind === 'conflict') {
      io.err(`${errorLine('resume', `onboarding ${onboardingId} is held by another process; its lease must expire first (${describeError(e)})`)}\n`);
      return EXIT_NOT_ACTIVE;
    }
    io.err(`${errorLine('resume', `onboarding ${onboardingId} did not finish: ${describeError(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const { state, reason, message } = outcome.value;
  for (const line of outcomeLines(`onboarding ${onboardingId}`, state, reason, message)) io.out(`${line}\n`);
  return state === 'active' ? 0 : EXIT_NOT_ACTIVE;
}

// How many times a supervisor stopped on a reconcile it could not finish, and the latest reason.
function reconcileFailures(deps: AppDeps, runId: string): { count: number; detail: string } {
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return { count: 0, detail: '' };
  const failed = steps.value.filter((s) => s.step === RECONCILE_STEP && s.status === 'failed');
  const last = failed.at(-1)?.result;
  const body = typeof last === 'object' && last !== null ? (last as Record<string, unknown>) : {};
  const detail = [body['error'], body['detail']].filter((x): x is string => typeof x === 'string' && x !== '').join(': ');
  return { count: failed.length, detail };
}

async function resumeRunCommand(deps: AppDeps, io: Io, runId: string, wait: boolean): Promise<number> {
  const decision = resumeRun(deps, runId);
  if (!decision.ok) {
    const e = decision.error;
    if (e.kind === 'not_found') {
      io.err(`${errorLine('resume', `no run ${runId} (${describeError(e)})`)}\n`);
      return EXIT_USAGE;
    }
    if (e.kind === 'conflict') {
      io.err(`${errorLine('resume', `run ${runId} is held by another supervisor; its lease must expire first (${describeError(e)})`)}\n`);
      return EXIT_NOT_ACTIVE;
    }
    io.err(`${errorLine('resume', `run ${runId} cannot be resumed: ${describeError(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const found = decision.value;
  if (found.kind === 'stopped') {
    io.out(`${resultLine(`run ${runId}`, found.run.state, found.run.reason)}\n`);
    return found.run.state === 'ready_for_review' ? 0 : EXIT_NOT_ACTIVE;
  }

  io.out(`${resultLine(`run ${runId}`, `resuming from ${found.run.state}`, found.nextAction === null ? null : `next: ${found.nextAction}`)}\n`);
  if (found.step !== null) io.out(`${found.attemptId === null ? 'interrupted' : `interrupted attempt ${stripControl(found.attemptId)}`} at ${stripControl(found.step)}\n`);

  const failuresBefore = reconcileFailures(deps, runId).count;
  const spawned = spawnSupervisor({ entry: process.argv[1] ?? '', runId, env: supervisorEnv(deps), cwd: deps.profile.dataRoot });
  if (!spawned.ok) {
    io.err(`${errorLine('resume', `run ${runId} was not resumed: ${spawned.message}`)}\n`);
    return EXIT_INTERNAL;
  }
  const nowMs = deps.clock.nowMs();
  const steps = deps.ledger.getRunSteps(runId);
  const attempt = steps.ok ? steps.value.filter((s) => s.step === 'supervisor:resume').length + 1 : 1;
  const recorded = deps.ledger.recordRunStep(runId, { step: 'supervisor:resume', attempt, status: 'completed', result: { pid: spawned.pid }, nowMs, completedAtMs: nowMs });
  if (!recorded.ok) {
    io.err(`${errorLine('resume', `run ${runId} is resumed under supervisor ${spawned.pid} but the spawn step could not be recorded`)}\n`);
    return EXIT_INTERNAL;
  }
  if (!wait) return 0;

  const result = await waitForRun(deps, runId, spawned.pid, { pollMs: 250, maxMs: WAIT_MAX_MS });
  if (result.kind === 'interrupted') {
    // A supervisor that stopped on its own prelude (a reap that failed, a reconcile that could not read git) says so in a failed step: that is a failed
    // resume, not a second kill.
    const failures = reconcileFailures(deps, runId);
    if (failures.count > failuresBefore) {
      io.err(`${errorLine('resume', `run ${runId} could not be resumed: ${failures.detail === '' ? 'the reconcile failed' : failures.detail}`)}\n`);
      return EXIT_INTERNAL;
    }
  }
  io.out(`${renderWait(runId, result).join('\n')}\n`);
  if (result.kind === 'error') return EXIT_INTERNAL;
  return result.kind === 'final' && result.run.state === 'ready_for_review' ? 0 : EXIT_NOT_ACTIVE;
}
