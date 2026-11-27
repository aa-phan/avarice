// Stage for `mapping`: one contained host invocation that writes the codebase map into the staging
// worktree, in the mode the workspace stage planned (`mapping:plan`): `skip` and `adopt` invoke nothing (an adopted map is already in
// staging, committed at the pin), `fast` runs `/gsd-map-codebase --fast`, `paths` runs `/gsd-map-codebase --paths <p1,p2>`, `full` runs
// `/gsd-map-codebase`; these maps are then stamped by AVARICE. This file writes no
// map document itself (ONB-2). The step `launch:map` is recorded before the host is called. The host's outcome
// decides the next state; the map itself is judged by validation, never by the outcome.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import type { MappingMode } from '../../domain/mapping.ts';
import { hostOfOnboarding, isStampedMode, loadContract, loadMappingPlan, stagingPathOf, stampMap, stopIncompatible } from './shared.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import { isScopePath, requiredFilesFor, restrictedMapPrompt, withMapperSecretsRule } from '../../domain/mapping.ts';
import { RESTRICTED_SPEC_SEEDS } from '../../domain/restricted-specs.ts';
import type { AgentHost } from '../../ports/agent-host.ts';
import { completeInvocation, onboardingGsdDirs, prepareInvocation } from '../invocation.ts';

const MAP_PROMPT = '/gsd-map-codebase';
const FAST_MAP_PROMPT = '/gsd-map-codebase --fast';

const MAX_PATHS = 50;

// The scope of a `paths` map, checked again where it becomes part of the mapper's prompt (T-04-27): the stored list is data from the ledger.
function scopeOf(paths: readonly string[] | undefined): Result<string[]> {
  if (paths === undefined || paths.length === 0 || paths.length > MAX_PATHS || !paths.every(isScopePath)) {
    return err({ kind: 'internal', cause: 'the stored mapping plan has no valid path scope for a paths map' });
  }
  return ok([...paths]);
}

// The mapper is asked GSD's own question about an existing map up front, with the contract's answer. The path scope is one comma-separated
// value of `--paths`; every path was validated to plain characters, so no path can end the value or start another option.
export function promptFor(mode: MappingMode, existingMapAnswer: string | undefined, paths: readonly string[] = []): string {
  const base = mode === 'fast' ? FAST_MAP_PROMPT : mode === 'paths' ? `${MAP_PROMPT} --paths ${paths.join(',')}` : MAP_PROMPT;
  if (existingMapAnswer === undefined) return withMapperSecretsRule(base);
  const label = existingMapAnswer.charAt(0).toUpperCase() + existingMapAnswer.slice(1);
  return withMapperSecretsRule(`${base}\nIf .planning/codebase already exists, answer the question about it with: ${label}.`);
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
  if (mode === 'skip' || mode === 'adopt') {
    // Nothing to map (not brownfield, skipped on request, or an existing map adopted after GSD's drift check passed in staging): no
    // invocation and no budget, straight to validation, which judges the adopted files like any other.
    ctx.note(mode === 'adopt' ? 'existing map adopted: no invocation' : 'mapping skipped: no invocation');
    const moved = ctx.transition(row, 'validating', 'validate', { data: { mode } });
    return moved.ok ? ok(undefined) : moved;
  }
  let scope: string[] = [];
  if (mode === 'paths') {
    const checked = scopeOf(plan.value?.paths);
    if (!checked.ok) return checked;
    scope = checked.value;
  }

  // A restricted onboarding (plan 04-24; CON-4, D-12) reaches only the restricted host, and only while that host can start: it is judged again here, before a unit of budget is
  // reserved, because the environment may have changed since the workspace stage. Nothing falls back to the contained host.
  const host = hostOfOnboarding(deps, plan.value);
  if (plan.value?.restricted === true) {
    const attributes = host?.descriptor.attributes ?? {};
    if (host === undefined || attributes['enforcement'] !== 'restricted') {
      const cause = host === undefined ? 'no restricted host is composed' : String(attributes['reason'] ?? 'the restricted host is not ready').slice(0, 200);
      ctx.note(`restricted mode is not available: ${cause}; no map invocation was started`);
      const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'enforcement_failure', data: { host: 'restricted', enforcement: 'none', reason: cause } });
      return blocked.ok ? ok(undefined) : blocked;
    }
  }
  if (host === undefined) return err({ kind: 'internal', cause: 'no host is composed' });

  // The restricted host has no shell and confines the file tools to the working directory (plan 04-34, owner ruling (a) after the second D-04 stop), so the GSD specs
  // the fast map reads are staged read-only into the staging copy, from the gsd-core directory GSD's inspect recorded (the source of the invocation's read roots),
  // and the prompt names them there. Staging happens before a unit of budget is reserved, and the staged files are taken out again whatever the invocation does, so
  // validation, the activation scope check, the record and promotion never see them. A contained onboarding stages nothing.
  const prompt = promptFor(mode, plan.value?.existingMapAnswer, scope);
  if (plan.value?.restricted !== true) return launchMap(ctx, row, host, mode, prompt, staging.value);

  const dirs = onboardingGsdDirs(deps, row.onboardingId);
  if (!dirs.ok) return dirs;
  const staged = deps.staging.stageGsdSpecs(staging.value, { gsdCoreDir: dirs.value.gsdCoreDir, seeds: RESTRICTED_SPEC_SEEDS });
  if (!staged.ok) {
    const e = staged.error;
    if (e.kind !== 'conflict' && e.kind !== 'denied' && e.kind !== 'not_found' && e.kind !== 'invalid') return staged;
    // The repository holds its own `.claude/gsd-core`, a link is in the way, or GSD lacks a spec: a person decides, and no host is started.
    ctx.note(`restricted mode could not stage GSD's workflow specs into the staging copy (${e.kind}); no map invocation was started`);
    const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'decision', data: { stage: 'restricted-specs', cause: e.kind } });
    return blocked.ok ? ok(undefined) : blocked;
  }
  ctx.note(`restricted map: ${String(staged.value.files.length)} GSD spec file(s) staged read-only in the staging copy`);
  const unstage = (): void => {
    const removed = deps.staging.unstageGsdSpecs(staging.value);
    if (!removed.ok) {
      // The scope checks would report a leftover as a write outside the write sets; the finding says why.
      deps.ledger.appendEvent({
        type: 'containment.finding',
        level: 'warn',
        runId: contract.value.runId,
        data: { onboardingId: row.onboardingId, check: 'staged-specs-not-removed', cause: removed.error.kind },
        nowMs: deps.clock.nowMs(),
      });
    }
  };
  try {
    return await launchMap(ctx, row, host, mode, restrictedMapPrompt(prompt, staged.value.root), staging.value, unstage);
  } finally {
    unstage();
  }
};

// One map invocation in the staging copy: reserve it, start the host, settle, and move the onboarding to what the outcome decides. `release` runs the moment the host
// has returned, before the outcome moves the onboarding on, so no stage after the map can see what the map stage staged (it runs again, harmlessly, if the map stage ends
// any other way).
async function launchMap(ctx: StageContext, row: OnboardingRow, host: AgentHost, mode: MappingMode, prompt: string, staging: string, release: () => void = () => undefined): Promise<Result<void>> {
  const { deps } = ctx;
  // Reserve the invocation and prepare its request (scope, session ID, step `launch:map` recorded as started).
  const prepared = prepareInvocation(deps, row, 'map', prompt, { expectedFiles: [...requiredFilesFor(mode)] });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) {
    ctx.note(`the ${prepared.value.budget} budget is exhausted, so no map invocation was started`);
    const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'budget_exhausted', data: { budget: prepared.value.budget } });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const { request } = prepared.value.prepared;

  const invoked = await host.invoke(request, AbortSignal.timeout(Math.max(request.wallClockMs, 1)));
  release();
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
  // A fast or full map is stamped by AVARICE after the invocation, whether or not the mapper made progress (validation
  // judges the files; the stamp only has to be there for the files that exist).
  if (isStampedMode(mode) && (o.kind === 'progressed' || o.kind === 'no_progress' || o.kind === 'inconclusive')) {
    const stamped = await stampMap(deps, row.onboardingId, staging, mode);
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
}
