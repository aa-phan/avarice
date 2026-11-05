// G2 and G4 against what AVARICE measured about the tests (plan 02-14; AUT-9, FR-5, AUT-8): a run cannot pass by deleting, skipping or weakening tests,
// by editing the check configuration, or by a VERIFICATION override, and an acceptance criterion `test:<text>` or `diff:<path> unchanged` is satisfied only by
// evidence AVARICE derived itself. The fake run host plays the unit through the real hook; the inventory, the checks and the gates are real.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_CONVENTIONS_WITH_INVENTORY,
  briefWithAcceptance,
  commitConventions,
  ledgerRows,
  makeRunRepoWithInventory,
  onboardRunRepo,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const TEST_FILE = 'test/slug.test.ts';
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const AC1 = 'Repeated separators collapse to one dash | verifiedBy: check:test';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepoWithInventory();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_INVENTORY);
  return { roots, repo };
}

function start(f: Fixture, run: FakeRunOptions, ...criteria: string[]): { result: CliResult; runId: string } {
  const brief = writeBrief(join(f.roots.base, 'briefs'), briefWithAcceptance(...(criteria.length > 0 ? criteria : [AC1])));
  const result = startWithFakeRunHost(f.roots, f.repo, brief, run as Record<string, unknown>);
  return { result, runId: /^run (run_[0-9A-Z]{26}): /m.exec(result.stdout)?.[1] as string };
}

const gate = (f: Fixture, runId: string, name: 'G2' | 'G4'): { passed: number; failures: Array<{ rule: string; detail: string }> } | undefined => {
  const row = ledgerRows<{ passed: number; failures_json: string }>(f.roots, 'SELECT passed, failures_json FROM gate_results WHERE run_id = ? AND gate = ? ORDER BY rowid DESC', runId, name)[0];
  return row === undefined ? undefined : { passed: row.passed, failures: JSON.parse(row.failures_json) as Array<{ rule: string; detail: string }> };
};

const runOf = (f: Fixture, runId: string): { state: string; reason: string | null } =>
  ledgerRows<{ state: string; reason: string | null }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0] as { state: string; reason: string | null };

const decisionClass = (f: Fixture, runId: string): string | undefined => ledgerRows<{ class: string }>(f.roots, 'SELECT class FROM decisions WHERE run_id = ?', runId)[0]?.class;

// A run that G2 stopped: the gate names the rule, the run is blocked on a decision of the stated class, and nothing was committed.
function assertStoppedAtG2(f: Fixture, runId: string, rule: string, reason: string, klass: string): void {
  assert.deepEqual([runOf(f, runId).state, runOf(f, runId).reason], ['blocked_on_decision', reason]);
  const g2 = gate(f, runId, 'G2');
  assert.equal(g2?.passed, 0);
  assert.ok(g2?.failures.some((x) => x.rule === rule), `G2 names ${rule}, got ${JSON.stringify(g2?.failures.map((x) => x.rule))}`);
  assert.equal(decisionClass(f, runId), klass);
  assert.equal(ledgerRows(f.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'commit'", runId).length, 0, 'nothing was committed');
}

describe('the inventory at the pin is measured by AVARICE and recorded (AUT-9)', () => {
  const f = fixture();
  const { result, runId } = start(f, FIX);

  it('records a base test-inventory evidence row: passed, with the count, the digest and an artifact of the IDs', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const rows = ledgerRows<{ status: string; tests_json: string; artifact_digest: string; environment_json: string; independence: string }>(
      f.roots,
      "SELECT e.status, e.tests_json, e.artifact_digest, e.environment_json, e.independence FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'test-inventory' ORDER BY e.rowid",
      runId,
    );
    assert.deepEqual(rows.map((r) => (JSON.parse(r.environment_json) as { label: string }).label), ['base', 'g2']);
    const base = rows[0];
    assert.equal(base?.status, 'passed');
    assert.equal(base?.independence, 'deterministic');
    const tests = JSON.parse(base?.tests_json as string) as { count: number; idsDigest: string; fileCount: number };
    assert.equal(tests.count, 2);
    assert.equal(tests.fileCount, 1);
    assert.match(tests.idsDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(base?.artifact_digest as string, /^sha256:[0-9a-f]{64}$/);
    assert.equal(ledgerRows(f.roots, "SELECT 1 FROM artifacts WHERE run_id = ? AND kind = 'test-inventory'", runId).length >= 1, true);
  });

  it('measures the inventory after the unit only once the invocation has ended (its evidence event follows invocation.finished)', () => {
    const seq = (sql: string): number => ledgerRows<{ seq: number }>(f.roots, sql, runId)[0]?.seq as number;
    const finished = seq("SELECT seq FROM events WHERE run_id = ? AND type = 'invocation.finished' ORDER BY seq LIMIT 1");
    const after = seq("SELECT MAX(seq) AS seq FROM events WHERE run_id = ? AND type = 'evidence.recorded' AND data_json LIKE '%test-inventory%'");
    assert.ok(finished > 0 && after > finished, `inventory evidence seq ${after} after invocation.finished seq ${finished}`);
  });
});

describe('G2 refuses a unit that weakened the tests or the check configuration (AUT-9)', () => {
  it('a deleted test case (its ID disappears): G2 test-inventory removed-test, blocked (decision), class acceptance', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, deleteTest: { file: TEST_FILE, name: 'lowercases the title' } });
    assertStoppedAtG2(f, runId, 'test-inventory', 'decision', 'acceptance');
    assert.match(gate(f, runId, 'G2')?.failures.find((x) => x.rule === 'test-inventory')?.detail as string, /removed-test: .*lowercases the title/);
  });

  it('a `.skip(` added to an existing test: G2 test-inventory new-skip-marker', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, addSkip: { file: TEST_FILE, name: 'lowercases the title' } });
    assertStoppedAtG2(f, runId, 'test-inventory', 'decision', 'acceptance');
    assert.match(gate(f, runId, 'G2')?.failures.find((x) => x.rule === 'test-inventory')?.detail as string, /new-skip-marker: .*test\/slug\.test\.ts/);
  });

  it('an edit of package.json (a protected check configuration): G2 scope-conformance, an enforcement failure', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, editPackageJson: true });
    assertStoppedAtG2(f, runId, 'scope-conformance', 'enforcement_failure', 'permission');
    assert.match(gate(f, runId, 'G2')?.failures.find((x) => x.rule === 'scope-conformance')?.detail as string, /package\.json \(protected\)/);
  });

  it('a new VERIFICATION override: G2 no-new-overrides', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, addOverride: true });
    assertStoppedAtG2(f, runId, 'no-new-overrides', 'decision', 'acceptance');
  });
});

describe('an acceptance criterion is satisfied only by evidence AVARICE measured (AUT-9, FR-5)', () => {
  it('`test:collapses dashes` is satisfied by a new test of that name in the after-inventory, with the test check passed: ready_for_review', () => {
    const f = fixture();
    const { result, runId } = start(f, { ...FIX, addTest: { file: TEST_FILE, name: 'slug collapses dashes' } }, AC1, 'Dashes collapse | verifiedBy: test:collapses dashes');
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(runOf(f, runId).state, 'ready_for_review');
    assert.equal(gate(f, runId, 'G4')?.passed, 1);
  });

  it('`test:no such test` names no ID in the after-inventory: G4 acceptance-mapped, blocked, no branch', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, addTest: { file: TEST_FILE, name: 'slug collapses dashes' } }, AC1, 'Nothing | verifiedBy: test:no such test');
    assert.equal(runOf(f, runId).state, 'blocked_on_decision');
    const g4 = gate(f, runId, 'G4');
    assert.equal(g4?.passed, 0);
    assert.match(g4?.failures.find((x) => x.rule === 'acceptance-mapped')?.detail as string, /AC2/);
  });

  it('`diff:test/slug.test.ts unchanged` is a passed diff evidence row when the unit left the file alone: ready_for_review', () => {
    const f = fixture();
    const { result, runId } = start(f, FIX, AC1, 'The tests stay as they are | verifiedBy: diff:test/slug.test.ts unchanged');
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const row = ledgerRows<{ status: string; independence: string; revision: string }>(f.roots, "SELECT e.status, e.independence, e.revision FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'diff'", runId)[0];
    assert.deepEqual([row?.status, row?.independence], ['passed', 'deterministic']);
    assert.match(row?.revision as string, /^git:[0-9a-f]{40}$/);
  });

  it('the same criterion fails G4 acceptance-mapped when the unit edited that file', () => {
    const f = fixture();
    const { runId } = start(f, { ...FIX, addTest: { file: TEST_FILE, name: 'slug collapses dashes' } }, AC1, 'The tests stay as they are | verifiedBy: diff:test/slug.test.ts unchanged');
    assert.equal(runOf(f, runId).state, 'blocked_on_decision');
    const row = ledgerRows<{ status: string }>(f.roots, "SELECT e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'diff'", runId)[0];
    assert.equal(row?.status, 'failed');
    assert.ok(gate(f, runId, 'G4')?.failures.some((x) => x.rule === 'acceptance-mapped'));
  });
});
