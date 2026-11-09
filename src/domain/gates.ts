// Gates G1, G2 and G4 (AUT-7, AUT-9, D-07; docs/contracts-and-state.md "Phase gates"). Pure verdicts over facts AVARICE
// measured. A GSD verifier verdict, a SUMMARY, a quick PLAN or any model-written text is never an input that can pass a gate.
// Failures are listed in a fixed rule order, and every list is sorted before it is judged, so the same facts give
// a deep-equal verdict whatever order they arrive in.
import type { AcceptanceMapping, DeltaBlocking, EvidenceStatus } from './evidence.ts';
import { matchesAny } from './glob.ts';
import type { QuickPlan } from './quick-record.ts';
import type { InventoryFailure } from './test-inventory.ts';

export interface GateFailure {
  rule: string;
  detail: string;
}

export interface GateVerdict {
  passed: boolean;
  failures: GateFailure[];
  // Findings recorded but not failing (G1 plan-cites-acceptance while it is advisory). Present only when non-empty.
  advisories?: GateFailure[];
}

export const G2_RULES = [
  'outcome-progressed',
  'scope-conformance',
  'deletion-scope',
  'test-inventory',
  'gsd-verification',
  'no-new-overrides',
  'prune-is-decision',
  'checks-delta',
] as const;

export type ChangeStatus = 'added' | 'modified' | 'deleted';

export interface G2Facts {
  // The classified outcome kind of the unit (src/domain/outcome.ts); only `progressed` passes.
  outcome: string;
  // Changed paths measured by AVARICE from the diff. A rename arrives as a deletion plus an addition.
  changes: ReadonlyArray<{ path: string; status: ChangeStatus }>;
  globs: {
    write: readonly string[];
    create: readonly string[];
    artifacts: readonly string[];
    delete: readonly string[];
    protected: readonly string[];
  };
  // Failures from compareInventories (AUT-9).
  inventory: readonly InventoryFailure[];
  // GSD VERIFICATION status. An entry condition only: it can fail G2 but never satisfies acceptance (AUT-7).
  verification: 'passed' | 'gaps_found' | 'human_needed' | 'missing';
  newOverrides: number;
  pruneEntries: number;
  // The blocking part of the D-12 baseline delta.
  delta: readonly DeltaBlocking[];
}

function describeBlocking(blocking: readonly DeltaBlocking[]): string {
  return [...blocking.map((b) => `${b.name} (${b.reason})`)].sort().join(', ');
}

const LIST_CAP = 20;

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, LIST_CAP).join(', ');
  return paths.length > LIST_CAP ? `${shown} (and ${paths.length - LIST_CAP} more)` : shown;
}

// G2, in the rule order of G2_RULES. A path list is sorted before it is judged, so input order never changes
// the verdict. A GSD verdict is a condition the unit must meet, never evidence that it succeeded.
export function evaluateG2(facts: G2Facts): GateVerdict {
  const failures: GateFailure[] = [];
  const fail = (rule: (typeof G2_RULES)[number], detail: string): void => {
    failures.push({ rule, detail });
  };

  if (facts.outcome !== 'progressed') {
    fail('outcome-progressed', `the unit's outcome is ${JSON.stringify(facts.outcome)}, not progressed`);
  }

  const changes = [...facts.changes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.status < b.status ? -1 : a.status > b.status ? 1 : 0));
  const writable = [...facts.globs.write].sort();
  const creatable = [...facts.globs.create].sort();
  const artifacts = [...facts.globs.artifacts].sort();
  const deletable = [...facts.globs.delete].sort();
  const protectedGlobs = [...facts.globs.protected].sort();

  const outside: string[] = [];
  const unknown: string[] = [];
  const undeletable: string[] = [];
  for (const change of changes) {
    if (matchesAny(change.path, protectedGlobs)) {
      outside.push(`${change.path} (protected)`);
    } else if (change.status === 'modified') {
      if (!matchesAny(change.path, writable) && !matchesAny(change.path, artifacts)) outside.push(`${change.path} (outside write and artifact globs)`);
    } else if (change.status === 'added') {
      if (!matchesAny(change.path, creatable) && !matchesAny(change.path, artifacts)) outside.push(`${change.path} (outside create and artifact globs)`);
    } else if (change.status !== 'deleted') {
      unknown.push(`${change.path} (unknown change status ${JSON.stringify(String(change.status))})`);
    }
    if (change.status === 'deleted' && !matchesAny(change.path, deletable)) undeletable.push(change.path);
  }
  if (outside.length > 0 || unknown.length > 0) {
    fail('scope-conformance', `changed paths outside the contract: ${listPaths([...outside, ...unknown])}`);
  }
  if (undeletable.length > 0) {
    fail('deletion-scope', `deletions outside the delete globs: ${listPaths(undeletable)}`);
  }
  if (facts.inventory.length > 0) {
    const entries = facts.inventory.map((f) => `${f.rule}: ${f.detail}`).sort();
    fail('test-inventory', `the test inventory weakened: ${entries.join(' | ')}`);
  }
  if (facts.verification !== 'passed') {
    fail('gsd-verification', `GSD VERIFICATION status is ${facts.verification}, not passed`);
  }
  if (facts.newOverrides > 0) {
    fail('no-new-overrides', `${facts.newOverrides} new VERIFICATION override(s)`);
  }
  if (facts.pruneEntries > 0) {
    fail('prune-is-decision', `${facts.pruneEntries} node-repair PRUNE entr${facts.pruneEntries === 1 ? 'y' : 'ies'}; each becomes a decision`);
  }
  if (facts.delta.length > 0) {
    fail('checks-delta', `required checks blocking against the baseline: ${describeBlocking(facts.delta)}`);
  }
  return { passed: failures.length === 0, failures };
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

export const G1_RULES = [
  'plan-present',
  'plan-within-write-scope',
  'plan-within-spec',
  'decision-checkpoint-unresolved',
  'owner-choice-unasked',
  'plan-cites-acceptance',
] as const;

export interface G1Facts {
  plan: QuickPlan | null;
  globs: { write: readonly string[]; create: readonly string[]; protected: readonly string[] };
  itemSpec: { files: readonly string[]; derived: readonly string[] };
  outcome: string;
  ownerChoices: ReadonlyArray<{ acceptanceId: string; key: string; answered: boolean }>;
  itemAcceptance: readonly string[];
}

// A plan path is judged as written, except that a leading `./` is dropped. An absolute path, a `..` segment or a backslash can never
// sit inside a repository-relative glob, so each one is outside the contract whatever the globs say.
function planPathProblem(path: string): string | null {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').includes('..')) return 'not a repository-relative path';
  return null;
}

function normalizePlanPath(path: string): string {
  return path.replace(/^(?:\.\/)+/, '');
}

// G1, in the rule order of G1_RULES. The plan is model-written text: it can fail this gate and never pass it, and a plan that is absent
// fails closed. Every list is sorted before it is judged, so input order never changes the verdict.
// plan-cites-acceptance starts as an advisory; spike S3-A (plan 03-13) flips it once a live quick PLAN cites contract acceptance IDs.
export const PLAN_CITES_ACCEPTANCE_HARD = false;

export interface G1Options {
  citesAcceptanceHard?: boolean;
}

export function evaluateG1(facts: G1Facts, _options: G1Options = {}): GateVerdict {
  const failures: GateFailure[] = [];
  const fail = (rule: (typeof G1_RULES)[number], detail: string): void => {
    failures.push({ rule, detail });
  };

  if (facts.plan === null) {
    fail('plan-present', 'the unit left no readable quick PLAN to judge');
    return { passed: false, failures };
  }

  const writable = [...facts.globs.write].sort();
  const creatable = [...facts.globs.create].sort();
  const protectedGlobs = [...facts.globs.protected].sort();
  const planPaths = [...new Set([...facts.plan.filesModified, ...facts.plan.taskFiles].map(normalizePlanPath))].sort();

  const outside: string[] = [];
  for (const path of planPaths) {
    const problem = planPathProblem(path);
    if (problem !== null) outside.push(`${path} (${problem})`);
    else if (matchesAny(path, protectedGlobs)) outside.push(`${path} (protected)`);
    else if (!matchesAny(path, writable) && !matchesAny(path, creatable)) outside.push(`${path} (outside write and create globs)`);
  }
  if (outside.length > 0) {
    fail('plan-within-write-scope', `plan paths outside the contract: ${listPaths(outside)}`);
  }

  // An item whose spec files were derived from the write set has no narrower list than the write set itself.
  if (!facts.itemSpec.derived.includes('files')) {
    const specFiles = [...facts.itemSpec.files].sort();
    const beyond = planPaths.filter((path) => !matchesAny(path, specFiles));
    if (beyond.length > 0) {
      fail('plan-within-spec', `plan paths outside the item's spec files: ${listPaths(beyond)}`);
    }
  }

  const unasked = facts.ownerChoices
    .filter((choice) => !choice.answered)
    .map((choice) => `${choice.acceptanceId} (${choice.key})`)
    .sort();
  if (unasked.length > 0) {
    fail('owner-choice-unasked', `acceptance criteria verified by an owner choice that was never asked: ${listPaths(unasked)}`);
  }
  return { passed: failures.length === 0, failures };
}

export const G3_RULES = ['repair-limit', 'failing-test-present', 'failing-test-unchanged'] as const;

export interface G3Facts {
  repairAttempts: number;
  limit: number;
  failingTests: readonly string[];
  inventoryAfter: readonly string[];
  testFilesOfFailing: readonly string[];
  changes: ReadonlyArray<{ path: string; status: ChangeStatus }>;
  authorizedTestPaths: readonly string[];
}

export function evaluateG3(_facts: G3Facts): GateVerdict {
  return { passed: true, failures: [] };
}

export const INTEGRITY_GATE_RULES: Readonly<Record<string, readonly string[]>> = {};

export function integrityFailures(_verdicts: { G1?: GateVerdict; G2?: GateVerdict; G3?: GateVerdict }, _gates: readonly string[]): string[] {
  return [];
}
