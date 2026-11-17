// Stage for `contract_proposed`: prepare the staging workspace at the pin, then at the `configure-gsd`
// checkpoint probe GSD (`init onboard`), decide the mapping mode and configure GSD, all by AVARICE and all with
// cwd = staging, before any host invocation (ONB-2, ONB-5; config-set cannot run inside the sandbox, research
// Pitfall 5). Then verify enforcement and move to `mapping`, or block with `enforcement_failure` when the host
// cannot enforce containment (ONB-12, CON-3). Each checkpoint names the action that follows it and is
// committed before that action runs.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { chooseMappingMode } from '../../domain/mapping.ts';
import { requireCapabilities } from '../capabilities.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import type { GsdSetting } from '../../ports/gsd-onboarding.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import { existingMapOutcome } from '../../domain/preflight.ts';
import type { ExistingMapClass, ExistingMapOutcome } from '../../domain/preflight.ts';
import { FULL_REMAP_DRIFT_THRESHOLD, planRefresh } from '../../domain/refresh-plan.ts';
import type { RefreshPlan } from '../../domain/refresh-plan.ts';
import { driftOf, refreshFacts, refreshOfPreflight } from '../refresh.ts';
import type { DriftFinding, RefreshOf } from '../refresh.ts';
import type { Stage, StageContext } from './stage.ts';
import { loadContract, stopIncompatible } from './shared.ts';

// ONB-5: commits stay off (GSD's own `query commit` then skips), and the settings the mapping workflows read.
export const STAGING_GSD_SETTINGS: readonly GsdSetting[] = [
  ['commit_docs', 'false'],
  ['workflow.text_mode', 'true'],
  ['intel.enabled', 'true'],
  ['graphify.enabled', 'true'],
];

const EXISTING_MAP_CLASSES: readonly string[] = ['none', 'stamped-complete', 'stamped-partial', 'unstamped', 'unknown-format', 'user-edited'];

function existingMapOf(preflight: unknown): ExistingMapClass {
  const state = typeof preflight === 'object' && preflight !== null ? (preflight as Record<string, unknown>)['existingState'] : undefined;
  const value = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['codebaseMap'] : undefined;
  return typeof value === 'string' && EXISTING_MAP_CLASSES.includes(value) ? (value as ExistingMapClass) : 'none';
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const MAX_RECORDED_CHANGED = 200;

// The refresh plan of a map the repository already has (ONB-11) and the facts it rests on, as `mapping:plan` records them. The planner is
// `planRefresh`; a git read that fails (a revision git cannot resolve, a diff past the bound) plans a full map and says why.
interface RefreshDecision {
  plan: RefreshPlan;
  record: Record<string, unknown>;
}

function decideRefresh(ctx: StageContext, stagingPath: string, toRevision: string, refreshOf: RefreshOf | null, drift: DriftFinding | null): RefreshDecision | null {
  // A first onboarding of a repository whose map has no drift question (not a complete stamped map) has nothing to refresh.
  if (refreshOf === null && drift === null) return null;
  // The active record's revision, else the stamp of the map the repository already has.
  const fromRevision = refreshOf?.onboardedRevision ?? drift?.lastMappedCommit ?? null;
  const basis = {
    ...(refreshOf !== null ? { fromRecordVersion: refreshOf.recordVersion } : {}),
    fromRevision,
    toRevision,
    threshold: FULL_REMAP_DRIFT_THRESHOLD,
    drift: drift?.verdict ?? null,
  };
  const full = (reason: string): RefreshDecision => ({ plan: { mode: 'full', reason }, record: { ...basis, mode: 'full', reason } });
  if (fromRevision === null || !COMMIT_SHA.test(fromRevision)) return full('no-stamp: no revision to measure the changes from');
  const facts = refreshFacts(ctx.deps, stagingPath, { fromRevision, toRevision, drift });
  if (!facts.ok) return full(`changed-paths-unavailable: ${facts.error.kind}`);
  const plan = planRefresh(facts.value, { threshold: FULL_REMAP_DRIFT_THRESHOLD });
  return {
    plan,
    record: {
      ...basis,
      mode: plan.mode,
      ...(plan.scope !== undefined ? { scope: plan.scope } : {}),
      reason: plan.reason,
      newTopLevelDirs: [...facts.value.newTopLevelDirs],
      changedPathCount: facts.value.changedPaths.length,
      changedPaths: facts.value.changedPaths.slice(0, MAX_RECORDED_CHANGED),
      manifestChanged: facts.value.manifestChanged,
    },
  };
}

// What the workspace stage records as the outcome for the map the repository has. The class and GSD's drift verdict give it (`existingMapOutcome`);
// the refresh plan overrides it for a complete stamped map, whose drift verdict alone cannot say that a manifest change or new directories make a
// `pass` or a `block` a full remap: incremental is `adopt`, an unreadable drift stays `full-in-staging`, and every other plan is `refresh`.
function outcomeOf(existingMap: ExistingMapClass, drift: DriftFinding | null, refresh: RefreshDecision | null): ExistingMapOutcome {
  const byClass = existingMapOutcome(existingMap, drift?.verdict ?? null);
  if (refresh === null || existingMap !== 'stamped-complete') return byClass;
  if (refresh.plan.mode === 'incremental') return 'adopt';
  return drift?.verdict === 'unreadable' || drift === null ? byClass : 'refresh';
}

export const workspaceStage: Stage = async (ctx: StageContext, row: OnboardingRow): Promise<Result<void>> => {
  const { deps } = ctx;
  // No admitted GSD, no staging (the contract stage stops earlier; this covers a resume in a changed environment).
  const gsd = deps.gsd;
  if (gsd === undefined) {
    return stopIncompatible(ctx, row, deps.gsdProblem?.found ?? 'no gsd-core', deps.gsdProblem?.admitted ?? `${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}`);
  }
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;

  const project = deps.ledger.findProject({ projectId: row.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'not_found', ref: `project ${row.projectId}` });

  const first = ctx.checkpoint('prepare-workspace');
  if (!first.ok) return first;
  const prepared = deps.staging.prepare({
    repoPath: project.value.repoPath,
    workRoot: deps.profile.workRoot,
    onboardingId: row.onboardingId,
    pin: contract.value.body.workspace.baseRevision,
  });
  if (!prepared.ok) return prepared;

  const configure = ctx.checkpoint('configure-gsd', { stagingWorktree: prepared.value.path });
  if (!configure.ok) return configure;

  // Probe (the projection can rewrite staging `.planning/config.json`), decide the mode, configure. Every step is
  // idempotent, so a kill anywhere in here simply repeats the whole block on resume.
  const stagingPath = prepared.value.path;
  const probeStartedMs = deps.clock.nowMs();
  const probe = await gsd.probeState(stagingPath);
  if (!probe.ok) return probe;
  const probed = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'gsd:probe',
    status: 'completed',
    result: probe.value,
    nowMs: probeStartedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!probed.ok) return probed;

  // A complete stamped map is adopted only when GSD's drift check, run here in staging (never in the user's checkout), passes. No other class
  // has a drift question: the others are regenerated in staging whatever the drift is (docs "Repositories already using GSD").
  const existingMap = existingMapOf(row.preflight);
  const drift = existingMap === 'stamped-complete' ? await driftOf(gsd, stagingPath) : null;
  // ONB-11: a map with a drift question, or any map of an active project (the onboarding is then a refresh of its record), is planned by how much
  // changed since the revision it describes: incremental, path-scoped or full.
  const refresh = decideRefresh(ctx, stagingPath, contract.value.body.workspace.baseRevision, refreshOfPreflight(row.preflight), drift);
  const outcome = outcomeOf(existingMap, drift, refresh);
  const decision = chooseMappingMode({
    isBrownfield: probe.value.isBrownfield,
    requested: contract.value.body.mapping.mode,
    existingMap,
    outcome,
    readScope: contract.value.body.files.read,
    ...(refresh !== null ? { refresh: refresh.plan } : {}),
  });
  if (!decision.ok) {
    if (decision.error.kind !== 'unsupported') return decision;
    ctx.note(`mapping mode ${contract.value.body.mapping.mode} is not available: ${decision.error.detail ?? decision.error.capability}`);
    const blocked = ctx.transition(row, 'blocked', 'none', {
      reason: 'scope_unavailable',
      data: { capability: decision.error.capability, ...(decision.error.reducedMode !== undefined ? { reducedMode: decision.error.reducedMode } : {}) },
    });
    return blocked.ok ? ok(undefined) : blocked;
  }
  // FR-16: the mapping the decision chose needs what the admitted GSD declares; a step whose capability is missing stops here, before staging
  // is configured or any host starts, naming the capability and the reduced mode. Nothing is simulated.
  const capable = requireCapabilities(deps, `onboarding.map.${decision.value.mode}`);
  if (!capable.ok) {
    if (capable.error.kind !== 'unsupported') return capable;
    ctx.note(`mapping mode ${decision.value.mode} is not available: ${capable.error.capability}${capable.error.reducedMode !== undefined ? `; reduced mode: ${capable.error.reducedMode}` : ''}`);
    const blocked = ctx.transition(row, 'blocked', 'none', {
      reason: 'scope_unavailable',
      data: { capability: capable.error.capability, ...(capable.error.reducedMode !== undefined ? { reducedMode: capable.error.reducedMode } : {}) },
    });
    return blocked.ok ? ok(undefined) : blocked;
  }
  // The contract's answer to GSD's "map already exists" question, always passed to the mapper. Staging holds
  // `.planning/codebase` when the mapper starts even for a repository with no map, because AVARICE creates the
  // directory empty before the launch (prepareInvocation), and GSD's workflow reads an existing directory as an
  // existing map and asks; a headless session cannot answer (found by the live exit rehearsal, plan 01-19).
  const answer = contract.value.body.decisions.defaults.find((d) => d.class === 'existing-map')?.default;
  const plan = {
    mode: decision.value.mode,
    completeness: decision.value.completeness,
    existingMap,
    outcome: decision.value.outcome,
    reason: decision.value.reason,
    requested: contract.value.body.mapping.mode,
    ...(decision.value.paths !== undefined ? { paths: decision.value.paths } : {}),
    drift: drift === null ? null : { verdict: drift.verdict, affectedPaths: drift.affectedPaths, threshold: drift.threshold, reason: drift.reason },
    ...(refresh !== null ? { refresh: refresh.record } : {}),
    ...(answer === 'refresh' || answer === 'update' || answer === 'skip' ? { existingMapAnswer: answer } : {}),
  };
  const planned = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'mapping:plan',
    status: 'completed',
    result: plan,
    nowMs: deps.clock.nowMs(),
    completedAtMs: deps.clock.nowMs(),
  });
  if (!planned.ok) return planned;

  const configureStartedMs = deps.clock.nowMs();
  const configured = await gsd.configure(stagingPath, STAGING_GSD_SETTINGS);
  if (!configured.ok) return configured;
  const applied = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'gsd:configure',
    status: 'completed',
    result: { applied: configured.value },
    nowMs: configureStartedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!applied.ok) return applied;

  const verify = ctx.checkpoint('verify-enforcement');
  if (!verify.ok) return verify;
  const enforcement = deps.host.descriptor.attributes?.['enforcement'];
  if (enforcement !== 'enforced') {
    ctx.note(`host ${deps.host.descriptor.adapter} reports enforcement ${enforcement ?? 'unknown'}; containment cannot be guaranteed`);
    const blocked = ctx.transition(row, 'blocked', 'none', {
      reason: 'enforcement_failure',
      data: { host: deps.host.descriptor.adapter, enforcement: enforcement ?? 'unknown' },
    });
    return blocked.ok ? ok(undefined) : blocked;
  }

  const moved = ctx.transition(row, 'mapping', 'launch:map');
  return moved.ok ? ok(undefined) : moved;
};
