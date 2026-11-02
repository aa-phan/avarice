// Stage for `discovered`: compile the onboarding contract from the stored request and preflight, store it,
// and commit `contract_proposed`. A request the compiler refuses (for example promotion other than
// `none`, RC-5) blocks the onboarding with reason `decision` before any staging exists.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { compileOnboardingContract, contractDigest } from '../../domain/onboarding-contract.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const MAX_DETAIL = 500;

export const contractStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const preflight = asRecord(row.preflight);
  const pin = preflight['pin'];
  if (typeof pin !== 'string') return err({ kind: 'internal', cause: `onboarding ${row.onboardingId} has no pinned revision in its preflight` });

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
