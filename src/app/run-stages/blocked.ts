// A run that cannot be completed inside its contract stops here (plan 02-13; FR-1, AUT-7, CON-3): it opens one decision record, moves the
// work item to blocked_on_decision where the item lifecycle allows it, ends the attempt, and moves the run to blocked_on_decision with
// a reason code. It never produces a branch. The routing table (which ending gets which reason and decision class) lives with the stages
// that know the ending (item.ts, finish.ts); this is the one place the three writes happen, so every ending leaves the same shape.
//
// A `containment.finding` event (T-01-23 form) is written first when the ending is a breach of containment rather than a model that
// could not finish: it carries the check name and at most a few paths, never text the model wrote.
import { digestOf } from '../../domain/digest.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import type { RunBlockedReason } from '../../domain/run-lifecycle.ts';
import { storedText } from '../../domain/quick-record.ts';
import type { RunRow } from '../../ports/ledger.ts';
import type { RunStageContext } from './stage.ts';

export type RunDecisionClass = 'acceptance' | 'permission' | 'repeated_failure' | 'scope_expansion';

export interface BlockOptions {
  reason: RunBlockedReason;
  decisionClass: RunDecisionClass;
  // The issue as the owner will read it: AVARICE's own words, or model text stored as data (cut and stripped by the caller).
  issue: string;
  evidenceRefs?: readonly string[];
  attemptId?: string;
  itemId?: string;
  finding?: { check: string; paths?: readonly string[] };
  // Short IDs and codes for the transition event.
  data?: Readonly<Record<string, unknown>>;
  // The clone and branch, for a block that happens before the run row has them (the run only learns its workspace at the transition to `running`).
  place?: { workspacePath: string; branch: string };
}

export const ISSUE_MAX_CHARS = 1000;
const MAX_FINDING_PATHS = 10;
const MAX_PATH_CHARS = 200;

export function blockRun(ctx: RunStageContext, options: BlockOptions): Result<RunRow> {
  const { deps } = ctx;
  const stored = deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  const contract = stored.value.body as RunContract;
  const itemId = options.itemId ?? 'A';

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

  const issue = storedText(options.issue, ISSUE_MAX_CHARS);
  const decision = deps.ledger.openDecision({
    runId: ctx.runId,
    ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
    contractVersion: stored.value.version,
    class: options.decisionClass,
    issue: issue === '' ? 'the run stopped and gave no reason' : issue,
    options: [],
    consequences: {},
    evidenceRefs: [...(options.evidenceRefs ?? [])],
    affectedItems: [itemId],
    stateDigest: digestOf({ contractVersion: stored.value.version, baseRevision: contract.workspace.baseRevision, policyRevision: contract.policyRevision }),
    urgency: 'blocking',
    nowMs: deps.clock.nowMs(),
  });
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

  ctx.note(`blocked on a decision (${options.reason}): ${issue.slice(0, 120)}`);
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const blocked = ctx.transition(current.value, 'blocked_on_decision', 'none', {
    reason: options.reason,
    data: { ...(options.data ?? {}), decisionId: decision.value.decisionId, class: options.decisionClass, itemId },
    ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
    itemId,
    ...(options.place !== undefined ? options.place : {}),
  });
  return blocked.ok ? ok(blocked.value) : blocked;
}
