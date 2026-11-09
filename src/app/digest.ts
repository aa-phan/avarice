// Digest of what waits for the owner (plan 03-23; D-23, D-24; AUT-6). A scheduled check-in: when open decisions or runs ready for review
// exist, one batched banner says how many, and one `digest` notification row records it and its delivery attempts. When nothing waits
// the digest posts nothing and writes nothing. It reuses the delivery loop of the notification service, and like it never reads or writes
// a decision: a banner, a hold or a failure never answers one (AUT-4).
import { bannerText } from '../domain/notify-policy.ts';
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { NotificationRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { deliverWithBackoff } from './notify.ts';
import { getInbox } from './run-status.ts';

export interface DigestOutcome {
  // True when a banner was delivered.
  posted: boolean;
  // Open decisions and runs ready for review at the time of the digest, each counted once.
  decisions: number;
  reviews: number;
  // `none` when nothing waits or no destination is set, `held` in quiet hours, `failed` after the last attempt.
  result: 'delivered' | 'failed' | 'held' | 'none';
  // The code of the last failed attempt, when the result is `failed`.
  errorCode?: string;
}

const NOTHING: DigestOutcome = { posted: false, decisions: 0, reviews: 0, result: 'none' };

export async function runDigest(deps: AppDeps, _nowMs: number): Promise<Result<DigestOutcome>> {
  const notify = deps.notify;
  if (notify === undefined) return ok(NOTHING);
  const settings = notify.settings();
  if (!settings.ok) return settings;
  const inbox = getInbox(deps.ledger);
  if (!inbox.ok) return inbox;
  const decisions = inbox.value.decisions.length;
  const reviews = inbox.value.reviews.length;
  if (decisions === 0 && reviews === 0) return ok(NOTHING);
  const subjectIds = [...inbox.value.decisions.map((d) => d.decisionId), ...inbox.value.reviews.map((r) => r.runId)];
  const message = bannerText({ kind: 'digest', count: decisions, reviewCount: reviews });
  let outcome: DigestOutcome = { posted: false, decisions, reviews, result: 'none' };
  for (const destination of settings.value.destinations) {
    const created = deps.ledger.createNotification({ runId: null, kind: 'digest', destination, subjectIds, state: 'pending', nowMs: deps.clock.nowMs() });
    if (!created.ok) return created;
    const sent = await deliverWithBackoff(deps, notify, [created.value], message);
    if (!sent.ok) return sent;
    if (sent.value.delivered) {
      outcome = { ...outcome, posted: true, result: outcome.result === 'failed' ? 'failed' : 'delivered' };
    } else {
      const last: NotificationRow | undefined = sent.value.rows[0];
      outcome = { ...outcome, result: 'failed', ...(last?.lastError != null ? { errorCode: last.lastError } : {}) };
    }
  }
  return ok(outcome);
}
