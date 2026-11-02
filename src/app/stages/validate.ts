// Stages for `validating` and `validation_failed`. Validation gathers the facts through the StagingWorkspace
// port (the map documents, the staging diff against the pin, the tracked paths at the pin), judges them with
// the pure domain rules (docs/repository-onboarding.md "Validation") and stores every check as step `validate`.
// A rejected map is retried within the contract's retry budget, then blocks with a decision. A secret pattern
// blocks at once with no retry (T-01-21); the documents are never stored. A write outside the write sets is a
// containment finding (T-01-23). App code never runs git or reads the filesystem directly.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { VALIDATION_LIMITS, validateMapArtifacts, writeSetsFor } from '../../domain/validation.ts';
import type { MapValidation } from '../../domain/validation.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import { effectiveMappingMode, loadContract, readMapDocuments, stagingPathOf } from './shared.ts';

const MAX_PATHS_IN_EVENT = 20;
const MAX_PATH_CHARS = 200;

const clip = (text: string): string => (text.length <= MAX_PATH_CHARS ? text : `${text.slice(0, MAX_PATH_CHARS - 1)}…`);

function failedNames(validation: MapValidation): string[] {
  return validation.checks.filter((c) => !c.passed).map((c) => c.name);
}

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

  const pin = contract.value.body.workspace.baseRevision;
  const changes = deps.staging.changes(staging.value, pin);
  if (!changes.ok) return changes;
  const tracked = deps.staging.listTracked(staging.value, pin);
  if (!tracked.ok) return tracked;

  // The agent write sets of the invocations that ran (steps `launch:<purpose>`), plus the AVARICE write set.
  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const purposesRun = steps.value.filter((s) => s.step.startsWith('launch:')).map((s) => s.step.slice('launch:'.length));
  const writeSets = writeSetsFor(contract.value.body.files, purposesRun);

  const validation = validateMapArtifacts(
    {
      stagingHead: head.value,
      files: documents.value.map((d) => ({
        path: d.path,
        lastMappedCommit: d.lastMappedCommit,
        text: d.text,
        bytes: d.bytes,
        ...(d.oversize === true ? { oversize: true } : {}),
      })),
      changes: changes.value,
      allowedWrite: writeSets.allowedWrite,
      trackedWritable: writeSets.trackedWritable,
      knownPaths: tracked.value,
    },
    { mode: mode.value },
    VALIDATION_LIMITS,
  );

  const attempts = deps.ledger.listAttempts(row.onboardingId);
  if (!attempts.ok) return attempts;
  const recorded = deps.ledger.recordStepResult(row.onboardingId, {
    step: 'validate',
    attempt: attempts.value.length + 1,
    status: validation.accepted ? 'accepted' : 'rejected',
    result: {
      checks: validation.checks,
      stagingHead: head.value,
      files: documents.value.length,
      completeness: validation.completeness,
      scope: validation.scope,
      scopeViolations: validation.scopeViolations,
      secretHits: validation.secretHits,
    },
    nowMs: deps.clock.nowMs(),
    completedAtMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return recorded;

  const failed = failedNames(validation);
  if (validation.scopeViolations.length > 0) {
    // Detection layer for new top-level entries the sandbox cannot prevent (the working directory is always writable).
    const finding = deps.ledger.appendEvent({
      type: 'containment.finding',
      level: 'warn',
      runId: contract.value.runId,
      data: {
        onboardingId: row.onboardingId,
        check: 'scope-of-writes',
        count: validation.scopeViolations.length,
        paths: validation.scopeViolations.slice(0, MAX_PATHS_IN_EVENT).map(clip),
      },
      nowMs: deps.clock.nowMs(),
    });
    if (!finding.ok) return finding;
  }

  if (validation.accepted) {
    const moved = ctx.transition(row, 'planning_ready', 'activate', { data: { files: documents.value.length } });
    return moved.ok ? ok(undefined) : moved;
  }
  if (validation.block) {
    // A secret goes to a human, never to a retry; the hit list carries pattern kinds and positions, not text.
    const hits = validation.secretHits.slice(0, 10).map((h) => clip(`${h.path}:${h.line} ${h.pattern}`));
    ctx.note(`a secret pattern was found in ${validation.secretHits.length} place(s) in the map documents; a decision is needed (${hits.join('; ')})`);
    const moved = ctx.transition(row, 'blocked', 'none', { reason: 'decision', data: { failed, hits: validation.secretHits.length, where: hits } });
    return moved.ok ? ok(undefined) : moved;
  }
  const moved = ctx.transition(row, 'validation_failed', 'retry-or-block', { data: { failed } });
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

  // The checks that failed in the latest validation, for the event a human reads.
  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const latest = [...steps.value].reverse().find((s) => s.step === 'validate');
  const checks = typeof latest?.result === 'object' && latest.result !== null ? (latest.result as { checks?: unknown }).checks : undefined;
  const failed = Array.isArray(checks)
    ? checks.filter((c): c is { name: string; passed: boolean } => typeof c === 'object' && c !== null && (c as { passed?: unknown }).passed === false).map((c) => c.name)
    : [];

  // The first attempt is the original mapping; `retry` more are allowed.
  const retry = contract.value.body.budgets.retry;
  const moved =
    count <= retry
      ? ctx.transition(row, 'mapping', 'launch:map', { data: { attempts: count, failed } })
      : ctx.transition(row, 'blocked', 'none', { reason: 'decision', data: { attempts: count, failed } });
  if (moved.ok && count > retry) ctx.note(`the map failed validation ${count} time(s) (${failed.join(', ') || 'unknown check'}); a decision is needed`);
  return moved.ok ? ok(undefined) : moved;
};
