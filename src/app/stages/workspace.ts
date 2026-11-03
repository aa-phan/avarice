// Stage for `contract_proposed`: prepare the staging workspace at the pin, then at the `configure-gsd`
// checkpoint probe GSD (`init onboard`), decide the mapping mode and configure GSD, all by AVARICE and all with
// cwd = staging, before any host invocation (ONB-2, ONB-5; config-set cannot run inside the sandbox, research
// Pitfall 5). Then verify enforcement and move to `mapping`, or block with `enforcement_failure` when the host
// cannot enforce containment (ONB-12, CON-3). Each checkpoint names the action that follows it and is
// committed before that action runs.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { chooseMappingMode } from '../../domain/mapping.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import type { GsdSetting } from '../../ports/gsd-onboarding.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { ExistingMapClass } from '../../domain/preflight.ts';
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

  const existingMap = existingMapOf(row.preflight);
  const decision = chooseMappingMode({ isBrownfield: probe.value.isBrownfield, requested: contract.value.body.mapping.mode, existingMap });
  if (!decision.ok) {
    if (decision.error.kind !== 'unsupported') return decision;
    ctx.note(`mapping mode ${contract.value.body.mapping.mode} is not available: ${decision.error.detail ?? decision.error.capability}`);
    const blocked = ctx.transition(row, 'blocked', 'none', {
      reason: 'scope_unavailable',
      data: { capability: decision.error.capability, ...(decision.error.reducedMode !== undefined ? { reducedMode: decision.error.reducedMode } : {}) },
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
    reason: decision.value.reason,
    requested: contract.value.body.mapping.mode,
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
