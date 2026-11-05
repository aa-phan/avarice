// Gates G2 and G4 (AUT-7, AUT-9; docs/contracts-and-state.md "Phase gates"). Pure verdicts over facts AVARICE
// measured. A GSD verifier verdict, a SUMMARY or any model-written text is never an input that can pass a gate.
// Failures are listed in a fixed rule order, and every list is sorted before it is judged, so the same facts give
// a deep-equal verdict whatever order they arrive in.
import type { AcceptanceMapping, DeltaBlocking, EvidenceStatus } from './evidence.ts';

export interface GateFailure {
  rule: string;
  detail: string;
}

export interface GateVerdict {
  passed: boolean;
  failures: GateFailure[];
}

export const G4_RULES = [
  'revision-clean',
  'checks-delta',
  'acceptance-mapped',
  'no-stale-or-inconclusive',
  'diff-gate-clean',
  'decisions-closed',
  'budgets-within',
] as const;

export interface G4Facts {
  // `git:<40 hex>` only; a `tree:` revision is a dirty or uncommitted tree.
  revision: string;
  blocking: readonly DeltaBlocking[];
  acceptance: readonly AcceptanceMapping[];
  // The required evidence rows at the final revision.
  requiredEvidence: ReadonlyArray<{ name: string; status: EvidenceStatus }>;
  diffGateClean: boolean;
  openDecisions: number;
  budgetsExceeded: readonly string[];
}

const COMMITTED_CLEAN = /^git:[0-9a-f]{40}$/;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

export function evaluateG4(facts: G4Facts): GateVerdict {
  const failures: GateFailure[] = [];
  const fail = (rule: (typeof G4_RULES)[number], detail: string): void => {
    failures.push({ rule, detail });
  };

  if (!COMMITTED_CLEAN.test(facts.revision)) {
    fail('revision-clean', `the final revision ${JSON.stringify(facts.revision.slice(0, 80))} is not a committed clean tree`);
  }
  if (facts.blocking.length > 0) {
    const entries = facts.blocking.map((b) => `${b.name} (${b.reason})`);
    fail('checks-delta', `required checks blocking against the baseline: ${sorted(entries).join(', ')}`);
  }
  const unmapped = facts.acceptance.filter((a) => !a.satisfied).map((a) => a.id);
  if (facts.acceptance.length === 0) {
    fail('acceptance-mapped', 'the run has no acceptance criterion to map');
  } else if (unmapped.length > 0) {
    fail('acceptance-mapped', `acceptance criteria with no passed deterministic evidence: ${sorted(unmapped).join(', ')}`);
  }
  const unsettled = facts.requiredEvidence.filter((e) => e.status === 'stale' || e.status === 'inconclusive').map((e) => `${e.name} (${e.status})`);
  if (unsettled.length > 0) {
    fail('no-stale-or-inconclusive', `required evidence that is stale or inconclusive: ${sorted(unsettled).join(', ')}`);
  }
  if (!facts.diffGateClean) {
    fail('diff-gate-clean', 'the diff gate found a change outside the contract');
  }
  if (facts.openDecisions > 0) {
    fail('decisions-closed', `${facts.openDecisions} decision(s) still open`);
  }
  if (facts.budgetsExceeded.length > 0) {
    fail('budgets-within', `budgets exceeded: ${sorted(facts.budgetsExceeded).join(', ')}`);
  }
  return { passed: failures.length === 0, failures };
}
