// Digest of what waits for the owner (plan 03-23; D-23, D-24; AUT-6). A scheduled check-in: when open decisions or runs ready for review
// exist, one batched banner says how many, and one `digest` notification row records it and its delivery attempts. When nothing waits
// the digest posts nothing and writes nothing. It reuses the delivery loop of the notification service, and like it never reads or writes
// a decision: a banner, a hold or a failure never answers one (AUT-4).
//
// A digest is also the catch-up for banners that did not arrive. The rows an earlier stop left `pending`, `held` (quiet hours) or `failed` (three
// attempts) about a decision that is still open or a run that still waits, and the digest rows an earlier check-in left held or failed, are
// marked `delivered` when this digest's banner is delivered: its count already includes them, each decision once. When the banner is not
// delivered those rows keep their state, and the next digest tries again. In quiet hours the digest banner is held too, in one held row that
// the following digests reuse; the inbox lists everything throughout.
import { bannerText, inQuietHours } from '../domain/notify-policy.ts';
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { NotificationRow, NotificationState } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { deliverWithBackoff } from './notify.ts';
import { getInbox } from './run-status.ts';

export interface DigestOutcome {
  // True when a banner was delivered.
  posted: boolean;
  // Open decisions and runs ready for review at the time of the digest, each counted once.
  decisions: number;
  reviews: number;
  // `none` when nothing waits or no destination is set, `held` in quiet hours, `failed` after the last attempt at any destination.
  result: 'delivered' | 'failed' | 'held' | 'none';
  // The code of the last failed attempt, when the result is `failed`.
  errorCode?: string;
}

const NOTHING: DigestOutcome = { posted: false, decisions: 0, reviews: 0, result: 'none' };
// The states a digest can still cover; `delivered` is done.
const COVERABLE: readonly NotificationState[] = ['pending', 'held', 'failed'];

export async function runDigest(deps: AppDeps, nowMs: number): Promise<Result<DigestOutcome>> {
  const notify = deps.notify;
  if (notify === undefined) return ok(NOTHING);
  const settings = notify.settings();
  if (!settings.ok) return settings;
  const inbox = getInbox(deps.ledger);
  if (!inbox.ok) return inbox;
  const decisions = inbox.value.decisions.length;
  const reviews = inbox.value.reviews.length;
  if (decisions === 0 && reviews === 0) return ok(NOTHING);
  const openDecisions = new Set(inbox.value.decisions.map((d) => d.decisionId));
  const waitingRuns = new Set(inbox.value.reviews.map((r) => r.runId));
  const subjectIds = [...openDecisions, ...waitingRuns];
  const message = bannerText({ kind: 'digest', count: decisions, reviewCount: reviews });
  const quiet = inQuietHours(notify.minuteOfDay(nowMs), settings.value.quietHours);

  // A banner about a decision that is no longer open, a run that no longer waits or a run that is blocked is not what this digest says, so it is not covered.
  const covers = (row: NotificationRow): boolean => {
    if (row.kind === 'digest') return true;
    if (row.kind === 'decisions') return row.subjectIds.some((id) => openDecisions.has(id));
    if (row.kind === 'review') return row.subjectIds.some((id) => waitingRuns.has(id));
    return false;
  };

  let delivered = false;
  let held = false;
  let failed: string | undefined;
  for (const destination of settings.value.destinations) {
    const listed = deps.ledger.listNotifications({ states: COVERABLE });
    if (!listed.ok) return listed;
    const covered = listed.value.filter((row) => row.destination === destination && covers(row));
    if (quiet) {
      // One held digest row stands for every digest that stayed silent in these hours.
      if (!covered.some((row) => row.kind === 'digest' && row.state === 'held')) {
        const created = deps.ledger.createNotification({ runId: null, kind: 'digest', destination, subjectIds, state: 'held', nowMs });
        if (!created.ok) return created;
      }
      held = true;
      continue;
    }
    const created = deps.ledger.createNotification({ runId: null, kind: 'digest', destination, subjectIds, state: 'pending', nowMs });
    if (!created.ok) return created;
    const sent = await deliverWithBackoff(deps, notify, [created.value], message);
    if (!sent.ok) return sent;
    if (!sent.value.delivered) {
      failed = sent.value.rows[0]?.lastError ?? 'notifier-error';
      continue;
    }
    delivered = true;
    // Rows may have moved since they were listed (a supervisor delivering its own banner); only those still coverable move now.
    const again = deps.ledger.listNotifications({ states: COVERABLE });
    if (!again.ok) return again;
    const still = new Set(again.value.map((row) => row.notificationId));
    const ids = covered.map((row) => row.notificationId).filter((id) => still.has(id));
    if (ids.length > 0) {
      const marked = deps.ledger.setNotificationState(ids, 'delivered', deps.clock.nowMs());
      if (!marked.ok) return marked;
    }
  }
  const result: DigestOutcome['result'] = failed !== undefined ? 'failed' : delivered ? 'delivered' : held ? 'held' : 'none';
  return ok({ posted: delivered, decisions, reviews, result, ...(failed !== undefined ? { errorCode: failed } : {}) });
}
