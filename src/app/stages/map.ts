// Stage for `mapping`: one contained host invocation that writes the codebase map into the staging
// worktree, in the mode the workspace stage planned (`mapping:plan`): `skip` invokes nothing, `fast` runs
// `/gsd-map-codebase --fast` and is then stamped by AVARICE, `full` runs `/gsd-map-codebase`. This file writes no
// map document itself (ONB-2). The step `launch:map` is recorded before the host is called. The host's outcome
// decides the next state; the map itself is judged by validation, never by the outcome.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import type { MappingMode } from '../../domain/mapping.ts';
import { loadContract, loadMappingPlan, stagingPathOf, stampFastMap, stopIncompatible } from './shared.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import { requiredFilesFor } from '../../domain/mapping.ts';
import { completeInvocation, prepareInvocation } from '../invocation.ts';

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

  // Reserve the invocation and prepare its request (scope, session ID, step `launch:map` recorded as started).
  const prepared = prepareInvocation(deps, row, 'map', promptFor(mode, plan.value?.existingMapAnswer), { expectedFiles: [...requiredFilesFor(mode)] });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) {
    ctx.note(`the ${prepared.value.budget} budget is exhausted, so no map invocation was started`);
    const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'budget_exhausted', data: { budget: prepared.value.budget } });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const { request } = prepared.value.prepared;

  const invoked = await deps.host.invoke(request, AbortSignal.timeout(Math.max(request.wallClockMs, 1)));
  // Settle first, whatever happened: the invocation ran, so its unit, its time and its cost are spent.
  const outcome = completeInvocation(deps, prepared.value.prepared, invoked);
  if (!outcome.ok) {
    const e = outcome.error;
    if (e.kind === 'denied' && e.rule.startsWith('enforcement_failure')) {
      // The host refused to start without a containment layer (settings, hook, sandbox, host version): nothing ran.
      ctx.note(`the host refused to start the map invocation: ${e.rule}`);
      const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'enforcement_failure', data: { invocationId: request.invocationId, rule: e.rule.slice(0, 200) } });
      return blocked.ok ? ok(undefined) : blocked;
    }
    return outcome;
  }

  const o = outcome.value;
  // A staging HEAD that moved during the invocation is a containment finding: the host may not move the branch.
  if (o.details?.headMoved === true) {
    const finding = deps.ledger.appendEvent({
      type: 'containment.finding',
      level: 'warn',
      runId: request.runId,
      invocationId: request.invocationId,
      data: { onboardingId: row.onboardingId, invocationId: request.invocationId, check: 'staging-head-moved' },
      nowMs: deps.clock.nowMs(),
    });
    if (!finding.ok) return finding;
  }
  // A fast map is stamped by AVARICE after the invocation, whether or not the mapper made progress (validation
  // judges the files; the stamp only has to be there for the files that exist).
  if (mode === 'fast' && (o.kind === 'progressed' || o.kind === 'no_progress' || o.kind === 'inconclusive')) {
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
    case 'inconclusive': {
      // An unknown ending (the wall clock, a missing result) is judged by what is in staging: validation accepts a
      // complete map and otherwise the retry rule applies (docs/operations-and-testing.md "retry once for
      // inconclusive endings"). A `denied` ending is never retried.
      ctx.note('the map invocation ended inconclusive; the staging map is validated');
      const moved = ctx.transition(row, 'validating', 'validate', { data });
      return moved.ok ? ok(undefined) : moved;
    }
    case 'denied':
    case 'failed':
    case 'no_progress': {
      ctx.note(`the map invocation ended ${o.kind}; a decision is needed`);
      const moved = ctx.transition(row, 'blocked', 'none', { reason: 'decision', data });
      return moved.ok ? ok(undefined) : moved;
    }
    default:
      return err({ kind: 'internal', cause: `unknown invocation outcome ${String(kind)}` });
  }
};
