// Invocation budget reservation and settlement (ONB-8, CON-13, RC-5; docs/contracts-and-state.md "Budget accounting").
// The budget rows are created from the contract when it is stored (budgetRowsOf) and live in the ledger, so they
// survive kills and resumes. Counts (invocations, tool calls, subagents) are exact: the hook charges tool calls
// and subagents itself, and an invocation is reserved here before the host starts. Wall clock and cost are
// charged after the invocation from what the host measured, and the cost cap passed to the host bounds how far the
// run total can pass its plan (cost is `estimated`).
//
// Nothing here refunds. A reservation whose holder died (a killed run never settled) is turned into spent
// `invocations` by the next reserveInvocation, because the invocation did start.
//
// A killed or interrupted invocation is charged its full cost reservation, not 0 (owner decision 2026-11-03, 01-19 finding C): a
// host that is killed prints no result, yet it ran, and an orphaned host keeps working after its supervisor died. The reservation
// is what the cap logic let the host spend (the smaller of the per-invocation cap and what was left of the run's cost budget), so
// charging it is the safe direction for a cap. A cost the host did report is recorded beside it, and the larger of the two counts.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { OnboardingContract } from '../domain/onboarding-contract.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { BudgetRow, BudgetRowInput, OnboardingRow, RunRow } from '../ports/ledger.ts';
import type { InvocationPurpose, OnboardingPurpose } from '../ports/agent-host.ts';
import type { AppDeps } from './deps.ts';
import { loadContract } from './stages/shared.ts';

export const BUDGET_NAMES = ['invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs', 'costUsd'] as const;

export interface InvocationReservation {
  runId: string;
  purpose: InvocationPurpose;
  // The smaller of the purpose's share of the wall clock (a run: the contract's wall clock) and what is left of it.
  wallClockMs: number;
  // The smaller of the contract's per-invocation cap and what is left of the run's cost budget.
  costCapUsd: number;
}

// `budget` names the budget that stopped the reservation.
export type ReserveOutcome = { granted: true; reservation: InvocationReservation } | { granted: false; budget: string };

export interface InvocationSettlement {
  durationMs: number;
  // The cost the host reported; 0 when it reported none.
  costUsd: number;
  // The invocation was killed (a signal, the wall clock) or interrupted, so its true cost is not known.
  killed?: boolean;
}

// What a settlement charged to `costUsd`: `reported` is the host's own figure, `reservation` the cap reserved for a killed run.
export interface SettlementCharge {
  chargedUsd: number;
  basis: 'reported' | 'reservation';
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

// The same five budgets for a run contract (RC-1): wall clock in milliseconds, the cost row's limit is the per-run cap.
export function budgetRowsOfRun(contract: RunContract): BudgetRowInput[] {
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

// What differs between an onboarding's reservation and a run's: the budget rows' owner and version, the contract numbers, the most
// wall clock one invocation may have, and what the orphan event names. Everything else (orphan charge, caps, the reserve) is one code path.
interface ReserveSource {
  // The run the budget rows belong to: an onboarding's carrier run, or the run itself.
  runId: string;
  version: number;
  rows: readonly BudgetRowInput[];
  purpose: InvocationPurpose;
  perInvocationUsd: number;
  // The most wall clock one invocation may be granted, before what is left of the run's budget caps it further.
  wallClockCapMs: number;
  // Extra data of the `invocation.orphan-charged` event (IDs only).
  subject: Readonly<Record<string, unknown>>;
}

function reserveFrom(deps: AppDeps, source: ReserveSource): Result<ReserveOutcome> {
  const { runId } = source;
  // Rows are created with the contract; this only fills in rows an older store lacks, and never touches one that exists.
  const ensured = deps.ledger.createBudgets(runId, source.version, source.rows);
  if (!ensured.ok) return ensured;
  let rows = ensured.value;

  const orphaned = rows.find((r) => r.name === 'invocations')?.reserved ?? 0;
  if (orphaned > 0) {
    // Each orphan is charged the cost reservation it was granted: at its start, the smaller of the per-invocation cap and what the
    // run's cost budget had left (the orphan never settled, so nothing has changed that budget since).
    let costLeft = remaining(rows.find((r) => r.name === 'costUsd'));
    let costCharged = 0;
    for (let i = 0; i < orphaned; i += 1) {
      const reservedUsd = Math.max(0, Math.min(source.perInvocationUsd, costLeft));
      costLeft -= reservedUsd;
      costCharged += reservedUsd;
    }
    const spent = deps.ledger.chargeBudget(runId, 'invocations', orphaned, { fromReserved: true });
    if (!spent.ok) return spent;
    const cost = deps.ledger.chargeBudget(runId, 'costUsd', costCharged, { fromReserved: false });
    if (!cost.ok) return cost;
    const event = deps.ledger.appendEvent({
      type: 'invocation.orphan-charged',
      level: 'warn',
      runId,
      data: { ...source.subject, invocations: orphaned, costChargedUsd: costCharged },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
    const refreshed = deps.ledger.getBudgets(runId);
    if (!refreshed.ok) return refreshed;
    rows = refreshed.value;
  }
  const byName = (name: string): BudgetRow | undefined => rows.find((r) => r.name === name);

  const wallClockMs = Math.min(source.wallClockCapMs, remaining(byName('wallClockMs')));
  if (wallClockMs <= 0) return ok({ granted: false, budget: 'wallClockMs' });
  const costCapUsd = Math.min(source.perInvocationUsd, remaining(byName('costUsd')));
  if (costCapUsd <= 0) return ok({ granted: false, budget: 'costUsd' });

  const reserved = deps.ledger.reserveBudget(runId, 'invocations', 1);
  if (!reserved.ok) return reserved;
  if (!reserved.value.granted) return ok({ granted: false, budget: 'invocations' });
  return ok({ granted: true, reservation: { runId, purpose: source.purpose, wallClockMs, costCapUsd } });
}

export function reserveInvocation(deps: AppDeps, onboarding: OnboardingRow, purpose: OnboardingPurpose): Result<ReserveOutcome> {
  const contract = loadContract(deps, onboarding.onboardingId);
  if (!contract.ok) return contract;
  const { runId, version, body } = contract.value;
  return reserveFrom(deps, {
    runId,
    version,
    rows: budgetRowsOf(body),
    purpose,
    perInvocationUsd: body.budgets.costUsd.perInvocation,
    wallClockCapMs: body.budgets.wallClockShares[purpose] * 60_000,
    subject: { onboardingId: onboarding.onboardingId },
  });
}

// A run's reservation (CON-13): the run's own rows, one invocation, the whole remaining wall clock up to the contract's, and the
// per-invocation cost cap up to what is left. The orphan rule is the onboarding's: a reservation whose holder died is spent on the next reserve.
export function reserveRunInvocation(deps: AppDeps, run: RunRow): Result<ReserveOutcome> {
  const stored = deps.ledger.getRunContract(run.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${run.runId} has no stored contract` });
  const body = stored.value.body as RunContract;
  return reserveFrom(deps, {
    runId: run.runId,
    version: stored.value.version,
    rows: budgetRowsOfRun(body),
    purpose: 'run',
    perInvocationUsd: body.budgets.costUsd.perInvocation,
    wallClockCapMs: body.budgets.wallClockMinutes * 60_000,
    subject: { runId: run.runId },
  });
}

// Moves the invocation's reservation to used and charges what it cost: the reported cost, or for a killed invocation the larger of
// the reported cost and the reservation.
export function settleInvocation(deps: AppDeps, reservation: InvocationReservation, settlement: InvocationSettlement): Result<SettlementCharge> {
  if (!Number.isFinite(settlement.durationMs) || !Number.isFinite(settlement.costUsd)) {
    return err({ kind: 'invalid', field: 'settlement', reason: 'duration and cost must be finite numbers' });
  }
  const spent = deps.ledger.chargeBudget(reservation.runId, 'invocations', 1, { fromReserved: true });
  if (!spent.ok) return spent;
  const clock = deps.ledger.chargeBudget(reservation.runId, 'wallClockMs', Math.max(0, Math.round(settlement.durationMs)), { fromReserved: false });
  if (!clock.ok) return clock;
  const reported = Math.max(0, settlement.costUsd);
  const killed = settlement.killed === true;
  const chargedUsd = killed ? Math.max(reported, reservation.costCapUsd) : reported;
  const cost = deps.ledger.chargeBudget(reservation.runId, 'costUsd', chargedUsd, { fromReserved: false });
  if (!cost.ok) return cost;
  return ok({ chargedUsd, basis: killed && chargedUsd > reported ? 'reservation' : 'reported' });
}
