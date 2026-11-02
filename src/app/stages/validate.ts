// Stages for `validating` and `validation_failed`. Validation reads the map documents through the
// StagingWorkspace port and judges them with the pure domain rules (presence and stamp here; plan 01-10
// adds the rest). A rejected map is retried within the contract's retry budget, then blocks with a
// decision (docs/repository-onboarding.md "Failure and recovery").
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { validateMapArtifacts } from '../../domain/validation.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import { effectiveMappingMode, loadContract, readMapDocuments, stagingPathOf } from './shared.ts';

export const validateStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;

  const head = deps.staging.head(staging.value);
  if (!head.ok) return head;
  const mode = effectiveMappingMode(deps, row.onboardingId, contract.value.body);
  if (!mode.ok) return mode;
  const documents = readMapDocuments(deps.staging, staging.value, mode.value);
  if (!documents.ok) return documents;

  const validation = validateMapArtifacts(
    { stagingHead: head.value, files: documents.value.map((d) => ({ path: d.path, lastMappedCommit: d.lastMappedCommit })) },
    { mode: mode.value },
  );

  const attempts = deps.ledger.listAttempts(row.onboardingId);
  if (!attempts.ok) return attempts;
  const recorded = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'validate',
    attempt: attempts.value.length + 1,
    status: validation.accepted ? 'accepted' : 'rejected',
    result: { checks: validation.checks, stagingHead: head.value, files: documents.value.length },
    nowMs: deps.clock.nowMs(),
    completedAtMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return recorded;

  const failed = validation.checks.filter((c) => !c.passed).map((c) => c.name);
  const moved = validation.accepted
    ? ctx.transition(row, 'planning_ready', 'activate', { data: { files: documents.value.length } })
    : ctx.transition(row, 'validation_failed', 'retry-or-block', { data: { failed } });
  return moved.ok ? ok(undefined) : moved;
};

export const retryOrBlockStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const attempts = deps.ledger.listAttempts(row.onboardingId);
  if (!attempts.ok) return attempts;

  // One attempt row per rejection, keyed by the row version so a re-run after a crash does not count twice.
  const reason = `validation_failed@v${row.version}`;
  let count = attempts.value.length;
  if (!attempts.value.some((a) => a.reason === reason)) {
    const nowMs = deps.clock.nowMs();
    const recorded = deps.ledger.recordAttempt(row.onboardingId, { reason, nowMs, outcome: 'rejected', endedAtMs: nowMs });
    if (!recorded.ok) return recorded;
    count += 1;
  }

  // The first attempt is the original mapping; `retry` more are allowed.
  const retry = contract.value.body.budgets.retry;
  const moved =
    count <= retry
      ? ctx.transition(row, 'mapping', 'launch:map', { data: { attempts: count } })
      : ctx.transition(row, 'blocked', 'none', { reason: 'decision', data: { attempts: count } });
  if (moved.ok && count > retry) ctx.note(`the map failed validation ${count} time(s); a decision is needed`);
  return moved.ok ? ok(undefined) : moved;
};
