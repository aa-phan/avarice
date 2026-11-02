// Invocation budget reservation and settlement (ONB-8, CON-13, RC-5; docs/contracts-and-state.md "Budget accounting").
// The budget rows are created from the contract when it is stored (budgetRowsOf) and live in the ledger, so they
// survive kills and resumes. Counts (invocations, tool calls, subagents) are exact: the hook charges tool calls
// and subagents itself, and an invocation is reserved here before the host starts. Wall clock and cost are
// charged after the invocation from what the host measured, and the cost cap passed to the host bounds how far the
// run total can pass its plan (cost is `estimated`).
//
// Nothing here refunds. A reservation whose holder died (a killed run never settled) is turned into spent
// `invocations` by the next reserveInvocation, because the invocation did start.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { OnboardingContract } from '../domain/onboarding-contract.ts';
import type { BudgetRow, BudgetRowInput, OnboardingRow } from '../ports/ledger.ts';
import type { InvocationPurpose } from '../ports/agent-host.ts';
import type { AppDeps } from './deps.ts';
import { loadContract } from './stages/shared.ts';

export const BUDGET_NAMES = ['invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs', 'costUsd'] as const;

export interface InvocationReservation {
  runId: string;
  purpose: InvocationPurpose;
  // The smaller of the purpose's share of the wall clock and what is left of it.
  wallClockMs: number;
  // The smaller of the contract's per-invocation cap and what is left of the run's cost budget.
  costCapUsd: number;
}

// `budget` names the budget that stopped the reservation.
export type ReserveOutcome = { granted: true; reservation: InvocationReservation } | { granted: false; budget: string };

export interface InvocationSettlement {
  durationMs: number;
  costUsd: number;
}

export function budgetRowsOf(contract: OnboardingContract): BudgetRowInput[] {
  const b = contract.budgets;
  return [
    { name: 'invocations', limit: b.invocations, exactness: 'exact' },
    { name: 'toolCalls', limit: b.toolCalls, exactness: 'exact' },
    { name: 'subagentsTotal', limit: b.subagentsTotal, exactness: 'exact' },
    { name: 'wallClockMs', limit: b.wallClockMinutes * 60_000, exactness: 'exact' },
    { name: 'costUsd', limit: b.costUsd.perRun, exactness: b.costUsd.exactness },
  ];
}

const remaining = (row: BudgetRow | undefined): number => (row === undefined ? 0 : row.limit - row.used - row.reserved);

export function reserveInvocation(deps: AppDeps, onboarding: OnboardingRow, purpose: InvocationPurpose): Result<ReserveOutcome> {
  const contract = loadContract(deps, onboarding.onboardingId);
  if (!contract.ok) return contract;
  const { runId, version, body } = contract.value;

  // Rows are created with the contract; this only fills in rows an older store lacks, and never touches one that exists.
  const ensured = deps.ledger.createBudgets(runId, version, budgetRowsOf(body));
  if (!ensured.ok) return ensured;
  let rows = ensured.value;

  const orphaned = rows.find((r) => r.name === 'invocations')?.reserved ?? 0;
  if (orphaned > 0) {
    const spent = deps.ledger.chargeBudget(runId, 'invocations', orphaned, { fromReserved: true });
    if (!spent.ok) return spent;
    const refreshed = deps.ledger.getBudgets(runId);
    if (!refreshed.ok) return refreshed;
    rows = refreshed.value;
  }
  const byName = (name: string): BudgetRow | undefined => rows.find((r) => r.name === name);

  const wallClockMs = Math.min(body.budgets.wallClockShares[purpose] * 60_000, remaining(byName('wallClockMs')));
  if (wallClockMs <= 0) return ok({ granted: false, budget: 'wallClockMs' });
  const costCapUsd = Math.min(body.budgets.costUsd.perInvocation, remaining(byName('costUsd')));
  if (costCapUsd <= 0) return ok({ granted: false, budget: 'costUsd' });

  const reserved = deps.ledger.reserveBudget(runId, 'invocations', 1);
  if (!reserved.ok) return reserved;
  if (!reserved.value.granted) return ok({ granted: false, budget: 'invocations' });
  return ok({ granted: true, reservation: { runId, purpose, wallClockMs, costCapUsd } });
}

// Moves the invocation's reservation to used and charges what it measurably cost.
export function settleInvocation(deps: AppDeps, reservation: InvocationReservation, settlement: InvocationSettlement): Result<void> {
  if (!Number.isFinite(settlement.durationMs) || !Number.isFinite(settlement.costUsd)) {
    return err({ kind: 'invalid', field: 'settlement', reason: 'duration and cost must be finite numbers' });
  }
  const spent = deps.ledger.chargeBudget(reservation.runId, 'invocations', 1, { fromReserved: true });
  if (!spent.ok) return spent;
  const clock = deps.ledger.chargeBudget(reservation.runId, 'wallClockMs', Math.max(0, Math.round(settlement.durationMs)), { fromReserved: false });
  if (!clock.ok) return clock;
  const cost = deps.ledger.chargeBudget(reservation.runId, 'costUsd', Math.max(0, settlement.costUsd), { fromReserved: false });
  return cost.ok ? ok(undefined) : cost;
}
