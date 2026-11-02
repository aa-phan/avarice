// Stage for `mapping`: one contained host invocation that writes the codebase map into the staging
// worktree. The step `launch:map` is recorded before the host is called. The host's outcome decides the
// next state; the map itself is judged by validation, never by the outcome.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { InvocationRequest } from '../../ports/agent-host.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import { loadContract, MAP_DIR, stagingPathOf } from './shared.ts';

const MAP_PROMPT = '/gsd-map-codebase';

export const mapStage: Stage = async (ctx: StageContext, row: OnboardingRow): Promise<Result<void>> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;

  const dir = deps.staging.ensureDir(staging.value, MAP_DIR);
  if (!dir.ok) return dir;

  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const attempt = steps.value.filter((s) => s.step === 'launch:map').length + 1;

  const { budgets, execution } = contract.value.body;
  const request: InvocationRequest = {
    onboardingId: row.onboardingId,
    runId: contract.value.runId,
    invocationId: deps.ids.next('inv_'),
    purpose: 'map',
    contractVersion: contract.value.version,
    contractDigest: contract.value.digest,
    prompt: MAP_PROMPT,
    cwd: staging.value,
    model: execution.model,
    costCapUsd: budgets.costUsd.perInvocation,
    wallClockMs: budgets.wallClockShares.map * 60_000,
  };

  const startedMs = deps.clock.nowMs();
  const started = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'launch:map',
    attempt,
    status: 'started',
    result: { invocationId: request.invocationId },
    nowMs: startedMs,
  });
  if (!started.ok) return started;

  const outcome = await deps.host.invoke(request, AbortSignal.timeout(Math.max(request.wallClockMs, 1)));
  if (!outcome.ok) {
    const failed = deps.ledger.recordStepResult(row.onboardingId, {
      step: 'launch:map',
      attempt,
      status: 'failed',
      result: { invocationId: request.invocationId, error: outcome.error.kind },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!failed.ok) return failed;
    return outcome;
  }

  const o = outcome.value;
  const completed = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'launch:map',
    attempt,
    status: 'completed',
    result: {
      invocationId: request.invocationId,
      sessionId: o.sessionId,
      kind: o.kind,
      costUsd: o.costUsd,
      durationMs: o.durationMs,
      headBefore: o.headBefore,
      headAfter: o.headAfter,
      permissionDenials: o.permissionDenials.length,
    },
    nowMs: startedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!completed.ok) return completed;

  const data = { invocationId: request.invocationId, outcome: o.kind, costUsd: o.costUsd };
  switch (o.kind) {
    case 'progressed': {
      const moved = ctx.transition(row, 'validating', 'validate', { data });
      return moved.ok ? ok(undefined) : moved;
    }
    case 'budget_exhausted': {
      ctx.note('the map invocation exhausted its budget');
      const moved = ctx.transition(row, 'blocked', 'none', { reason: 'budget_exhausted', data });
      return moved.ok ? ok(undefined) : moved;
    }
    case 'paused': {
      // Reconciliation of a paused invocation belongs to plan 01-06 and the real host (01-15).
      const moved = ctx.transition(row, 'paused', 'reconcile-invocation', { data });
      return moved.ok ? ok(undefined) : moved;
    }
    case 'denied':
    case 'failed':
    case 'no_progress':
    case 'inconclusive': {
      ctx.note(`the map invocation ended ${o.kind}; a decision is needed`);
      const moved = ctx.transition(row, 'blocked', 'none', { reason: 'decision', data });
      return moved.ok ? ok(undefined) : moved;
    }
    default:
      return err({ kind: 'internal', cause: `unknown invocation outcome ${String(o.kind)}` });
  }
};
