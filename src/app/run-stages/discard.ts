// CON-16 (plan 02-16): the discard of a crashed or timed-out attempt, before its one retry. The attempt's clone goes back to the snapshot taken
// right before the unit launched, limited to the paths the unit changed after it: a file that was in the clone before the snapshot (the
// configure step's settings, anything a user placed there) and every ignored path are left as they are, and nothing is deleted
// recursively (the workspace adapter's `discard`). The supervisor alone does this, inside a stage it holds the lease for: the
// `discard-attempt` checkpoint carries the fence, so a supervisor whose fence is stale cannot commit it and never reaches the reset.
//
// Order, so a kill at any point has one reading (plan 02-17 resumes from it):
//   checkpoint `discard-attempt`  ->  restore  ->  step `discard` completed  ->  attempt ended `discarded`  ->  item delegated -> ready
//
// What is NOT claimed: that an external effect was rolled back. The step records `sideEffect: none` because a Phase 2 invocation has no network, no
// push and no change request; the basis text travels with the record so Phase 5 delivery must re-check it (CON-9).
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { storedText } from '../../domain/quick-record.ts';
import type { WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { blockRun } from './blocked.ts';
import type { RunStageContext } from './stage.ts';

export const DISCARD_BASIS = 'no network, push or change request in a Phase 2 invocation';
export const DISCARDED_OUTCOME = 'discarded';
const MAX_LISTED = 200;
const MAX_PATH_CHARS = 200;

export interface DiscardInput {
  clone: string;
  itemId: string;
  attemptId: string;
  // CON-16 ordinal of the attempt, the key of its `discard` step.
  ordinal: number;
  // The snapshot of this attempt, taken before its unit launched.
  snapshot: WorkspaceSnapshot;
}

// `discarded: false`: the discard was refused because the clone HEAD moved, and the run was blocked (enforcement_failure); the caller stops.
export interface DiscardOutcome {
  discarded: boolean;
}

const listed = (paths: readonly string[]): string[] => paths.slice(0, MAX_LISTED).map((p) => storedText(p, MAX_PATH_CHARS));

export function discardAttempt(ctx: RunStageContext, input: DiscardInput): Result<DiscardOutcome> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  // The checkpoint first: it carries the lease fence, so a stale supervisor fails here, before anything is restored.
  const marked = ctx.checkpoint('discard-attempt', { attemptId: input.attemptId, itemId: input.itemId, revision: input.snapshot.head });
  if (!marked.ok) return marked;

  const startedMs = deps.clock.nowMs();
  const restored = workspace.discard(input.clone, input.snapshot);
  if (!restored.ok) {
    // A moved HEAD is a containment breach (the supervisor alone commits): nothing was changed, and the run does not go on.
    if (restored.error.kind === 'conflict' && restored.error.expected.startsWith('head-moved')) {
      const blocked = blockRun(ctx, {
        reason: 'enforcement_failure',
        decisionClass: 'permission',
        issue: 'the clone HEAD moved during the unit, so it was not discarded: the supervisor alone commits, so containment did not hold',
        finding: { check: 'head-moved' },
        attemptId: input.attemptId,
        itemId: input.itemId,
      });
      return blocked.ok ? ok({ discarded: false }) : blocked;
    }
    return restored;
  }
  const result = restored.value;

  const recorded = deps.ledger.recordRunStep(ctx.runId, {
    step: 'discard',
    attempt: input.ordinal,
    status: 'completed',
    result: {
      attemptId: input.attemptId,
      itemId: input.itemId,
      restored: listed(result.restored),
      removed: listed(result.removed),
      ignoredLeft: listed(result.ignoredLeft),
      restoredCount: result.restored.length,
      removedCount: result.removed.length,
      ignoredLeftCount: result.ignoredLeft.length,
      sideEffect: 'none',
      basis: DISCARD_BASIS,
    },
    nowMs: startedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return recorded;

  // An attempt ends once; a second ending is the first one's record, not an error.
  const ended = deps.ledger.endRunAttempt(input.attemptId, { outcome: DISCARDED_OUTCOME, nowMs: deps.clock.nowMs() });
  if (!ended.ok && ended.error.kind !== 'conflict') return ended;

  const items = deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.itemId === input.itemId);
  if (item !== undefined && item.state === 'delegated') {
    const moved = deps.ledger.transitionWorkItem(ctx.runId, input.itemId, { fence: ctx.fence }, { to: 'ready', nowMs: deps.clock.nowMs(), attemptId: input.attemptId, data: { discarded: true } });
    if (!moved.ok) return moved;
  }
  return ok({ discarded: true });
}
