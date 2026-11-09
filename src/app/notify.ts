// Local notification service (plan 03-16; D-21, D-22, D-24; AUT-4, AUT-6). RED stub: the behavior arrives in the GREEN commit.
import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import type { NotificationRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';

export type { NotifyDeps } from './deps.ts';

export interface RunStopOutcome {
  state: RunState;
  reason: RunBlockedReason | null;
}

export interface NotifyResult {
  notifications: NotificationRow[];
  result: 'delivered' | 'failed' | 'held' | 'none';
}

const notImplemented = (): Result<never> => err({ kind: 'internal', cause: 'not implemented' });

export function notifyRunStop(_deps: AppDeps, _runId: string, _outcome: RunStopOutcome): Promise<Result<NotifyResult>> {
  return Promise.resolve(notImplemented());
}

export function queueDecisionNotice(_deps: AppDeps, _runId: string, _decisionId: string): Result<NotificationRow[]> {
  return notImplemented();
}

export function flushDueNotifications(_deps: AppDeps, _runId: string): Promise<Result<NotifyResult>> {
  return Promise.resolve(notImplemented());
}
