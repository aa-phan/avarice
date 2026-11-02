// Stage for `discovered`: compile the onboarding contract from the stored request and preflight, store it,
// and commit `contract_proposed`. A request the compiler refuses (for example promotion other than
// `none`, RC-5) blocks the onboarding with reason `decision` before any staging exists.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { compileOnboardingContract, contractDigest } from '../../domain/onboarding-contract.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const MAX_DETAIL = 500;
const NO_GSD = { found: 'no gsd-core', admitted: `${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}` };

export const contractStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const preflight = asRecord(row.preflight);
  const pin = preflight['pin'];
  if (typeof pin !== 'string') return err({ kind: 'internal', cause: `onboarding ${row.onboardingId} has no pinned revision in its preflight` });

  // GSD must be an admitted version before anything is staged or invoked (ONB-12, S-36). Out of range, or not
  // found: `incompatible`, with what was found and what is admitted. Nothing else has been created yet.
  const inspected = deps.gsd === undefined ? undefined : deps.gsd.inspect();
  if (deps.gsd === undefined || (inspected !== undefined && !inspected.ok && inspected.error.kind === 'unsupported')) {
    const problem = deps.gsdProblem ?? NO_GSD;
    const found = inspected !== undefined && !inspected.ok && inspected.error.kind === 'unsupported' ? (inspected.error.detail ?? problem.found) : problem.found;
    ctx.note(`gsd-core is incompatible: ${found}; admitted: ${problem.admitted}`);
    const moved = ctx.transition(row, 'incompatible', 'none', { data: { found: found.slice(0, MAX_DETAIL), admitted: problem.admitted } });
    return moved.ok ? ok(undefined) : moved;
  }
  if (inspected === undefined || !inspected.ok) return inspected ?? err({ kind: 'internal', cause: 'gsd inspect returned nothing' });
  const recordedInspect = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'gsd:inspect',
    status: 'completed',
    result: inspected.value,
    nowMs: deps.clock.nowMs(),
    completedAtMs: deps.clock.nowMs(),
  });
  if (!recordedInspect.ok) return recordedInspect;

  // A crash between storing the contract and committing the transition leaves a stored contract:
  // finish the transition instead of storing a second one.
  if (row.contractRunId === null) {
    const nowMs = deps.clock.nowMs();
    const compiled = compileOnboardingContract({
      onboardingId: row.onboardingId,
      runId: deps.ids.next('run_'),
      projectId: row.projectId,
      pin,
      preflight,
      request: asRecord(preflight['request']),
      nowIso: new Date(nowMs).toISOString(),
    });
    if (!compiled.ok) {
      const e = compiled.error;
      const detail = (e.kind === 'invalid' ? `${e.field}: ${e.reason}` : e.kind).slice(0, MAX_DETAIL);
      ctx.note(`the onboarding contract was refused: ${detail}`);
      const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'decision', data: { detail } });
      return blocked.ok ? ok(undefined) : blocked;
    }
    const stored = deps.ledger.storeContract(
      row.onboardingId,
      { fence: ctx.fence },
      {
        runId: compiled.value.runId,
        digest: contractDigest(compiled.value),
        body: compiled.value,
        policyRevision: compiled.value.policyRevision,
        authorizedBy: 'policy:onboarding',
        nowMs,
      },
    );
    if (!stored.ok) return stored;
  }

  // The row's version is unchanged by storeContract, so the stage's row is still current.
  const moved = ctx.transition(row, 'contract_proposed', 'prepare-workspace');
  return moved.ok ? ok(undefined) : moved;
};
