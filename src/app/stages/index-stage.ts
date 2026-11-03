// Index steps for `planning_ready`. Each step in INDEX_STEPS runs in order with the checkpoint `index:{name}`
// committed before it and its result stored after it (step `index:{name}`), so a resumed onboarding skips the
// steps that have a result and re-runs the one that was cut short. A missing or failed index is stored as absent
// and never blocks (ONB-13). The last checkpoint names activation, so the kill point `after-checkpoint:activate`
// exists and the record is built only after it.
import { ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import { INDEX_STEPS, indexStepKey } from './index-steps.ts';
import type { IndexStep } from './index-steps.ts';
import type { Stage, StageContext } from './stage.ts';
import { loadContract, stagingPathOf } from './shared.ts';
import type { StoredContract } from './shared.ts';

const MAX_DETAIL = 200;

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);

function describeError(error: PortError): string {
  switch (error.kind) {
    case 'unavailable':
      return error.cause;
    case 'internal':
      return error.cause;
    case 'invalid':
      return `${error.field}: ${error.reason}`;
    default:
      return error.kind;
  }
}

async function runStep(step: IndexStep, ctx: StageContext, row: OnboardingRow, staging: string, head: string, contract: StoredContract): Promise<IndexStepResult> {
  try {
    const ran = await step.run(ctx.deps, { stage: ctx, row, staging, head, contract });
    if (ran.ok) return ran.value;
    // The step could not even report: an index that fails never blocks, so this is an absent index with a reason.
    return { index: step.name, status: 'absent', reason: 'step-error', detail: clip(describeError(ran.error)) };
  } catch (e) {
    return { index: step.name, status: 'absent', reason: 'step-error', detail: clip(e instanceof Error ? e.message : 'threw') };
  }
}

export const indexStage: Stage = async (ctx: StageContext, row: OnboardingRow): Promise<Result<void>> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;
  const head = deps.staging.head(staging.value);
  if (!head.ok) return head;

  const stored = deps.ledger.getStepResults(row.onboardingId);
  if (!stored.ok) return stored;

  for (const step of INDEX_STEPS) {
    const key = indexStepKey(step.name);
    if (stored.value.some((s) => s.step === key && s.status === 'completed')) continue;

    const checkpoint = ctx.checkpoint(key);
    if (!checkpoint.ok) return checkpoint;

    const startedMs = deps.clock.nowMs();
    const outcome = await runStep(step, ctx, row, staging.value, head.value, contract.value);

    if (outcome.status === 'absent') {
      const event = deps.ledger.appendEvent({
        type: 'index.absent',
        level: 'warn',
        runId: contract.value.runId,
        data: {
          onboardingId: row.onboardingId,
          index: outcome.index,
          reason: outcome.reason ?? 'unknown',
          ...(outcome.detail !== undefined ? { detail: clip(outcome.detail) } : {}),
        },
        nowMs: deps.clock.nowMs(),
      });
      if (!event.ok) return event;
    }
    const recorded = deps.ledger.recordStepResult(row.onboardingId, {
      step: key,
      status: 'completed',
      result: outcome,
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!recorded.ok) return recorded;
  }

  const activate = ctx.checkpoint('activate');
  return activate.ok ? ok(undefined) : activate;
};
