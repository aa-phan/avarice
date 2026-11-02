// Invocation budget reservation and settlement (STUB for the RED commit).
import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { OnboardingContract } from '../domain/onboarding-contract.ts';
import type { BudgetRowInput, OnboardingRow } from '../ports/ledger.ts';
import type { InvocationPurpose } from '../ports/agent-host.ts';
import type { AppDeps } from './deps.ts';

export const BUDGET_NAMES = ['invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs', 'costUsd'] as const;

export interface InvocationReservation {
  runId: string;
  purpose: InvocationPurpose;
  wallClockMs: number;
  costCapUsd: number;
}

export type ReserveOutcome = { granted: true; reservation: InvocationReservation } | { granted: false; budget: string };

export interface InvocationSettlement {
  durationMs: number;
  costUsd: number;
}

export function budgetRowsOf(_contract: OnboardingContract): BudgetRowInput[] {
  return [];
}

export function reserveInvocation(_deps: AppDeps, _onboarding: OnboardingRow, _purpose: InvocationPurpose): Result<ReserveOutcome> {
  return err({ kind: 'unsupported', capability: 'budgets' });
}

export function settleInvocation(_deps: AppDeps, _reservation: InvocationReservation, _settlement: InvocationSettlement): Result<void> {
  return err({ kind: 'unsupported', capability: 'budgets' });
}
