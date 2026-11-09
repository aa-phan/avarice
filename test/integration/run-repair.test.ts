// A repair cannot waive a failing check (plan 03-19; D-11, AUT-9, AUT-10, S-21). A required check that the first unit broke gets one repair unit, and the repair is judged twice:
// gate G3 on its own diff (the failing test must still be there, and its file must not have changed) and gate G2 on the whole item against its own base (no new override, no
// new skip marker, no removed test, the check passing). A repair that deletes, skips or edits the failing test, adds an override, or leaves the check failing, ends in a
// repeated_failure decision with the smallest reproducer; no second repair runs. The fake run host plays the units; git, the sandboxed checks, the ledger and the gates are real.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { optionsOf } from '../../src/domain/decision-policy.ts';
import { FIXED_SLUG, ledgerRows } from '../helpers/run-fixtures.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decisionsOf, itemStatesOf } from '../helpers/independent-work.ts';
import {
  S21_TEST_ID,
  S21_TEST_NAME,
  attemptsDb,
  cloneCommits,
  gatesOf,
  runScenario,
  s21Host,
  s21Scenario,
  stepsOf,
  workspaceOf,
} from '../helpers/repair-scenarios.ts';
import type { Ran, Scenario } from '../helpers/repair-scenarios.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The repair that fixes the code and leaves one change of its own behind (the slug alone would put the repository back to the pin, with nothing to commit).
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG, 'src/helper.ts': 'export const helper = 1;\n' } };
// A first unit that changes something in scope and leaves every required check passing (the slug of this repository is already fixed).
const CHANGE: FakeRunOptions = { edits: { 'src/helper.ts': 'export const helper = 1;\n' } };

interface Failure {
  rule: string;
  detail: string;
}

const failuresOf = (row: { failures_json: string } | undefined): Failure[] => (row === undefined ? [] : (JSON.parse(row.failures_json) as Failure[]));
const baseOf = (s: Scenario, runId: string): string => (ledgerRows<{ base_revision: string }>(s.roots, 'SELECT base_revision FROM runs WHERE run_id = ?', runId)[0] as { base_revision: string }).base_revision;
const invocationsUsed = (s: Scenario, runId: string): number => (ledgerRows<{ used: number }>(s.roots, "SELECT used FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0] as { used: number }).used;

interface Expect {
  g3: string[];
  g2: string[];
  // Text the G2 failure detail must hold (an inventory rule is named in the detail).
  g2Detail?: RegExp;
}

// What every repair that ends in a decision leaves: one repair and no second, the item parked and blocked, the decision with the reproducer, nothing committed.
function assertRepairDecision(s: Scenario, ran: Ran, expected: Expect): void {
  assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
  assert.equal(ran.reason, 'decision');
  assert.deepEqual(
    attemptsDb(s.roots, ran.runId).map((a) => a.reason),
    ['initial', 'repair'],
    'one repair, and no second one',
  );
  assert.equal(ran.host.calls.length, 2);
  assert.equal(invocationsUsed(s, ran.runId), 2);
  assert.deepEqual(itemStatesOf(s.roots, ran.runId), [['A', 'blocked_on_decision']]);
  assert.equal(stepsOf(s.roots, ran.runId, 'park').filter((p) => p.status === 'completed').length, 1, "the item's delta is parked");
  assert.equal(cloneCommits(workspaceOf(s.roots, ran.runId), baseOf(s, ran.runId)).length, 0, 'nothing is committed');

  const g3 = gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G3');
  assert.equal(g3.length, 1);
  assert.equal(g3[0]?.passed, expected.g3.length === 0 ? 1 : 0);
  assert.deepEqual(failuresOf(g3[0]).map((f) => f.rule), expected.g3);
  const g2 = gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2');
  const last = g2.at(-1);
  assert.equal(last?.passed, 0, 'G2 judged the repaired tree and failed');
  assert.deepEqual(failuresOf(last).map((f) => f.rule), expected.g2);
  if (expected.g2Detail !== undefined) assert.match(failuresOf(last).map((f) => f.detail).join(' '), expected.g2Detail);

  const decisions = decisionsOf(s.roots, ran.runId);
  assert.equal(decisions.length, 1);
  const decision = decisions[0];
  assert.equal(decision?.class, 'repeated_failure');
  assert.deepEqual((optionsOf(JSON.parse(decision?.options_json ?? '[]')) as Array<{ kind: string }>).map((o) => o.kind), ['withdraw'], 'a repeated failure offers withdraw only');
  assert.deepEqual(JSON.parse(decision?.affected_items_json ?? '[]'), ['A']);
  const refs = JSON.parse((ledgerRows<{ evidence_refs_json: string }>(s.roots, 'SELECT evidence_refs_json FROM decisions WHERE run_id = ?', ran.runId)[0] as { evidence_refs_json: string }).evidence_refs_json) as string[];
  assert.ok(refs.includes('check:test'), `the decision names the check: ${JSON.stringify(refs)}`);
  assert.ok(refs.some((r) => /^output:sha256:[0-9a-f]{64}$/.test(r)), 'the decision names the digest of the output');
  assert.ok(refs.includes(`test:${S21_TEST_NAME}`), 'the decision names the failing test');
  assert.match(decision?.issue ?? '', /test \(npm test\) exited 1/);

  const [reproducer] = stepsOf(s.roots, ran.runId, 'repair:reproducer');
  assert.ok(reproducer !== undefined, 'a repair:reproducer step holds the reproducer');
  assert.deepEqual(reproducer.result['repairFor'], ['test']);
  assert.deepEqual(reproducer.result['failingTestIds'], [S21_TEST_ID]);
  const stored = (reproducer.result['reproducers'] as Array<{ check: string; command: string; failingTests: string[]; outputDigest: string; diff: { paths: string[] } }>)[0];
  assert.equal(stored?.check, 'test');
  assert.equal(stored?.command, 'npm test');
  assert.deepEqual(stored?.failingTests, [S21_TEST_NAME]);
  assert.match(stored?.outputDigest ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.ok(stored?.diff.paths.includes('src/slug.ts'), 'the diff since the last pass names the file the unit changed');
}

describe('S-21 offline: a repair that fixes the code passes G3 and G2 (the control)', () => {
  it('commits one change for the item, with G3 passed and the reproducer step recorded', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host(FIX));
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.deepEqual(
      gatesOf(s.roots, ran.runId).map((g) => `${g.gate}:${g.passed}`),
      ['G0:1', 'G1:1', 'G2:0', 'G1:1', 'G3:1', 'G2:1', 'G4:1'],
    );
    assert.equal(cloneCommits(workspaceOf(s.roots, ran.runId), baseOf(s, ran.runId)).length, 1);
    const [step] = stepsOf(s.roots, ran.runId, 'repair:reproducer');
    assert.deepEqual(step?.result['failingTestIds'], [S21_TEST_ID]);
    assert.deepEqual(step?.result['testFiles'], ['test/slug.test.ts']);
  });
});

describe('a repair that puts the repository back to the pin leaves the item nothing to commit', () => {
  it('passes G3 and G2, and ends in a decision instead of an empty commit', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host({ edits: { 'src/slug.ts': FIXED_SLUG } }));
    assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.equal(ran.reason, 'decision');
    assert.deepEqual(gatesOf(s.roots, ran.runId).map((g) => `${g.gate}:${g.passed}`), ['G0:1', 'G1:1', 'G2:0', 'G1:1', 'G3:1', 'G2:1']);
    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decision?.class, 'repeated_failure');
    assert.match(decision?.issue ?? '', /no change of the item is left to commit/);
    assert.equal(cloneCommits(workspaceOf(s.roots, ran.runId), baseOf(s, ran.runId)).length, 0);
    assert.deepEqual(itemStatesOf(s.roots, ran.runId), [['A', 'blocked_on_decision']]);
  });
});

describe('S-21 offline: each way a repair can weaken the check ends in a repeated_failure decision with the reproducer (T-03-36)', () => {
  it('the repair deletes the failing test: G3 fails failing-test-present and failing-test-unchanged, and G2 fails the inventory', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host({ deleteTest: { file: 'test/slug.test.ts', name: S21_TEST_NAME } }));
    assertRepairDecision(s, ran, { g3: ['failing-test-present', 'failing-test-unchanged'], g2: ['test-inventory'], g2Detail: /removed-test/ });
  });

  it('the repair marks the failing test .skip: G3 fails failing-test-unchanged and G2 fails new-skip-marker', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host({ addSkip: { file: 'test/slug.test.ts', name: S21_TEST_NAME } }));
    assertRepairDecision(s, ran, { g3: ['failing-test-unchanged'], g2: ['test-inventory'], g2Detail: /new-skip-marker/ });
  });

  it('the repair fixes the code and adds a VERIFICATION override: G2 fails no-new-overrides', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host({ ...FIX, addOverride: true }));
    assertRepairDecision(s, ran, { g3: [], g2: ['no-new-overrides'] });
  });

  it('the repair leaves the check failing: G2 fails checks-delta again, and the limit of one repair is reached', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host({ brokenFix: true }));
    assertRepairDecision(s, ran, { g3: [], g2: ['checks-delta'] });
  });
});

describe('S-21 offline: when no repair runs, the decision says why', () => {
  it('with the invocations budget spent before the repair, no repair runs and the decision names the budget', async () => {
    const s = s21Scenario(cleanup);
    const ran = await runScenario(s, s21Host(FIX), {}, { invocations: 1 });
    assert.equal(ran.state, 'blocked_on_decision');
    assert.equal(ran.reason, 'budget_exhausted');
    assert.deepEqual(
      attemptsDb(s.roots, ran.runId).map((a) => a.reason),
      ['initial'],
    );
    assert.equal(ran.host.calls.length, 1);
    const [decision] = decisionsOf(s.roots, ran.runId);
    assert.equal(decision?.class, 'budget');
    assert.match(decision?.issue ?? '', /invocations budget is spent/);
    assert.equal(stepsOf(s.roots, ran.runId, 'repair:reproducer').length, 0);
  });

  const direct: Array<{ name: string; first: FakeRunOptions; reason: string; cls: string; rule: RegExp }> = [
    { name: 'a first unit that adds a VERIFICATION override', first: { ...CHANGE, addOverride: true }, reason: 'decision', cls: 'acceptance', rule: /no-new-overrides/ },
    { name: 'a first unit that records a node-repair PRUNE entry', first: { ...CHANGE, summaryText: '[Node Repair - PRUNE] Task 2 skipped: it cannot be done' }, reason: 'decision', cls: 'acceptance', rule: /prune-is-decision/ },
    { name: 'a first unit that writes a file outside the write set', first: { ...CHANGE, strayWrite: { 'docs/outside.md': 'outside\n' } }, reason: 'enforcement_failure', cls: 'permission', rule: /scope-conformance/ },
  ];
  for (const c of direct) {
    it(`${c.name} opens a decision directly: no repair unit runs`, async () => {
      const s = s21Scenario(cleanup);
      const ran = await runScenario(s, { ...c.first, summary: true, verification: 'passed' });
      assert.equal(ran.state, 'blocked_on_decision', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
      assert.equal(ran.reason, c.reason);
      assert.deepEqual(
        attemptsDb(s.roots, ran.runId).map((a) => a.reason),
        ['initial'],
        'no repair attempt',
      );
      assert.equal(ran.host.calls.length, 1);
      assert.equal(stepsOf(s.roots, ran.runId, 'repair:reproducer').length, 0);
      assert.equal(gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G3').length, 0, 'G3 judges a repair only');
      const decisions = decisionsOf(s.roots, ran.runId);
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0]?.class, c.cls);
      assert.match(failuresOf(gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2').at(-1)).map((f) => f.rule).join(','), c.rule);
    });
  }
});
