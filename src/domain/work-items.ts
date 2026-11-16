// The scheduler as a pure function (D-09, AUT-3, AUT-12). An item is ready to run only when its state is ready,
// every item it depends on is done, and no open decision lists it or one of the items it depends on, directly
// or through a chain. Items are judged in brief declaration order and every input is sorted before it is read,
// so the same rows give a deep-equal answer whatever order they arrive in. No I/O, no process: the running
// stage reads the ledger and asks this module what to do next; this module never reads anything itself.
import type { WorkItemState } from './run-lifecycle.ts';

export interface ItemFacts {
  itemId: string;
  state: WorkItemState;
  dependsOn: readonly string[];
  // Position in the brief's declaration order; the scheduler's only tie-breaker between ready items.
  order: number;
}

export interface DecisionFacts {
  decisionId: string;
  // A decision blocks work only while it is `open`; answered, stale and withdrawn decisions do not.
  state: string;
  affectedItems: readonly string[];
}

export type RunDisposition =
  | { kind: 'continue' | 'start'; itemId: string }
  | { kind: 'all-done' }
  | { kind: 'blocked'; decisionIds: string[] }
  | { kind: 'undeliverable'; itemIds: string[] };

// Items the scheduler is already working through: they continue before any new item starts.
const IN_FLIGHT: readonly WorkItemState[] = ['delegated', 'implemented', 'gated'];

function byOrder(a: ItemFacts, b: ItemFacts): number {
  return a.order - b.order || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
}

function openDecisions(decisions: readonly DecisionFacts[]): DecisionFacts[] {
  return decisions.filter((decision) => decision.state === 'open');
}

// Items that depend on a root, directly or through a chain, in declaration order. A root appears only when another
// path leads back to it (a dependency cycle); an id that names no item is ignored.
export function transitiveDependents(items: readonly ItemFacts[], roots: readonly string[]): string[] {
  const sorted = [...items].sort(byOrder);
  const reached = new Set<string>();
  const frontier = new Set<string>(roots);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const candidate of sorted) {
      if (reached.has(candidate.itemId)) continue;
      if (candidate.dependsOn.some((dependency) => frontier.has(dependency))) {
        reached.add(candidate.itemId);
        next.add(candidate.itemId);
      }
    }
    frontier.clear();
    for (const id of next) frontier.add(id);
  }
  return sorted.filter((candidate) => reached.has(candidate.itemId)).map((candidate) => candidate.itemId);
}

// Every item an open decision lists, plus everything that depends on one of them: dependent work is not implemented
// while the decision is open (AUT-3).
export function blockedItems(items: readonly ItemFacts[], decisions: readonly DecisionFacts[]): Set<string> {
  const named = new Set<string>();
  for (const decision of openDecisions(decisions)) {
    for (const itemId of decision.affectedItems) named.add(itemId);
  }
  const blocked = new Set<string>(named);
  for (const itemId of transitiveDependents(items, [...named])) blocked.add(itemId);
  return blocked;
}

export function readyItems(items: readonly ItemFacts[], decisions: readonly DecisionFacts[]): ItemFacts[] {
  const sorted = [...items].sort(byOrder);
  const done = new Set(sorted.filter((candidate) => candidate.state === 'done').map((candidate) => candidate.itemId));
  const blocked = blockedItems(sorted, decisions);
  return sorted.filter(
    (candidate) => candidate.state === 'ready' && !blocked.has(candidate.itemId) && candidate.dependsOn.every((dependency) => done.has(dependency)),
  );
}

// What the running stage does on this pass: continue an item already in flight, start the first ready item, finish,
// wait on open decisions (a visible blocked state, no polling), or report that no remaining item can ever run, as
// after a withdrawn decision (AUT-12).
export function runDisposition(items: readonly ItemFacts[], decisions: readonly DecisionFacts[]): RunDisposition {
  const sorted = [...items].sort(byOrder);
  const inFlight = sorted.find((candidate) => IN_FLIGHT.includes(candidate.state));
  if (inFlight !== undefined) return { kind: 'continue', itemId: inFlight.itemId };
  const ready = readyItems(sorted, decisions);
  if (ready.length > 0) return { kind: 'start', itemId: ready[0].itemId };
  const remaining = sorted.filter((candidate) => candidate.state !== 'done');
  if (remaining.length === 0) return { kind: 'all-done' };
  const open = openDecisions(decisions)
    .map((decision) => decision.decisionId)
    .sort();
  if (open.length > 0) return { kind: 'blocked', decisionIds: open };
  return { kind: 'undeliverable', itemIds: remaining.map((candidate) => candidate.itemId) };
}

// A run parked in blocked_on_decision can move exactly when an item is ready or no open decision remains (D-16):
// the supervisor and `decide` use this one rule to decide whether to pick the run up.
export function isContinuableBlocked(items: readonly ItemFacts[], decisions: readonly DecisionFacts[]): boolean {
  return readyItems(items, decisions).length > 0 || openDecisions(decisions).length === 0;
}
