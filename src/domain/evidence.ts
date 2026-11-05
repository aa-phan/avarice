// Evidence statuses, revisions, the D-12 baseline delta and acceptance mapping (FR-5, FR-6, AUT-7, AUT-8, AUT-9;
// docs/contracts-and-state.md "Evidence schema"). Pure: every verdict is computed from statuses AVARICE measured
// when it ran a check itself. Model text (a SUMMARY, a GSD verdict, a review) never produces a revision, a passed
// status or an acceptance mapping.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export const EVIDENCE_STATUSES = ['passed', 'failed', 'skipped', 'unavailable', 'inconclusive', 'stale'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type EvidenceKind = 'check' | 'diff' | 'test-inventory' | 'mutation' | 'gsd-verdict' | 'ci' | 'review' | 'manual';
export type EvidenceIndependence = 'deterministic' | 'external' | 'model-review';

// The command executor's result statuses (src/ports/command-executor.ts), declared here because the domain does
// not import a port, plus the executor's `unavailable` error (no sandbox, nothing was spawned).
export type CommandResultStatus = 'passed' | 'failed' | 'timed_out' | 'cancelled' | 'spawn_error' | 'sandbox_unavailable';

// A command result becomes one of the six statuses. A timeout or a cancel proves nothing either way
// (inconclusive); a command that could not start, or a missing sandbox, is unavailable. An unknown value is
// inconclusive, never passed.
export function evidenceStatusOf(status: CommandResultStatus): EvidenceStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'spawn_error':
    case 'sandbox_unavailable':
      return 'unavailable';
    case 'timed_out':
    case 'cancelled':
      return 'inconclusive';
    default:
      return 'inconclusive';
  }
}

const HEAD_PATTERN = /^[0-9a-f]{40}$/;
const TREE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface RevisionInput {
  // The commit the tree is at; null or empty when the tree was never committed.
  head: string | null;
  // The working tree matches that commit exactly.
  clean: boolean;
  // sha256 of the tree content, 64 lowercase hex; required for every revision that is not a committed clean tree.
  treeDigest?: string;
}

// `git:<40 hex>` for a committed clean tree, `tree:sha256:<64 hex>` for anything else (a dirty tree, or a tree
// with no commit). A head or a digest that is not lowercase hex of the exact length is refused.
export function revisionOf(input: RevisionInput): Result<string> {
  const hasHead = input.head !== null && input.head !== '';
  if (hasHead && !HEAD_PATTERN.test(input.head as string)) {
    return err({ kind: 'invalid', field: 'revision.head', reason: 'expected 40 lowercase hex characters' });
  }
  if (hasHead && input.clean) return ok(`git:${input.head as string}`);
  if (input.treeDigest === undefined || !TREE_DIGEST_PATTERN.test(input.treeDigest)) {
    return err({ kind: 'invalid', field: 'revision.treeDigest', reason: 'a tree revision needs 64 lowercase hex characters' });
  }
  return ok(`tree:sha256:${input.treeDigest}`);
}

export interface CheckOutcome {
  name: string;
  status: EvidenceStatus;
  evidenceId?: string;
}

export type DeltaReason = 'regressed' | 'target-not-passed' | 'not-conclusive' | 'missing';

export interface DeltaBlocking {
  name: string;
  reason: DeltaReason;
}

export interface DeltaResult {
  blocking: DeltaBlocking[];
  // Required checks that failed at base and at head and are not brief targets. A flag the caller stores in the
  // evidence row's environment (`preExisting: true`), never a status (02-RESEARCH Pitfall 9).
  preExisting: string[];
}

function statusMap(outcomes: readonly CheckOutcome[]): Map<string, EvidenceStatus> {
  const map = new Map<string, EvidenceStatus>();
  for (const outcome of outcomes) map.set(outcome.name, outcome.status);
  return map;
}

// D-12. For each required check (and each target, which must pass wherever it is declared):
//   passed at head                                   -> fine
//   no head result                                   -> blocking `missing`
//   skipped, unavailable, inconclusive or stale      -> blocking `not-conclusive`
//   failed at head, passed at base                   -> blocking `regressed`
//   failed at head and at base, a brief target       -> blocking `target-not-passed`
//   failed at head and at base, not a target         -> pre-existing
//   failed at head, base not measured as failed      -> blocking `regressed` (only a measured base failure
//                                                        may be called pre-existing)
export function baselineDelta(input: {
  base: readonly CheckOutcome[];
  head: readonly CheckOutcome[];
  required: readonly string[];
  targets: readonly string[];
}): DeltaResult {
  const base = statusMap(input.base);
  const head = statusMap(input.head);
  const targets = new Set(input.targets);
  const names = [...new Set([...input.required, ...input.targets])].sort();
  const blocking: DeltaBlocking[] = [];
  const preExisting: string[] = [];
  for (const name of names) {
    const atHead = head.get(name);
    if (atHead === undefined) {
      blocking.push({ name, reason: 'missing' });
    } else if (atHead === 'passed') {
      continue;
    } else if (atHead !== 'failed') {
      blocking.push({ name, reason: 'not-conclusive' });
    } else if (base.get(name) === 'failed') {
      if (targets.has(name)) blocking.push({ name, reason: 'target-not-passed' });
      else preExisting.push(name);
    } else {
      blocking.push({ name, reason: 'regressed' });
    }
  }
  return { blocking, preExisting };
}

export interface EvidenceRow {
  evidenceId: string;
  kind: EvidenceKind;
  name: string;
  status: EvidenceStatus;
  independence: EvidenceIndependence;
  preExisting?: boolean;
}

export interface AcceptanceMapping {
  id: string;
  satisfied: boolean;
  evidenceIds: string[];
}

// An acceptance criterion is satisfied only by deterministic evidence with status passed at head: a
// `check:<name>` row of kind check, a `test:<id>` in the passed after-inventory, a `diff:<name>` row of kind
// diff. Rows of any other kind (gsd-verdict, review, manual, ci) and any other independence never satisfy it,
// whatever their status says (AUT-7, AUT-8). The caller passes only rows for the head revision.
export function mapAcceptance(
  acceptance: ReadonlyArray<{ id: string; verifiedBy: readonly string[] }>,
  evidence: { rows: readonly EvidenceRow[]; passedTestIds: readonly string[]; inventoryEvidenceId?: string },
): AcceptanceMapping[] {
  const passedTests = new Set(evidence.passedTestIds);
  const counts = (row: EvidenceRow, kind: EvidenceKind, name: string): boolean =>
    row.kind === kind && row.name === name && row.status === 'passed' && row.independence === 'deterministic' && row.preExisting !== true;
  return acceptance.map((criterion) => {
    const evidenceIds = new Set<string>();
    for (const ref of criterion.verifiedBy) {
      const colon = ref.indexOf(':');
      if (colon < 0) continue;
      const form = ref.slice(0, colon);
      const target = ref.slice(colon + 1);
      if (form === 'check' || form === 'diff') {
        for (const row of evidence.rows) if (counts(row, form, target)) evidenceIds.add(row.evidenceId);
      } else if (form === 'test' && passedTests.has(target)) {
        evidenceIds.add(evidence.inventoryEvidenceId ?? ref);
      }
    }
    return { id: criterion.id, satisfied: evidenceIds.size > 0, evidenceIds: [...evidenceIds].sort() };
  });
}
