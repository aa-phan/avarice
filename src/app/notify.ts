// Local notification service (plan 03-16; D-21, D-22, D-24; AUT-4, AUT-6). When a run stops the supervisor tells the owner through the
// Notifier port: one ledger row per destination records what was raised and every delivery attempt, and the inbox and status stay the
// source of truth whether or not a banner arrives. Banner text comes from `bannerText` (AVARICE-owned words only). Nothing here reads or
// writes a decision: a banner, a retry, a hold or a failure never answers one (AUT-4).
import { BACKOFF_DELAYS_MS, bannerText, batchDue, effectiveDestinations, inQuietHours, nextAttemptAt } from '../domain/notify-policy.ts';
import type { BannerKind, ProfileNotify } from '../domain/notify-policy.ts';
import { err, ok } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import type { NotificationAttemptInput, NotificationRow } from '../ports/ledger.ts';
import type { Notifier, NotifierMessage } from '../ports/notifier.ts';
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

function bannerFor(notice: StopNotice, runId: string): NotifierMessage {
  return bannerText({ kind: notice.kind, runId, ...(notice.kind === 'decisions' ? { count: notice.count } : {}) });
}

// The notifier is a port, but a port can still throw; a delivery that throws is a failed delivery with a generic code, never the error's text.
async function safeDeliver(notifier: Notifier, message: NotifierMessage): Promise<Result<void>> {
  try {
    return await notifier.deliver(message);
  } catch {
    return err({ kind: 'unavailable', cause: 'notifier-error' });
  }
}

// Delivers one banner for the rows, which are all about it: up to BACKOFF_DELAYS_MS.length attempts inside this process, each preceded by
// its delay (0, 10 and 60 seconds). Every attempt is recorded on every row with its error code; a delivered attempt ends the loop, and after
// the last failed one the rows are `failed` (visible in the inbox and status, and left for the next digest). Nothing here touches a decision.
async function deliverRows(deps: AppDeps, notify: NotifyDeps, rows: readonly NotificationRow[], message: NotifierMessage): Promise<Result<{ rows: NotificationRow[]; delivered: boolean }>> {
  let latest = [...rows];
  for (let attempt = 0; attempt < BACKOFF_DELAYS_MS.length; attempt += 1) {
    await notify.sleep(BACKOFF_DELAYS_MS[attempt] as number);
    const sent = await safeDeliver(notify.notifier, message);
    const nowMs = deps.clock.nowMs();
    const next = sent.ok ? null : nextAttemptAt(attempt + 1, nowMs);
    const input: NotificationAttemptInput = sent.ok
      ? { outcome: 'delivered', nowMs }
      : { outcome: 'failed', errorCode: failureCode(sent.error), ...(next !== null ? { nextAttemptAtMs: next } : {}), nowMs };
    const recorded: NotificationRow[] = [];
    for (const row of latest) {
      const result = deps.ledger.recordNotificationAttempt(row.notificationId, input);
      if (!result.ok) return result;
      recorded.push(result.value);
    }
    latest = recorded;
    if (sent.ok) return ok({ rows: latest, delivered: true });
  }
  return ok({ rows: latest, delivered: false });
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
  // D-24: during quiet hours no banner is posted; the row is held for the next digest and the inbox still shows the decision.
  const quiet = inQuietHours(notify.minuteOfDay(deps.clock.nowMs()), settings.value.quietHours);
  const notifications: NotificationRow[] = [];
  let result: NotifyResult['result'] = 'none';
  for (const destination of effectiveDestinations(notice.contractDestinations, settings.value)) {
    // Decision notices queued earlier for this run (D-24 batching) go out in this one banner instead of a second one.
    const queued = notice.kind === 'decisions' ? pendingDecisionRows(deps, runId, destination) : ok<NotificationRow[]>([]);
    if (!queued.ok) return queued;
    const covered = new Set(queued.value.flatMap((row) => row.subjectIds));
    const fresh = notice.subjectIds.filter((id) => !covered.has(id));
    const rows: NotificationRow[] = [...queued.value];
    if (fresh.length > 0) {
      const created = deps.ledger.createNotification({ runId, kind: notice.kind, destination, subjectIds: fresh, state: quiet ? 'held' : 'pending', nowMs: deps.clock.nowMs() });
      if (!created.ok) return created;
      rows.push(created.value);
    }
    if (rows.length === 0) continue;
    const outcome = await raise(deps, notify, rows, bannerFor(notice, runId), quiet);
    if (!outcome.ok) return outcome;
    notifications.push(...outcome.value.notifications);
    result = combine(result, outcome.value.result);
  }
  return ok({ notifications, result });
}

// One failed destination makes the whole result failed; a held or delivered one never hides it.
function combine(so_far: NotifyResult['result'], next: NotifyResult['result']): NotifyResult['result'] {
  if (so_far === 'failed' || next === 'failed') return 'failed';
  if (so_far === 'held' || next === 'held') return 'held';
  return next === 'none' ? so_far : next;
}

// Holds the rows (quiet hours) or delivers one banner for them. Rows created `held` stay held; queued `pending` rows move to held.
async function raise(deps: AppDeps, notify: NotifyDeps, rows: readonly NotificationRow[], message: NotifierMessage, quiet: boolean): Promise<Result<NotifyResult>> {
  if (quiet) {
    const moving = rows.filter((row) => row.state === 'pending').map((row) => row.notificationId);
    if (moving.length > 0) {
      const held = deps.ledger.setNotificationState(moving, 'held', deps.clock.nowMs());
      if (!held.ok) return held;
    }
    const latest = deps.ledger.listNotifications({ states: ['held'] });
    if (!latest.ok) return latest;
    const ids = new Set(rows.map((row) => row.notificationId));
    return ok({ notifications: latest.value.filter((row) => ids.has(row.notificationId)), result: 'held' });
  }
  const sent = await deliverRows(deps, notify, rows, message);
  if (!sent.ok) return sent;
  return ok({ notifications: sent.value.rows, result: sent.value.delivered ? 'delivered' : 'failed' });
}

// The pending decision notices of a run for one destination, oldest first.
function pendingDecisionRows(deps: AppDeps, runId: string, destination: string): Result<NotificationRow[]> {
  const listed = deps.ledger.listNotifications({ states: ['pending'], runId });
  if (!listed.ok) return listed;
  return ok(listed.value.filter((row) => row.kind === 'decisions' && row.destination === destination));
}

// Records that a decision of the run is waiting, without raising a banner (D-24): the first notice starts a batch window, and the
// supervisor flushes it between items. A decision already queued adds no row. Destinations follow the contract and the profile.
export function queueDecisionNotice(deps: AppDeps, runId: string, decisionId: string): Result<NotificationRow[]> {
  const notify = deps.notify;
  if (notify === undefined) return ok([]);
  const contract = deps.ledger.getRunContract(runId);
  if (!contract.ok) return contract;
  const blocking = (contract.value?.body as { notify?: { blocking?: string[] } } | undefined)?.notify?.blocking ?? [];
  const settings = notify.settings();
  if (!settings.ok) return settings;
  const created: NotificationRow[] = [];
  for (const destination of effectiveDestinations(blocking, settings.value)) {
    const queued = pendingDecisionRows(deps, runId, destination);
    if (!queued.ok) return queued;
    if (queued.value.some((row) => row.subjectIds.includes(decisionId))) continue;
    const row = deps.ledger.createNotification({ runId, kind: 'decisions', destination, subjectIds: [decisionId], state: 'pending', nowMs: deps.clock.nowMs() });
    if (!row.ok) return row;
    created.push(row.value);
  }
  return ok(created);
}

// Delivers the queued decision notices of a run as one banner once the batch window (counted from the oldest pending notice) has passed;
// before that, nothing. In quiet hours the due rows are held for the next digest instead. The banner counts the decisions still open.
export async function flushDueNotifications(deps: AppDeps, runId: string): Promise<Result<NotifyResult>> {
  const notify = deps.notify;
  if (notify === undefined) return ok(NOTHING);
  const settings = notify.settings();
  if (!settings.ok) return settings;
  const nowMs = deps.clock.nowMs();
  const quiet = inQuietHours(notify.minuteOfDay(nowMs), settings.value.quietHours);
  const notifications: NotificationRow[] = [];
  let result: NotifyResult['result'] = 'none';
  for (const destination of settings.value.destinations) {
    const queued = pendingDecisionRows(deps, runId, destination);
    if (!queued.ok) return queued;
    const oldest = Math.min(...queued.value.map((row) => Date.parse(row.createdAt)));
    if (queued.value.length === 0 || !batchDue(oldest, nowMs, settings.value.batchWindowMinutes)) continue;
    const open = deps.ledger.listDecisions({ runId, state: 'open' });
    if (!open.ok) return open;
    const subjects = new Set(queued.value.flatMap((row) => row.subjectIds));
    const waiting = open.value.filter((decision) => subjects.has(decision.decisionId)).length;
    const message = bannerText({ kind: 'decisions', runId, count: Math.max(waiting, 1) });
    const outcome = await raise(deps, notify, queued.value, message, quiet);
    if (!outcome.ok) return outcome;
    notifications.push(...outcome.value.notifications);
    result = combine(result, outcome.value.result);
  }
  return ok({ notifications, result });
}
