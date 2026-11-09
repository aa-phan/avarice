// A run that cannot be completed inside its contract stops here (plan 02-13; FR-1, AUT-7, CON-3), and since plan 03-18 an item that must ask stops
// only itself (D-09, AUT-2, AUT-3). Two functions, one decision record:
//
//   blockItem  the item-local block (block reason `decision`): the item's delta is parked (park.ts), one decision is opened with the options, the
//              recommendation, a consequence for each option and the item and its transitive dependents as affected items, the item moves to
//              blocked_on_decision, its attempt ends, the decision is queued for the batched banner (D-24), and the run goes on with whatever the
//              scheduler says: another ready item, or blocked_on_decision when nothing is ready.
//   blockRun   the run-wide block (every other reason: containment, budget, credentials, the source ref): the decision, the item and the run move to
//              blocked_on_decision and the run stops with it. It never produces a branch.
//
// The record is built from a structural signal by `classifyDecision` and `buildDecisionRecord` (src/domain/decision-policy.ts) and stamped with the one
// state digest (`computeStateDigest`), so what `decide` recomputes later can only differ when the state moved. A `containment.finding` event (T-01-23
// form) is written first when the ending is a breach of containment rather than a model that could not finish: it carries the check name and at most a
// few paths, never text the model wrote.
import { buildDecisionRecord, classifyDecision } from '../../domain/decision-policy.ts';
import type { DecisionRecordDraft, DecisionSignal } from '../../domain/decision-policy.ts';
import { storedText } from '../../domain/quick-record.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import type { RunBlockedReason } from '../../domain/run-lifecycle.ts';
import { computeStateDigest } from '../../domain/state-digest.ts';
import { transitiveDependents } from '../../domain/work-items.ts';
import type { RunDisposition } from '../../domain/work-items.ts';
import type { ContractRow, DecisionRow, RunRow } from '../../ports/ledger.ts';
import type { WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { faultPoint } from '../onboarding-service.ts';
import { queueDecisionNotice } from '../notify.ts';
import { parkItem, parkStepOf } from './park.ts';
import type { BlockDescriptor } from './park.ts';
import { itemFactsOf, scheduleOf } from './schedule.ts';
import type { RunStageContext } from './stage.ts';

export type RunDecisionClass = 'acceptance' | 'permission' | 'repeated_failure' | 'scope_expansion';

export interface BlockOptions {
  reason: RunBlockedReason;
  // What the decision is about. A caller names the structural signal, or (a run-wide block that predates signals) the class of the decision, which
  // becomes the signal of that class. A call with neither opens a decision the owner answers in free text.
  signal?: DecisionSignal;
  decisionClass?: RunDecisionClass;
  // The issue as the owner will read it: AVARICE's own words, or model text stored as data (cut and stripped by the caller).
  issue: string;
  evidenceRefs?: readonly string[];
  attemptId?: string;
  // The item the decision is about: always named by the caller, never assumed (a run has several items). A block before any unit names the item that
  // would run first.
  itemId: string;
  finding?: { check: string; paths?: readonly string[] };
  // Short IDs and codes for the transition event.
  data?: Readonly<Record<string, unknown>>;
  // The clone and branch, for a block that happens before the run row has them (the run only learns its workspace at the transition to `running`).
  place?: { workspacePath: string; branch: string };
}

// An item-local block: the signal and the snapshot the item's attempt started from (what its delta is measured against) are required.
export type ItemBlockOptions = BlockOptions & { signal: DecisionSignal; base: WorkspaceSnapshot };

export const ISSUE_MAX_CHARS = 1000;
const MAX_FINDING_PATHS = 10;
const MAX_PATH_CHARS = 200;

// The reason an item-local block carries: only `decision` is about one item (blockScope in the decision policy).
const ITEM_REASON: RunBlockedReason = 'decision';

// The digest every decision is stamped with and `decide` compares (D-15): the stored contract version, the base revision, the policy revision and the
// revisions of the requirement references that are not the manual brief.
export function stateDigestOf(version: number, contract: RunContract): string {
  return computeStateDigest({
    contractVersion: version,
    baseRevision: contract.workspace.baseRevision,
    policyRevision: contract.policyRevision,
    requirementRefs: contract.intent.requirementRefs.map((ref) => ({ kind: ref.kind, revision: ref.revision, id: ref.id })),
  });
}

function loadContract(ctx: RunStageContext): Result<{ row: ContractRow; contract: RunContract }> {
  const stored = ctx.deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  return ok({ row: stored.value, contract: stored.value.body as RunContract });
}

// The invocation budget the run was given: the limit a repeated failure reached, which the amend command raises by one.
function invocationLimit(ctx: RunStageContext): number {
  const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
  return budgets.ok ? (budgets.value.find((b) => b.name === 'invocations')?.limit ?? -1) : -1;
}

// The signal of a run-wide block that names a class (Phase 2's form) instead of a signal.
function signalOf(ctx: RunStageContext, options: BlockOptions): DecisionSignal {
  if (options.signal !== undefined) return options.signal;
  switch (options.decisionClass) {
    case 'permission':
      return { kind: 'permission', ...(options.finding !== undefined ? { check: options.finding.check } : {}) };
    case 'repeated_failure':
      return { kind: 'repeated-failure', limit: invocationLimit(ctx) };
    case 'scope_expansion':
      return { kind: 'g1-scope', paths: options.finding?.paths ?? [] };
    default:
      return { kind: 'pause' };
  }
}

function draftOf(ctx: RunStageContext, loaded: { contract: RunContract }, signal: DecisionSignal, itemId: string, issue: string, evidenceRefs: readonly string[]): Result<DecisionRecordDraft> {
  const items = ctx.deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const classification = classifyDecision(signal, loaded.contract.decisions);
  return ok(
    buildDecisionRecord({
      signal,
      classification,
      itemId,
      dependents: transitiveDependents(itemFactsOf(items.value), [itemId]),
      runId: ctx.runId,
      issue,
      evidenceRefs,
      decisions: loaded.contract.decisions,
    }),
  );
}

function openRecord(ctx: RunStageContext, stored: { row: ContractRow; contract: RunContract }, draft: DecisionRecordDraft, attemptId: string | undefined): Result<DecisionRow> {
  return ctx.deps.ledger.openDecision({
    runId: ctx.runId,
    ...(attemptId !== undefined ? { attemptId } : {}),
    contractVersion: stored.row.version,
    class: draft.class,
    issue: draft.issue,
    ...(draft.recommendation !== undefined ? { recommendation: draft.recommendation } : {}),
    options: draft.options,
    consequences: draft.consequences,
    evidenceRefs: draft.evidenceRefs,
    affectedItems: draft.affectedItems,
    ...(draft.authorizedDefault !== undefined ? { authorizedDefault: draft.authorizedDefault } : {}),
    stateDigest: stateDigestOf(stored.row.version, stored.contract),
    urgency: draft.urgency,
    nowMs: ctx.deps.clock.nowMs(),
  });
}

// ---- the run-wide block --------------------------------------------------------------------------------------------------------------------------

export function blockRun(ctx: RunStageContext, options: BlockOptions): Result<RunRow> {
  const { deps } = ctx;
  const loaded = loadContract(ctx);
  if (!loaded.ok) return loaded;
  const { itemId } = options;

  if (options.finding !== undefined) {
    const event = deps.ledger.appendEvent({
      type: 'containment.finding',
      level: 'warn',
      runId: ctx.runId,
      ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
      data: {
        runId: ctx.runId,
        ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
        check: options.finding.check,
        ...(options.finding.paths !== undefined ? { count: options.finding.paths.length, paths: options.finding.paths.slice(0, MAX_FINDING_PATHS).map((p) => storedText(p, MAX_PATH_CHARS)) } : {}),
      },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
  }

  const draft = draftOf(ctx, loaded.value, signalOf(ctx, options), itemId, storedText(options.issue, ISSUE_MAX_CHARS), options.evidenceRefs ?? []);
  if (!draft.ok) return draft;
  const decision = openRecord(ctx, loaded.value, draft.value, options.attemptId);
  if (!decision.ok) return decision;

  // A committed (done) item stays done: the lifecycle has no edge out of it, and its commit is a fact.
  const items = deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.itemId === itemId);
  if (item !== undefined && item.state !== 'done' && item.state !== 'blocked_on_decision') {
    const moved = deps.ledger.transitionWorkItem(ctx.runId, itemId, { fence: ctx.fence }, {
      to: 'blocked_on_decision',
      nowMs: deps.clock.nowMs(),
      ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
      data: { decisionId: decision.value.decisionId, reason: options.reason },
    });
    if (!moved.ok) return moved;
  }

  if (options.attemptId !== undefined) {
    const ended = deps.ledger.endRunAttempt(options.attemptId, { outcome: `blocked:${options.reason}`, nowMs: deps.clock.nowMs() });
    // An attempt ends once; a second ending is the first one's record, not an error.
    if (!ended.ok && ended.error.kind !== 'conflict') return ended;
  }

  ctx.note(`blocked on a decision (${options.reason}): ${draft.value.issue.slice(0, 120)}`);
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const blocked = ctx.transition(current.value, 'blocked_on_decision', 'none', {
    reason: options.reason,
    data: { ...(options.data ?? {}), decisionId: decision.value.decisionId, class: draft.value.class, itemId },
    ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
    itemId,
    ...(options.place !== undefined ? options.place : {}),
  });
  return blocked.ok ? ok(blocked.value) : blocked;
}

// ---- the item-local block ------------------------------------------------------------------------------------------------------------------------

// Moves the run on after an item stopped or was committed, by what the scheduler says: the next item (`running` to `running`, the next action is its
// context pack), the wait on open decisions (`blocked_on_decision`, reason `decision`, nothing polls) or the end of a run that can deliver nothing
// more (`failed`, the undelivered items and the withdrawn decisions named in the event). Every item done is the caller's to hand to verification.
export function moveOn(ctx: RunStageContext, row: RunRow, disposition: RunDisposition, extra: { attemptId?: string; itemId?: string; revision?: string; data?: Readonly<Record<string, unknown>> } = {}): Result<RunRow> {
  const common = {
    ...(extra.attemptId !== undefined ? { attemptId: extra.attemptId } : {}),
    ...(extra.revision !== undefined ? { revision: extra.revision } : {}),
  };
  switch (disposition.kind) {
    case 'start':
    case 'continue':
      return ctx.transition(row, 'running', 'context-pack', { ...common, itemId: disposition.itemId, ...(extra.data !== undefined ? { data: extra.data } : {}) });
    case 'blocked':
      return ctx.transition(row, 'blocked_on_decision', 'none', {
        ...common,
        reason: 'decision',
        data: { ...(extra.data ?? {}), decisionIds: disposition.decisionIds },
        ...(extra.itemId !== undefined ? { itemId: extra.itemId } : {}),
      });
    case 'undeliverable': {
      const withdrawn = ctx.deps.ledger.listDecisions({ runId: ctx.runId, state: 'withdrawn' });
      if (!withdrawn.ok) return withdrawn;
      ctx.note(`the run cannot deliver ${disposition.itemIds.join(', ')}: no item is ready and no decision is open`);
      return ctx.transition(row, 'failed', 'none', {
        ...common,
        data: { ...(extra.data ?? {}), undelivered: disposition.itemIds, withdrawn: withdrawn.value.map((d) => d.decisionId) },
        ...(extra.itemId !== undefined ? { itemId: extra.itemId } : {}),
      });
    }
    case 'all-done':
      return err({ kind: 'internal', cause: `run ${ctx.runId} has every item done: the caller hands it to verification` });
  }
}

// The open decision whose item is `itemId`: the item is the first of its affected items (buildDecisionRecord puts it first, then its dependents).
function openDecisionOf(ctx: RunStageContext, itemId: string): Result<DecisionRow | null> {
  const open = ctx.deps.ledger.listDecisions({ runId: ctx.runId, state: 'open' });
  if (!open.ok) return open;
  return ok(open.value.find((d) => d.affectedItems[0] === itemId) ?? null);
}

// An item that must ask stops here and the run goes on (AUT-3): park its delta, then write the decision from what the park step recorded. A kill
// between the two (`mid-park`) is finished by `completeItemBlock` on resume, which reads the same step.
export function blockItem(ctx: RunStageContext, options: ItemBlockOptions): Result<RunRow> {
  const { deps } = ctx;
  if (options.attemptId === undefined) return err({ kind: 'internal', cause: `an item block of run ${ctx.runId} names no attempt` });
  const attemptId = options.attemptId;
  const run = deps.ledger.getRun(ctx.runId);
  if (!run.ok) return run;
  const clone = run.value.workspacePath ?? options.place?.workspacePath;
  if (clone === undefined) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const ordinal = attempts.value.find((a) => a.attemptId === attemptId)?.ordinal ?? attempts.value.length;

  const descriptor: BlockDescriptor = {
    reason: ITEM_REASON,
    signal: options.signal,
    issue: storedText(options.issue, ISSUE_MAX_CHARS),
    evidenceRefs: [...(options.evidenceRefs ?? [])],
    ...(options.data !== undefined ? { data: { ...options.data } } : {}),
  };
  const parked = parkItem(ctx, { clone, itemId: options.itemId, attemptId, ordinal }, options.base, descriptor);
  if (!parked.ok) return parked;
  // The delta is out of the tree and recorded; the decision is not yet written. A supervisor killed here resumes by writing it.
  faultPoint('mid-park');
  return completeItemBlock(ctx, options.itemId, attemptId);
}

// The decision half of an item block, read from the park step of the attempt: open the decision (or find the one a killed supervisor opened), end the
// attempt, queue the notice, move the item, and move the run on. Every write is repeatable, so a resume that repeats the half changes nothing twice.
export function completeItemBlock(ctx: RunStageContext, itemId: string, attemptId: string): Result<RunRow> {
  const { deps } = ctx;
  const step = parkStepOf(ctx, attemptId);
  if (!step.ok) return step;
  if (step.value === null || step.value.status !== 'completed') return err({ kind: 'internal', cause: `attempt ${attemptId} of run ${ctx.runId} has no completed park step` });
  const block = step.value.block;
  const loaded = loadContract(ctx);
  if (!loaded.ok) return loaded;

  const existing = openDecisionOf(ctx, itemId);
  if (!existing.ok) return existing;
  let decision = existing.value;
  let draftClass = decision?.class ?? '';
  if (decision === null) {
    const draft = draftOf(ctx, loaded.value, block.signal, itemId, block.issue, block.evidenceRefs);
    if (!draft.ok) return draft;
    const opened = openRecord(ctx, loaded.value, draft.value, attemptId);
    if (!opened.ok) return opened;
    decision = opened.value;
    draftClass = draft.value.class;
  }

  const ended = deps.ledger.endRunAttempt(attemptId, { outcome: `blocked:${block.reason}`, nowMs: deps.clock.nowMs() });
  // An attempt ends once; a second ending is the first one's record, not an error.
  if (!ended.ok && ended.error.kind !== 'conflict') return ended;
  // The banner is batched (D-24): a notice that cannot be queued is said and never stops the run, and the inbox still shows the decision.
  const queued = queueDecisionNotice(deps, ctx.runId, decision.decisionId);
  if (!queued.ok) ctx.note(`no notice queued for decision ${decision.decisionId}: ${queued.error.kind}`);

  const items = deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.itemId === itemId);
  if (item !== undefined && item.state !== 'done' && item.state !== 'blocked_on_decision') {
    const moved = deps.ledger.transitionWorkItem(ctx.runId, itemId, { fence: ctx.fence }, {
      to: 'blocked_on_decision',
      nowMs: deps.clock.nowMs(),
      attemptId,
      data: { decisionId: decision.decisionId, reason: block.reason },
    });
    if (!moved.ok) return moved;
  }

  ctx.note(`item ${itemId} is waiting on decision ${decision.decisionId}: ${block.issue.slice(0, 120)}`);
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const scheduled = scheduleOf(deps, ctx.runId);
  if (!scheduled.ok) return scheduled;
  return moveOn(ctx, current.value, scheduled.value.disposition, {
    attemptId,
    itemId,
    data: { ...(block.data ?? {}), decisionId: decision.decisionId, class: draftClass, itemId },
  });
}
