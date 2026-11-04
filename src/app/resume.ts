// `resume`: continue an interrupted onboarding from its committed state (docs/contracts-and-state.md
// "Recovery rules"; docs/repository-onboarding.md "Failure and recovery"). The lease is taken over only
// when its expiry has passed, which fences out the previous holder. Every interrupted launch (map, intel and
// knowledge) is reaped in any non-stop state before anything else runs: the host of a killed supervisor is
// detached and may still be writing, so no stage and no relaunch may start beside it. A run killed while the
// map invocation was in flight is then reconciled: the staging map files decide whether the invocation finished.
// Every other stage is idempotent and simply runs again from the committed state.
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isStopState } from '../domain/onboarding-lifecycle.ts';
import { requiredFilesFor } from '../domain/mapping.ts';
import type { OnboardingRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { runOnboarding } from './onboarding-service.ts';
import type { OnboardingOutcome } from './onboarding-service.ts';
import type { StageContext } from './stages/stage.ts';
import { effectiveMappingMode, isStampedMode, loadContract, readMapDocuments, stagingPathOf, stampMap } from './stages/shared.ts';

const LAUNCH = 'launch:map';
const LAUNCH_PREFIX = 'launch:';
const VALIDATE = 'validate';

// Terminates the host process of an interrupted invocation, found by the session ID its `started` step recorded. A
// host that cannot be searched for or ended stops the resume: relaunching beside a survivor is not an option.
async function reapInterrupted(ctx: StageContext, started: unknown, runId: string): Promise<Result<void>> {
  const { deps, onboardingId } = ctx;
  const body = typeof started === 'object' && started !== null ? (started as Record<string, unknown>) : {};
  const sessionId = body['sessionId'];
  if (deps.host.reap === undefined || typeof sessionId !== 'string' || sessionId === '') return ok(undefined);
  const reaped = await deps.host.reap({ sessionId });
  if (!reaped.ok) return reaped;
  if (reaped.value.terminated === 0) return ok(undefined);
  const invocationId = body['invocationId'];
  const event = deps.ledger.appendEvent({
    type: 'invocation.reaped',
    level: 'warn',
    runId,
    ...(typeof invocationId === 'string' ? { invocationId } : {}),
    data: { onboardingId, ...(typeof invocationId === 'string' ? { invocationId } : {}), terminated: reaped.value.terminated },
    nowMs: deps.clock.nowMs(),
  });
  return event.ok ? ok(undefined) : event;
}

// Ends the host of every `launch:{purpose}` step the previous holder left `started`, then marks those steps
// `interrupted`. The previous holder may have died while its host was still running (the host is detached, in its own
// process group). Every reap completes before any row is marked, so a reap that fails leaves every row `started` and the
// next resume tries again; and it runs before staging is read or any stage runs, so nothing writes while the onboarding is
// reconciled and a relaunch never runs beside a survivor (T-01-44). A map launch of a `mapping` or `paused` onboarding is
// left `started` for `reconcileInvocation`, which decides from staging whether that invocation finished.
async function reapStartedLaunches(ctx: StageContext): Promise<Result<void>> {
  const { deps, onboardingId } = ctx;
  const steps = deps.ledger.getStepResults(onboardingId);
  if (!steps.ok) return steps;
  const started = steps.value.filter((s) => s.step.startsWith(LAUNCH_PREFIX) && s.status === 'started');
  if (started.length === 0) return ok(undefined);

  const contract = loadContract(deps, onboardingId);
  if (!contract.ok) return contract;
  const current = deps.ledger.getOnboarding(onboardingId);
  if (!current.ok) return current;

  for (const launch of started) {
    const reaped = await reapInterrupted(ctx, launch.result, contract.value.runId);
    if (!reaped.ok) return reaped;
  }
  const mappingOwned = current.value.state === 'mapping' || current.value.state === 'paused';
  for (const launch of started) {
    if (launch.step === LAUNCH && mappingOwned) continue;
    const marked = deps.ledger.recordStepResult(onboardingId, {
      step: launch.step,
      attempt: launch.attempt,
      status: 'interrupted',
      result: typeof launch.result === 'object' && launch.result !== null ? launch.result : {},
      nowMs: Date.parse(launch.startedAt),
      completedAtMs: deps.clock.nowMs(),
    });
    if (!marked.ok) return marked;
  }
  return ok(undefined);
}

// Decides the fate of the map invocation that was running when the previous holder died, and moves the
// onboarding out of `paused` (`mapping` again, or on to `validating` when the invocation had finished).
async function reconcileInvocation(ctx: StageContext): Promise<Result<void>> {
  const { deps, onboardingId } = ctx;
  let current = deps.ledger.getOnboarding(onboardingId);
  if (!current.ok) return current;
  let row: OnboardingRow = current.value;

  if (row.state === 'mapping') {
    const paused = ctx.transition(row, 'paused', 'reconcile-invocation', { data: { reason: 'interrupted' } });
    if (!paused.ok) return paused;
    row = paused.value;
  }
  if (row.state !== 'paused') return ok(undefined);

  const contract = loadContract(deps, onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;
  const steps = deps.ledger.getStepResults(onboardingId);
  if (!steps.ok) return steps;

  const launches = steps.value.filter((s) => s.step === LAUNCH);
  const validations = steps.value.filter((s) => s.step === VALIDATE);

  // Each mapping round is one launch followed by one validation, so an extra launch is this round's invocation.
  const invoked = launches.length > validations.length;
  const mode = effectiveMappingMode(deps, onboardingId, contract.value.body);
  if (!mode.ok) return mode;
  let finished = false;
  if (invoked) {
    const documents = readMapDocuments(deps.staging, staging.value, mode.value);
    if (!documents.ok) return documents;
    const present = new Set(documents.value.map((d) => d.path));
    finished = requiredFilesFor(mode.value).every((path) => present.has(path));
  }

  const latest = launches.at(-1);
  if (latest !== undefined && latest.status === 'started') {
    const marked = deps.ledger.recordStepResult(onboardingId, {
      step: LAUNCH,
      attempt: latest.attempt,
      status: finished ? 'reconciled' : 'interrupted',
      result: typeof latest.result === 'object' && latest.result !== null ? latest.result : {},
      nowMs: Date.parse(latest.startedAt),
      completedAtMs: deps.clock.nowMs(),
    });
    if (!marked.ok) return marked;
  }

  const resumed = ctx.transition(row, 'mapping', LAUNCH, { data: { reconciled: finished } });
  if (!resumed.ok) return resumed;
  if (!finished) return ok(undefined);

  const invocationId = latest !== undefined && typeof latest.result === 'object' && latest.result !== null ? (latest.result as Record<string, unknown>)['invocationId'] : undefined;
  const event = deps.ledger.appendEvent({
    type: 'invocation.reconciled',
    runId: contract.value.runId,
    data: { onboardingId, attempt: latest?.attempt ?? 0, ...(typeof invocationId === 'string' ? { invocationId } : {}) },
    nowMs: deps.clock.nowMs(),
  });
  if (!event.ok) return event;
  // The interrupted invocation was a fast or full map: it still owes its AVARICE-run stamp.
  if (isStampedMode(mode.value)) {
    const stamped = await stampMap(deps, onboardingId, staging.value, mode.value);
    if (!stamped.ok) return stamped;
  }
  const validating = ctx.transition(resumed.value, 'validating', VALIDATE, { data: { reconciled: true } });
  return validating.ok ? ok(undefined) : validating;
}

// What resume runs under the lease before the stage loop: reap first, then reconcile the map invocation.
async function reconcileOnResume(ctx: StageContext): Promise<Result<void>> {
  const reaped = await reapStartedLaunches(ctx);
  if (!reaped.ok) return reaped;
  return reconcileInvocation(ctx);
}

export async function resumeOnboarding(deps: AppDeps, onboardingId: string): Promise<Result<OnboardingOutcome>> {
  const found = deps.ledger.getOnboarding(onboardingId);
  if (!found.ok) return found;
  const row = found.value;
  if (isStopState(row.state)) {
    // Nothing to continue: report where it ended without taking the lease.
    return ok({ onboardingId, state: row.state, reason: row.reason, message: null });
  }
  return runOnboarding(deps, onboardingId, { prelude: reconcileOnResume });
}
