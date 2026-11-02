// Stage for `mapping`: one contained host invocation that writes the codebase map into the staging
// worktree, in the mode the workspace stage planned (`mapping:plan`): `skip` invokes nothing, `fast` runs
// `/gsd-map-codebase --fast` and is then stamped by AVARICE, `full` runs `/gsd-map-codebase`. This file writes no
// map document itself (ONB-2). The step `launch:map` is recorded before the host is called. The host's outcome
// decides the next state; the map itself is judged by validation, never by the outcome.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { InvocationRequest } from '../../ports/agent-host.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import type { MappingMode } from '../../domain/mapping.ts';
import { loadContract, loadMappingPlan, MAP_DIR, stagingPathOf, stampFastMap, stopIncompatible } from './shared.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import { reserveInvocation, settleInvocation } from '../budget.ts';

const MAP_PROMPT = '/gsd-map-codebase';
const FAST_MAP_PROMPT = '/gsd-map-codebase --fast';

// The mapper is asked GSD's own question about an existing map up front, with the contract's answer.
function promptFor(mode: MappingMode, existingMapAnswer: string | undefined): string {
  const base = mode === 'fast' ? FAST_MAP_PROMPT : MAP_PROMPT;
  if (existingMapAnswer === undefined) return base;
  const label = existingMapAnswer.charAt(0).toUpperCase() + existingMapAnswer.slice(1);
  return `${base}\nIf .planning/codebase already exists, answer the question about it with: ${label}.`;
}

export const mapStage: Stage = async (ctx: StageContext, row: OnboardingRow): Promise<Result<void>> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;
  if (deps.gsd === undefined) {
    return stopIncompatible(ctx, row, deps.gsdProblem?.found ?? 'no gsd-core', deps.gsdProblem?.admitted ?? `${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}`);
  }

  const plan = loadMappingPlan(deps, row.onboardingId);
  if (!plan.ok) return plan;
  const mode: MappingMode = plan.value?.mode ?? contract.value.body.mapping.mode;
  if (mode === 'skip') {
    // Nothing to map (not brownfield, or skipped on request): no invocation, straight to validation.
    ctx.note('mapping skipped: no invocation');
    const moved = ctx.transition(row, 'validating', 'validate', { data: { mode } });
    return moved.ok ? ok(undefined) : moved;
  }

  const dir = deps.staging.ensureDir(staging.value, MAP_DIR);
  if (!dir.ok) return dir;

  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const attempt = steps.value.filter((s) => s.step === 'launch:map').length + 1;

  // Reserve the invocation before anything is launched: with no invocation, wall clock or cost left the
  // onboarding ends blocked (budget_exhausted) and the host is never called (ONB-8, CON-13).
  const reserved = reserveInvocation(deps, row, 'map');
  if (!reserved.ok) return reserved;
  if (!reserved.value.granted) {
    ctx.note(`the ${reserved.value.budget} budget is exhausted, so no map invocation was started`);
    const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'budget_exhausted', data: { budget: reserved.value.budget } });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const reservation = reserved.value.reservation;

  const { execution } = contract.value.body;
  const request: InvocationRequest = {
    onboardingId: row.onboardingId,
    runId: contract.value.runId,
    invocationId: deps.ids.next('inv_'),
    purpose: 'map',
    contractVersion: contract.value.version,
    contractDigest: contract.value.digest,
    prompt: promptFor(mode, plan.value?.existingMapAnswer),
    cwd: staging.value,
    model: execution.model,
    costCapUsd: reservation.costCapUsd,
    wallClockMs: reservation.wallClockMs,
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
  // Settle first, whatever happened: the invocation ran, so its unit, its time and its cost are spent.
  const settled = settleInvocation(deps, reservation, {
    durationMs: outcome.ok ? outcome.value.durationMs : deps.clock.nowMs() - startedMs,
    costUsd: outcome.ok ? outcome.value.costUsd : 0,
  });
  if (!settled.ok) return settled;
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

  // A fast map is stamped by AVARICE after the invocation, whether or not the mapper made progress (validation
  // judges the files; the stamp only has to be there for the files that exist).
  if (mode === 'fast' && (o.kind === 'progressed' || o.kind === 'no_progress')) {
    const stamped = await stampFastMap(deps, row.onboardingId, staging.value);
    if (!stamped.ok) return stamped;
  }

  // A hook denial for budget_exhausted during the invocation ends the onboarding the same way as the host
  // reporting it: the run cannot continue on a budget that is spent.
  const denials = deps.ledger.countBudgetDenials(request.runId, request.invocationId);
  if (!denials.ok) return denials;
  const kind = denials.value > 0 ? 'budget_exhausted' : o.kind;
  const data = { invocationId: request.invocationId, outcome: kind, costUsd: o.costUsd };
  switch (kind) {
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
      return err({ kind: 'internal', cause: `unknown invocation outcome ${String(kind)}` });
  }
};
