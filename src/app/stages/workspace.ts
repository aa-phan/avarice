// Stage for `contract_proposed`: prepare the staging worktree at the pin, configure GSD (a no-op until
// plan 01-09), verify enforcement, then move to `mapping`, or block with `enforcement_failure` when the
// host cannot enforce containment (ONB-12, CON-3). Each checkpoint names the action that follows it and
// is committed before that action runs.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import { loadContract } from './shared.ts';

export const workspaceStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
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
  // GSD configuration in staging (commit_docs=false, text_mode) arrives with the GSD adapter in plan 01-09.

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
