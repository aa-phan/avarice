// The approval gate (plan 04-16; FR-12, FR-13, FR-15, ADR-005). Skeleton: the behavior arrives with the GREEN commit.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { AppDeps } from './deps.ts';

export interface AuthorizeInput {
  scope: string;
  action: string;
  params: Readonly<Record<string, unknown>>;
  contractAuthorization?: { action: string; params: Readonly<Record<string, unknown>> };
  repo?: { path: string; pin: string };
  itemId?: string;
}

export type AuthorizeOutcome =
  | { effect: 'allow'; source: 'class' | 'policy' | 'contract' | 'approval'; approvalId?: string; startSeq?: number }
  | { effect: 'deny'; rule: string; message: string; requestId?: string };

export function authorizeAction(_deps: AppDeps, _input: AuthorizeInput): Result<AuthorizeOutcome> {
  return err({ kind: 'internal', cause: 'not implemented' });
}

export interface PrivilegedOutcome {
  status: 'succeeded' | 'failed';
}

export function finishPrivilegedAction(_deps: AppDeps, _scope: string, _action: string, _outcome: PrivilegedOutcome): Result<void> {
  return err({ kind: 'internal', cause: 'not implemented' });
}

export interface InterruptedStep {
  startSeq: number;
  action: string;
  paramsDigest: string;
  paramsSummary: string;
  itemId?: string;
}

export interface ReconcileOutcome {
  steps: InterruptedStep[];
  decisionIds: string[];
}

export function reconcilePrivilegedSteps(_deps: AppDeps, _scope: string): Result<ReconcileOutcome> {
  return ok({ steps: [], decisionIds: [] });
}
