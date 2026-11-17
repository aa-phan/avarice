// Reference freshness on resume (plan 04-20; FR-8, FR-3, FR-18, S-5; docs/contracts-and-state.md "Reference freshness"). A run records what it was built from in
// task_refs: the brief file it started from, and every item of the context packs it planned on. `avarice resume` refreshes every one of those references before
// the run goes on, in primary-key order, and records each new freshness. A reference that changed, was deleted or is no longer readable stops the run (the caller
// opens the decision and moves the run to blocked_on_decision); a stale one is shown and the run continues; one that cannot be judged (`unavailable`) continues
// with a warning. Nothing here writes the revision of a changed or deleted reference: the revision a run was built from stays, so a second resume finds the same
// change again instead of accepting it silently.
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunBlockedReason } from '../domain/run-lifecycle.ts';
import type { ExternalRef, Freshness } from '../ports/context-source.ts';
import type { AppDeps } from './deps.ts';
import { BRIEF_REF_KIND, BRIEF_REF_PROVIDER, readBriefFile } from './run-start.ts';

// The blocked reasons a reference can stop a run with, most severe first (a flagged assumption of plan 04-20): a source that is no longer readable says more than
// one that is gone, and one that is gone says more than one that changed.
export type RefBlockReason = Extract<RunBlockedReason, 'access_revoked' | 'ref_deleted' | 'ref_changed'>;

const PRECEDENCE: ReadonlyArray<{ freshness: Freshness; reason: RefBlockReason }> = [
  { freshness: 'access_revoked', reason: 'access_revoked' },
  { freshness: 'deleted', reason: 'ref_deleted' },
  { freshness: 'changed', reason: 'ref_changed' },
];

// The reason a run is blocked with when its references came back like this, or null when none of them blocks (fresh, stale and unavailable never do). The
// precedence is fixed: access_revoked, then ref_deleted, then ref_changed, whatever order the references were refreshed in.
export function blockedReasonFor(freshness: readonly Freshness[]): RefBlockReason | null {
  for (const rank of PRECEDENCE) if (freshness.includes(rank.freshness)) return rank.reason;
  return null;
}

export interface RefBlock {
  reason: RefBlockReason;
  // Every reference that came back changed, deleted or revoked, in the order they were refreshed, whatever the reason that won.
  refs: ExternalRef[];
}

export interface RefreshOutcome {
  // Every recorded reference after its refresh, in primary-key order.
  refreshed: ExternalRef[];
  // One line for each reference that could not be judged: the run goes on and says so.
  warnings: string[];
  block?: RefBlock;
}

const label = (ref: ExternalRef): string => `${ref.provider} ${ref.kind} ${ref.id}`;

// The brief file read again: gone is `deleted`, one the profile can no longer open is `access_revoked`, any other change of its bytes (or of what it is) is
// `changed`, and the same digest is `fresh`.
function refreshBrief(ref: ExternalRef, nowMs: number): ExternalRef {
  const settled = (freshness: Freshness): ExternalRef => ({ ...ref, retrievedAt: new Date(nowMs).toISOString(), freshness });
  const read = readBriefFile(ref.id);
  if (read.ok) return settled(read.bytesDigest === ref.revision ? 'fresh' : 'changed');
  switch (read.code) {
    case 'ENOENT':
    case 'ENOTDIR':
    case 'NOT_FILE':
      return settled('deleted');
    case 'EACCES':
    case 'EPERM':
      return settled('access_revoked');
    case 'TOO_LARGE':
    case 'NOT_UTF8':
      return settled('changed');
    default:
      return settled('unavailable');
  }
}

// Refreshes every reference the run recorded, one at a time in primary-key order, and records each result. A run with no reference makes no call.
export async function refreshRunRefs(deps: AppDeps, runId: string): Promise<Result<RefreshOutcome>> {
  const run = deps.ledger.getRun(runId);
  if (!run.ok) return run;
  const recorded = deps.ledger.listTaskRefs(runId);
  if (!recorded.ok) return recorded;
  if (recorded.value.length === 0) return ok({ refreshed: [], warnings: [] });

  const refreshed: ExternalRef[] = [];
  const warnings: string[] = [];
  for (const ref of recorded.value) {
    const nowMs = deps.clock.nowMs();
    let after: ExternalRef;
    if (ref.provider === BRIEF_REF_PROVIDER && ref.kind === BRIEF_REF_KIND) {
      after = refreshBrief(ref, nowMs);
    } else {
      // No source judges this provider yet: it cannot be refreshed, so the run goes on with a warning.
      after = { ...ref, retrievedAt: new Date(nowMs).toISOString(), freshness: 'unavailable' };
    }
    // The revision column is left alone: it is the revision the run was built from (see the header).
    const written = deps.ledger.updateTaskRefFreshness(runId, { provider: ref.provider, kind: ref.kind, id: ref.id }, after.freshness, undefined, nowMs);
    if (!written.ok) return written;
    if (after.freshness === 'unavailable') warnings.push(`${label(ref)} could not be refreshed (unavailable); the run continues on what it recorded`);
    refreshed.push(after);
  }

  const counts: Record<string, number> = {};
  for (const ref of refreshed) counts[ref.freshness] = (counts[ref.freshness] ?? 0) + 1;
  const event = deps.ledger.appendEvent({
    type: 'task_refs.refreshed',
    level: refreshed.some((r) => r.freshness !== 'fresh') ? 'warn' : 'info',
    runId,
    data: { runId, count: refreshed.length, freshness: counts },
    nowMs: deps.clock.nowMs(),
  });
  if (!event.ok) return event;

  const reason = blockedReasonFor(refreshed.map((r) => r.freshness));
  if (reason === null) return ok({ refreshed, warnings });
  const blocking: ReadonlySet<Freshness> = new Set<Freshness>(['access_revoked', 'deleted', 'changed']);
  return ok({ refreshed, warnings, block: { reason, refs: refreshed.filter((r) => blocking.has(r.freshness)) } });
}

// The evidence reference a decision of a blocked run carries for each reference that stopped it: `ref:<provider>:<kind>:<ID>`. The ID is the provider's own,
// verbatim, so it is matched whole and never split.
export const refEvidence = (ref: Pick<ExternalRef, 'provider' | 'kind' | 'id'>): string => `ref:${ref.provider}:${ref.kind}:${ref.id}`;

// Used by the resume to tell a decision this module opened from any other.
export const isRefEvidence = (value: string): boolean => value.startsWith('ref:');
