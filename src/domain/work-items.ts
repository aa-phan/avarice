// RED stub: exports the planned names with placeholder results so the tests fail on assertions.
import type { WorkItemState } from './run-lifecycle.ts';

export interface ItemFacts {
  itemId: string;
  state: WorkItemState;
  dependsOn: readonly string[];
  order: number;
}

export interface DecisionFacts {
  decisionId: string;
  state: string;
  affectedItems: readonly string[];
}

export type RunDisposition =
  | { kind: 'continue' | 'start'; itemId: string }
  | { kind: 'all-done' }
  | { kind: 'blocked'; decisionIds: string[] }
  | { kind: 'undeliverable'; itemIds: string[] };

export function transitiveDependents(_items: readonly ItemFacts[], _roots: readonly string[]): string[] {
  return [];
}

export function blockedItems(_items: readonly ItemFacts[], _decisions: readonly DecisionFacts[]): Set<string> {
  return new Set();
}

export function readyItems(_items: readonly ItemFacts[], _decisions: readonly DecisionFacts[]): ItemFacts[] {
  return [];
}

export function runDisposition(_items: readonly ItemFacts[], _decisions: readonly DecisionFacts[]): RunDisposition {
  return { kind: 'all-done' };
}

export function isContinuableBlocked(_items: readonly ItemFacts[], _decisions: readonly DecisionFacts[]): boolean {
  return false;
}
