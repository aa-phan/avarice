// The one state digest (D-15, AUT-5). blockRun stamps it on a decision when it opens, `decide` recomputes it before it applies an
// answer, and the stale re-open stamps it on the successor, all through this function, so a difference between the two sides can
// only mean the state moved.
//
// For a manual brief the value is the Phase 2 formula (contract version, base revision, policy revision), so a decision opened
// before this phase keeps matching. The brief digest stands for itself through the contract version: an amendment that changes
// the acceptance criteria writes a new version. A requirement reference that is not the manual brief (a ticket) adds its
// revision, so a moved ticket makes an answer stale.
import { digestOf } from './digest.ts';

export interface StateDigestFacts {
  contractVersion: number;
  baseRevision: string;
  policyRevision: string;
  requirementRefs: ReadonlyArray<{ kind: string; revision: string; id?: string }>;
}

export function computeStateDigest(facts: StateDigestFacts): string {
  const ticketRevisions = facts.requirementRefs
    .filter((ref) => ref.kind !== 'brief')
    .map((ref) => `${ref.kind}:${ref.id ?? ''}:${ref.revision}`)
    .sort();
  return digestOf({
    contractVersion: facts.contractVersion,
    baseRevision: facts.baseRevision,
    policyRevision: facts.policyRevision,
    ...(ticketRevisions.length > 0 ? { ticketRevisions } : {}),
  });
}
