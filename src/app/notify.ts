// Local notification service (plan 03-16; D-21, D-22, D-24; AUT-4, AUT-6). When a run stops the supervisor tells the owner through the
// Notifier port: one ledger row per destination records what was raised and every delivery attempt, and the inbox and status stay the
// source of truth whether or not a banner arrives. Banner text comes from `bannerText` (AVARICE-owned words only). Nothing here reads or
// writes a decision: a banner, a retry, a hold or a failure never answers one (AUT-4).
import { bannerText, effectiveDestinations } from '../domain/notify-policy.ts';
import type { BannerKind, ProfileNotify } from '../domain/notify-policy.ts';
import { err, ok } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import type { NotificationRow } from '../ports/ledger.ts';
import type { AppDeps, NotifyDeps } from './deps.ts';

export type { NotifyDeps } from './deps.ts';

export interface RunStopOutcome {
  state: RunState;
  reason: RunBlockedReason | null;
}

export interface NotifyResult {
  notifications: NotificationRow[];
  result: 'delivered' | 'failed' | 'held' | 'none';
}

const NOTHING: NotifyResult = { notifications: [], result: 'none' };

// The code of a failed delivery: the leading token of an `unavailable` cause (`osascript-failed`), else a generic one. Only a short
// lowercase token reaches the ledger, never the text of an error.
export function failureCode(error: PortError): string {
  if (error.kind === 'unavailable') {
    const match = /^[a-z0-9]+(?:-[a-z0-9]+)*(?=:|$)/.exec(error.cause);
    if (match !== null && match[0].length <= 64) return match[0];
  }
  return 'notifier-error';
}

interface StopNotice {
  kind: BannerKind;
  // Contract destinations for this kind of stop.
  contractDestinations: readonly string[];
  subjectIds: string[];
  count: number;
}

// What a stop says to the owner, or null when the stop is not one that notifies. Only AVARICE's own IDs and counts are kept.
function describeStop(deps: AppDeps, runId: string, outcome: RunStopOutcome): Result<StopNotice | null> {
  if (outcome.state !== 'blocked_on_decision' && outcome.state !== 'ready_for_review') return ok(null);
  const contract = deps.ledger.getRunContract(runId);
  if (!contract.ok) return contract;
  const notify = (contract.value?.body as { notify?: { reviewReady?: string[]; blocking?: string[] } } | undefined)?.notify;
  if (outcome.state === 'ready_for_review') {
    return ok({ kind: 'review', contractDestinations: notify?.reviewReady ?? [], subjectIds: [runId], count: 0 });
  }
  const blocking = notify?.blocking ?? [];
  if (outcome.reason !== 'decision') return ok({ kind: 'blocked-run', contractDestinations: blocking, subjectIds: [runId], count: 0 });
  const open = deps.ledger.listDecisions({ runId, state: 'open' });
  if (!open.ok) return open;
  const ids = open.value.map((d) => d.decisionId);
  if (ids.length === 0) return ok({ kind: 'blocked-run', contractDestinations: blocking, subjectIds: [runId], count: 0 });
  return ok({ kind: 'decisions', contractDestinations: blocking, subjectIds: ids, count: ids.length });
}

function bannerFor(notice: StopNotice, runId: string): { title: string; body: string } {
  return bannerText({ kind: notice.kind, runId, ...(notice.kind === 'decisions' ? { count: notice.count } : {}) });
}

// One delivery attempt, recorded on the row. The notification is `delivered` when the notifier accepted it, otherwise `failed`.
async function deliverOnce(deps: AppDeps, notify: NotifyDeps, row: NotificationRow, message: { title: string; body: string }): Promise<Result<NotificationRow>> {
  const sent = await notify.notifier.deliver(message);
  const nowMs = deps.clock.nowMs();
  if (sent.ok) return deps.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs });
  return deps.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: failureCode(sent.error), nowMs });
}

// Raises the notification of a run that has just stopped (blocked on a decision, or ready for review). The caller ignores the result for
// its exit code: a notification never changes the outcome of a run.
export async function notifyRunStop(deps: AppDeps, runId: string, outcome: RunStopOutcome): Promise<Result<NotifyResult>> {
  const notify = deps.notify;
  if (notify === undefined) return ok(NOTHING);
  const described = describeStop(deps, runId, outcome);
  if (!described.ok) return described;
  const notice = described.value;
  if (notice === null) return ok(NOTHING);
  const settings: Result<ProfileNotify> = notify.settings();
  if (!settings.ok) return settings;
  const rows: NotificationRow[] = [];
  let delivered = true;
  for (const destination of effectiveDestinations(notice.contractDestinations, settings.value)) {
    const created = deps.ledger.createNotification({ runId, kind: notice.kind, destination, subjectIds: notice.subjectIds, state: 'pending', nowMs: deps.clock.nowMs() });
    if (!created.ok) return created;
    const attempted = await deliverOnce(deps, notify, created.value, bannerFor(notice, runId));
    if (!attempted.ok) return attempted;
    rows.push(attempted.value);
    if (attempted.value.state !== 'delivered') delivered = false;
  }
  if (rows.length === 0) return ok(NOTHING);
  return ok({ notifications: rows, result: delivered ? 'delivered' : 'failed' });
}

export function queueDecisionNotice(_deps: AppDeps, _runId: string, _decisionId: string): Result<NotificationRow[]> {
  return err({ kind: 'internal', cause: 'not implemented' });
}

export function flushDueNotifications(_deps: AppDeps, _runId: string): Promise<Result<NotifyResult>> {
  return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
}
