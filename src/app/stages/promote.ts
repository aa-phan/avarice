// Stage after activation: promote the accepted map into the user's repository (plan 04-21; ONB-6, ONB-5, D-15, FR-12, FR-15). It runs only when the
// onboarding contract asks for it (`delivery.promote` of `copy` or `commit`; `none` does nothing), outside any contained invocation, by AVARICE itself.
//
//   copy    writes an accepted file under `.planning/` of the checkout only where the target is absent; a byte-identical target is skipped and any other
//           is left untouched and named in one permission decision (S-28, T-04-56).
//   commit  creates `refs/heads/avarice/onboard-<id>` in the user's repository, holding the accepted files in one Conventional Commits commit, by a
//           create-only fetch: no checkout, no working-tree file and no other ref changes (T-04-58).
//
// Promotion is a privileged action. It runs only after `authorizeAction` lets it start, with the onboarding contract as the source (it names exactly this
// action and the onboarding ID), and a policy deny refuses it (T-04-57). Its start is recorded before anything is written, so an interruption leaves a start
// with no end, which resume turns into a decision and never repeats (FR-15). The onboarding is already active when this runs: nothing here moves its state,
// and a promotion that did not happen is a note and a recorded outcome, not a failure of the onboarding.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { PromotionFile } from '../../ports/staging-workspace.ts';
import { authorizeAction, finishPrivilegedAction } from '../authorize.ts';
import { openOnboardingPermissionDecision } from '../onboarding-decision.ts';
import { loadContract, stagingPathOf } from './shared.ts';
import type { Stage, StageContext } from './stage.ts';

export const PROMOTE_STEP = 'promote';
const MAX_PATHS_IN_ISSUE = 10;
const MAX_DETAIL = 300;
// The kill points between a privileged action's recorded start and its end (test-only fault injection): right after the start, and after the
// write took effect but before its outcome and end were recorded. `AVARICE_FAULT=after-action-start:onboarding.promote.copy`, for one.
export const PROMOTE_STARTED_FAULT = 'after-action-start:';
export const PROMOTE_WORKED_FAULT = 'after-action-work:';

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The accepted map documents as the active record names them, read back from the artifact store by digest: the bytes that were validated and
// recorded, not whatever the staging tree holds now.
function acceptedFiles(ctx: StageContext, row: OnboardingRow): Result<PromotionFile[]> {
  const { deps } = ctx;
  const record = deps.ledger.getActiveRecord(row.projectId);
  if (!record.ok) return record;
  if (record.value === null) return err({ kind: 'not_found', ref: `active record of project ${row.projectId}` });
  const artifacts = isObject(record.value.body['artifacts']) ? record.value.body['artifacts'] : {};
  const codebase = Array.isArray(artifacts['codebase']) ? artifacts['codebase'] : [];
  const files: PromotionFile[] = [];
  for (const entry of codebase) {
    if (!isObject(entry) || typeof entry['path'] !== 'string' || typeof entry['digest'] !== 'string') continue;
    const bytes = deps.artifacts.get(entry['digest']);
    if (!bytes.ok) return bytes;
    files.push({ path: entry['path'], content: bytes.value });
  }
  if (files.length === 0) return err({ kind: 'internal', cause: `the active record of project ${row.projectId} names no accepted map file` });
  return ok(files);
}

// Records what the promotion did as step `promote`. Nothing a promotion did is lost when this fails: the events carry the start and the end.
function recordOutcome(ctx: StageContext, status: string, result: Readonly<Record<string, unknown>>): Result<void> {
  const nowMs = ctx.deps.clock.nowMs();
  const recorded = ctx.deps.ledger.recordStepResult(ctx.onboardingId, { step: PROMOTE_STEP, status, result, nowMs, completedAtMs: nowMs });
  return recorded.ok ? ok(undefined) : recorded;
}

// A promotion that did not happen: the outcome is recorded and the owner is told; the onboarding stays active.
function notDone(ctx: StageContext, mode: string, status: 'refused' | 'failed', detail: string, extra: Readonly<Record<string, unknown>> = {}): Result<void> {
  ctx.note(`promotion ${mode} did not happen: ${detail}`);
  return recordOutcome(ctx, status, { mode, detail: clip(detail), ...extra });
}

// Whether a promotion of this action was ever started for this onboarding: a recorded start is never run again, finished or not.
function alreadyAttempted(ctx: StageContext, action: string): Result<boolean> {
  const steps = ctx.deps.ledger.getStepResults(ctx.onboardingId);
  if (!steps.ok) return steps;
  if (steps.value.some((s) => s.step === PROMOTE_STEP)) return ok(true);
  const events = ctx.deps.ledger.listActionEvents(ctx.onboardingId);
  if (!events.ok) return events;
  return ok(events.value.some((e) => e.type === 'action.started' && e.data['action'] === action));
}

export const promoteStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const mode = contract.value.body.delivery.promote;
  if (mode === 'none') return ok(undefined);
  const action = `onboarding.promote.${mode}`;

  const attempted = alreadyAttempted(ctx, action);
  if (!attempted.ok) return attempted;
  if (attempted.value) return ok(undefined);

  const project = deps.ledger.findProject({ projectId: row.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'not_found', ref: `project ${row.projectId}` });
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;
  const files = acceptedFiles(ctx, row);
  if (!files.ok) return notDone(ctx, mode, 'failed', `the accepted map could not be read (${files.error.kind})`);

  // The contract is the source: it names this action with this onboarding as the one parameter. A policy deny still ends it.
  const params = { onboardingId: row.onboardingId };
  const authorized = authorizeAction(deps, {
    scope: row.onboardingId,
    action,
    params,
    contractAuthorization: { action, params },
    repo: { path: project.value.repoPath, pin: contract.value.body.workspace.baseRevision },
  });
  if (!authorized.ok) return notDone(ctx, mode, 'failed', `the approval gate could not decide (${authorized.error.kind})`);
  if (authorized.value.effect === 'deny') return notDone(ctx, mode, 'refused', authorized.value.message, { rule: authorized.value.rule });

  ctx.fault(`${PROMOTE_STARTED_FAULT}${action}`);

  const finish = (status: 'succeeded' | 'failed'): Result<void> => finishPrivilegedAction(deps, row.onboardingId, action, { status });

  if (mode === 'copy') {
    const copied = deps.staging.copyIntoCheckout(project.value.repoPath, files.value);
    if (!copied.ok) {
      const ended = finish('failed');
      if (!ended.ok) return ended;
      return notDone(ctx, mode, 'failed', `the copy stopped (${copied.error.kind})`);
    }
    ctx.fault(`${PROMOTE_WORKED_FAULT}${action}`);
    const { written, present, conflicts } = copied.value;
    let decisionId: string | undefined;
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, MAX_PATHS_IN_ISSUE).join(', ');
      const more = conflicts.length > MAX_PATHS_IN_ISSUE ? ` and ${conflicts.length - MAX_PATHS_IN_ISSUE} more` : '';
      const opened = openOnboardingPermissionDecision(deps, row.onboardingId, {
        issue: `promotion copy left ${conflicts.length} file(s) of your checkout untouched because they differ from the accepted map: ${shown}${more}`,
        consequence: 'the decision closes with nothing applied; those files stay as they are and AVARICE never replaces them',
        evidenceRefs: conflicts.slice(0, MAX_PATHS_IN_ISSUE).map((path) => `path:${path}`),
      });
      if (!opened.ok) return opened;
      decisionId = opened.value.decisionId;
    }
    const recorded = recordOutcome(ctx, 'completed', { mode, written, present, conflicts, ...(decisionId !== undefined ? { decisionId } : {}) });
    if (!recorded.ok) return recorded;
    const ended = finish('succeeded');
    if (!ended.ok) return ended;
    ctx.note(
      `promotion copy: wrote ${written.length} file(s) into .planning/codebase, ${present.length} already present` +
        (conflicts.length > 0 ? `, ${conflicts.length} left untouched because they differ (decision ${decisionId ?? ''})` : ''),
    );
    return ok(undefined);
  }

  const files4commit = files.value;
  const committed = deps.staging.commitPromotion({
    repoPath: project.value.repoPath,
    stagingPath: staging.value,
    onboardingId: row.onboardingId,
    pin: contract.value.body.workspace.baseRevision,
    files: files4commit,
    message: `docs(planning): adopt GSD codebase map from AVARICE onboarding ${row.onboardingId}\n\n${files4commit.map((f) => `- ${f.path}`).join('\n')}\n`,
  });
  if (!committed.ok) {
    const ended = finish('failed');
    if (!ended.ok) return ended;
    return notDone(ctx, mode, 'failed', `the branch was not created (${committed.error.kind})`);
  }
  ctx.fault(`${PROMOTE_WORKED_FAULT}${action}`);
  const recorded = recordOutcome(ctx, 'completed', { mode, branch: committed.value.branch, commit: committed.value.commit, files: files4commit.map((f) => f.path) });
  if (!recorded.ok) return recorded;
  const ended = finish('succeeded');
  if (!ended.ok) return ended;
  ctx.note(`promotion commit: created branch ${committed.value.branch} at ${committed.value.commit.slice(0, 12)}; your checkout was not touched`);
  return ok(undefined);
};
