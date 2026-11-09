// Contract amendment (RC-6, D-18, D-19, D-20; docs/contracts-and-state.md "Contract amendments"). Pure: the clock and the
// conventions' write set are arguments. The run never calls this; the amend command, outside the run and from a terminal,
// does. Nothing here is reachable from a contained invocation, because a contained invocation holds no path to the command.
import { err } from './result.ts';
import type { Result } from './result.ts';
import type { RunContract } from './run-contract.ts';

export interface AmendmentRequest {
  budgets?: Readonly<Record<string, number>>;
  addWrite?: readonly string[];
  checks?: ReadonlyArray<{ op: '+' | '-'; name: string }>;
  acceptance?: { text: string; item?: string };
  reason: string;
}

export type FieldDiff = { path: string; from?: unknown; to?: unknown; added?: string[]; removed?: string[] };

export type InvalidationClass = 'gates' | 'acceptance-mappings' | 'checks-rerun' | 'scope-conformance' | 'check-evidence' | 'approvals';

export interface AmendmentContext {
  conventionsWrite: readonly string[];
  nowIso: string;
}

export interface AmendmentResult {
  contract: RunContract;
  diff: FieldDiff[];
  invalidates: InvalidationClass[];
}

export interface BudgetRowChange {
  name: string;
  limit: number;
  exactness: 'exact' | 'estimated';
}

export function applyAmendment(_contract: RunContract, _request: AmendmentRequest, _context: AmendmentContext): Result<AmendmentResult> {
  return err({ kind: 'internal', cause: 'applyAmendment is not implemented' });
}

export function budgetRowChanges(_diff: readonly FieldDiff[], _next: RunContract): BudgetRowChange[] {
  return [];
}
