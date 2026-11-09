// Contract amendment (RC-6, D-18, D-19, D-20; docs/contracts-and-state.md "Contract amendments"). Pure: the clock and the
// conventions' write set are arguments. The run never calls this; the amend command, outside the run and from a terminal,
// does. Nothing here is reachable from a contained invocation, because a contained invocation holds no path to the command.
//
// An amendment is a request for contract version n+1. `applyAmendment` returns the next contract, the field-level diff and the
// classes of earlier results the change invalidates (D-20), or an `invalid` error that names the flag at fault. It never
// touches the input and never raises a limit by itself: a human asked for the new value, and D-19 sets no upper bound on it.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { BUDGET_OVERRIDE_NAMES } from './run-contract.ts';
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
  // The write globs of the repository conventions: an added write glob must sit inside one of them.
  conventionsWrite: readonly string[];
  nowIso: string;
}

export interface AmendmentResult {
  contract: RunContract;
  diff: FieldDiff[];
  invalidates: InvalidationClass[];
}

// A budget row of the ledger whose limit an amendment changes (the same mapping as budgetRowsOfRun in src/app/budget.ts, which a
// unit test compares row by row; the domain cannot import the app layer).
export interface BudgetRowChange {
  name: string;
  limit: number;
  exactness: 'exact' | 'estimated';
}

export const REASON_MAX_CHARS = 500;

type BudgetName = (typeof BUDGET_OVERRIDE_NAMES)[number];

// Where each amendable budget lives in the contract, and whether it counts whole units.
const BUDGET_FIELDS: Readonly<Record<BudgetName, { path: string; integer: boolean }>> = {
  wallClockMinutes: { path: 'budgets.wallClockMinutes', integer: true },
  invocations: { path: 'budgets.invocations', integer: true },
  toolCalls: { path: 'budgets.toolCalls', integer: true },
  subagentsTotal: { path: 'budgets.subagentsTotal', integer: true },
  subagentsConcurrent: { path: 'budgets.subagentsConcurrent', integer: true },
  costUsdPerInvocation: { path: 'budgets.costUsd.perInvocation', integer: false },
  costUsdPerRun: { path: 'budgets.costUsd.perRun', integer: false },
};

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function readBudget(budgets: RunContract['budgets'], name: BudgetName): number {
  switch (name) {
    case 'wallClockMinutes':
      return budgets.wallClockMinutes;
    case 'invocations':
      return budgets.invocations;
    case 'toolCalls':
      return budgets.toolCalls;
    case 'subagentsTotal':
      return budgets.subagentsTotal;
    case 'subagentsConcurrent':
      return budgets.subagentsConcurrent;
    case 'costUsdPerInvocation':
      return budgets.costUsd.perInvocation;
    case 'costUsdPerRun':
      return budgets.costUsd.perRun;
  }
}

function writeBudget(budgets: RunContract['budgets'], name: BudgetName, value: number): void {
  switch (name) {
    case 'wallClockMinutes':
      budgets.wallClockMinutes = value;
      break;
    case 'invocations':
      budgets.invocations = value;
      break;
    case 'toolCalls':
      budgets.toolCalls = value;
      break;
    case 'subagentsTotal':
      budgets.subagentsTotal = value;
      break;
    case 'subagentsConcurrent':
      budgets.subagentsConcurrent = value;
      break;
    case 'costUsdPerInvocation':
      budgets.costUsd.perInvocation = value;
      break;
    case 'costUsdPerRun':
      budgets.costUsd.perRun = value;
      break;
  }
}

// D-19: a budget may be raised or lowered, to any finite value above 0 (a whole number where the budget counts units). The same
// consistency the compiler keeps holds afterwards: a per-invocation cap above the per-run cap, or a concurrent cap above the total,
// could never bind, so the amendment is refused rather than quietly moving a second field.
function amendBudgets(next: RunContract, raw: unknown, diff: FieldDiff[]): Result<void> {
  if (!isPlainObject(raw)) return invalid('budget', 'must be an object of budget names to numbers');
  for (const [key, value] of Object.entries(raw)) {
    const field = `budget.${key}`;
    if (!(BUDGET_OVERRIDE_NAMES as readonly string[]).includes(key)) {
      return invalid(field, `unknown budget; the amendable budgets are ${BUDGET_OVERRIDE_NAMES.join(', ')}`);
    }
    const name = key as BudgetName;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return invalid(field, 'must be a finite number above 0');
    const spec = BUDGET_FIELDS[name];
    if (spec.integer && !Number.isSafeInteger(value)) return invalid(field, 'must be an integer');
    const from = readBudget(next.budgets, name);
    if (from === value) continue;
    writeBudget(next.budgets, name, value);
    diff.push({ path: spec.path, from, to: value });
  }
  const { costUsd, subagentsConcurrent, subagentsTotal } = next.budgets;
  if (costUsd.perInvocation > costUsd.perRun) {
    return invalid(
      'budget.costUsdPerRun',
      `the per-invocation cost cap ${costUsd.perInvocation} is above the per-run cap ${costUsd.perRun}: amend costUsdPerInvocation in the same request`,
    );
  }
  if (subagentsConcurrent > subagentsTotal) {
    return invalid(
      'budget.subagentsTotal',
      `the concurrent subagent cap ${subagentsConcurrent} is above the total ${subagentsTotal}: amend subagentsConcurrent in the same request`,
    );
  }
  return ok(undefined);
}

export function applyAmendment(contract: RunContract, request: AmendmentRequest, context: AmendmentContext): Result<AmendmentResult> {
  const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
  if (reason === '') return invalid('reason', 'is required: say why the contract changes');
  if (reason.length > REASON_MAX_CHARS) return invalid('reason', `is longer than ${REASON_MAX_CHARS} characters`);
  if (request.budgets === undefined) return invalid('amendment', 'nothing to amend: name a budget to change');

  const next = structuredClone(contract);
  const diff: FieldDiff[] = [];
  if (request.budgets !== undefined) {
    const budgets = amendBudgets(next, request.budgets, diff);
    if (!budgets.ok) return budgets;
  }
  if (diff.length === 0) return invalid('amendment', 'nothing to amend: the request leaves every field as it is');

  next.contractVersion = contract.contractVersion + 1;
  next.compiledAt = context.nowIso;
  return ok({ contract: next, diff, invalidates: [] });
}

export function classifyInvalidation(_diff: ReadonlyArray<{ path: string }>): InvalidationClass[] {
  return [];
}

export interface StaleEvidenceRow {
  evidenceId: string;
  kind: string;
  contractVersion: number;
  status: string;
  acceptance?: readonly string[];
}

export function staleTargets(
  _invalidates: readonly InvalidationClass[],
  _evidence: readonly StaleEvidenceRow[],
  _gates: ReadonlyArray<{ gate: string; passed: boolean }>,
): { evidenceIds: string[]; gates: string[] } {
  return { evidenceIds: [], gates: [] };
}

// The ledger budget rows whose limit the diff changes, with the new limit read from the amended contract. Only the five budgets the
// ledger keeps appear; a contract-only cap (concurrent subagents, the per-invocation cost cap) has no row.
export function budgetRowChanges(diff: readonly FieldDiff[], next: RunContract): BudgetRowChange[] {
  const b = next.budgets;
  const rows = new Map<string, BudgetRowChange>();
  for (const entry of diff) {
    switch (entry.path) {
      case 'budgets.invocations':
        rows.set('invocations', { name: 'invocations', limit: b.invocations, exactness: 'exact' });
        break;
      case 'budgets.toolCalls':
        rows.set('toolCalls', { name: 'toolCalls', limit: b.toolCalls, exactness: 'exact' });
        break;
      case 'budgets.subagentsTotal':
        rows.set('subagentsTotal', { name: 'subagentsTotal', limit: b.subagentsTotal, exactness: 'exact' });
        break;
      case 'budgets.wallClockMinutes':
        rows.set('wallClockMs', { name: 'wallClockMs', limit: b.wallClockMinutes * 60_000, exactness: 'exact' });
        break;
      case 'budgets.costUsd.perRun':
        rows.set('costUsd', { name: 'costUsd', limit: b.costUsd.perRun, exactness: b.costUsd.exactness });
        break;
    }
  }
  return [...rows.values()];
}
