// `resume`: continue an interrupted onboarding from its committed state (docs/contracts-and-state.md
// "Recovery rules"; docs/repository-onboarding.md "Failure and recovery"). The lease is taken over only
// when its expiry has passed, which fences out the previous holder. A run killed while the map invocation
// was in flight is reconciled first: the staging map files decide whether the invocation finished.
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
import { loadContract, readMapDocuments, stagingPathOf } from './stages/shared.ts';

const LAUNCH = 'launch:map';
const VALIDATE = 'validate';

// Decides the fate of the map invocation that was running when the previous holder died, and moves the
// onboarding out of `paused` (`mapping` again, or on to `validating` when the invocation had finished).
function reconcileInvocation(ctx: StageContext): Result<void> {
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
  let finished = false;
  if (invoked) {
    const documents = readMapDocuments(deps.staging, staging.value, contract.value.body);
    if (!documents.ok) return documents;
    const present = new Set(documents.value.map((d) => d.path));
    finished = requiredFilesFor(contract.value.body.mapping.mode).every((path) => present.has(path));
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
  const validating = ctx.transition(resumed.value, 'validating', VALIDATE, { data: { reconciled: true } });
  return validating.ok ? ok(undefined) : validating;
}

export async function resumeOnboarding(deps: AppDeps, onboardingId: string): Promise<Result<OnboardingOutcome>> {
  const found = deps.ledger.getOnboarding(onboardingId);
  if (!found.ok) return found;
  const row = found.value;
  if (isStopState(row.state)) {
    // Nothing to continue: report where it ended without taking the lease.
    return ok({ onboardingId, state: row.state, reason: row.reason, message: null });
  }
  return runOnboarding(deps, onboardingId, { prelude: reconcileInvocation });
}
