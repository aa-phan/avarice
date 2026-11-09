// What the scheduler says to do now, read from the ledger (plan 03-18; D-09, D-16, AUT-3). The run's items in declaration order (the ledger's row
// order) and its decisions go through the pure rules of src/domain/work-items.ts; nothing here decides anything itself. The running stage, the
// item-local block and the supervisor's pickup of a blocked run all ask here, so they cannot disagree about which item is next.
import { isContinuableBlocked, runDisposition } from '../../domain/work-items.ts';
import type { DecisionFacts, ItemFacts, RunDisposition } from '../../domain/work-items.ts';
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { DecisionRow, RunRow, WorkItemRow } from '../../ports/ledger.ts';
import type { AppDeps } from '../deps.ts';

export interface Schedule {
  items: WorkItemRow[];
  decisions: DecisionRow[];
  disposition: RunDisposition;
}

export function itemFactsOf(items: readonly WorkItemRow[]): ItemFacts[] {
  return items.map((i, order) => ({ itemId: i.itemId, state: i.state, dependsOn: i.dependsOn, order }));
}

export function decisionFactsOf(decisions: readonly DecisionRow[]): DecisionFacts[] {
  return decisions.map((d) => ({ decisionId: d.decisionId, state: d.state, affectedItems: d.affectedItems }));
}

export function scheduleOf(deps: AppDeps, runId: string): Result<Schedule> {
  const items = deps.ledger.listWorkItems(runId);
  if (!items.ok) return items;
  const decisions = deps.ledger.listDecisions({ runId });
  if (!decisions.ok) return decisions;
  return ok({ items: items.value, decisions: decisions.value, disposition: runDisposition(itemFactsOf(items.value), decisionFactsOf(decisions.value)) });
}

// The pickup rule of a run parked in blocked_on_decision (D-16), shared by the supervisor (which takes such a run when it holds) and by `decide`
// (which starts a supervisor when it holds). Only a run that stopped at an item decision while it was running its items is continued (`running`, or
// `paused` while a resume reconciled an item that was asking): a block from another state (the preparation actions, verification) has nothing to
// continue into, and every other blocked reason is a state of the whole run.
export function isBlockedRunContinuable(deps: AppDeps, run: RunRow): Result<boolean> {
  if (run.state !== 'blocked_on_decision' || run.reason !== 'decision') return ok(false);
  const latest = deps.ledger.latestRunCheckpoint(run.runId);
  if (!latest.ok) return latest;
  if (latest.value === null || (latest.value.fromState !== 'running' && latest.value.fromState !== 'paused')) return ok(false);
  const scheduled = scheduleOf(deps, run.runId);
  if (!scheduled.ok) return scheduled;
  return ok(isContinuableBlocked(itemFactsOf(scheduled.value.items), decisionFactsOf(scheduled.value.decisions)));
}
