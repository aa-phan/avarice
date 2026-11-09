// Regression charging and one bounded repair (plan 03-19; D-11, AUT-10, AUT-16, S-52). After every item the required checks run on the clone. A check that passed at the
// start of the item (the last committed item's G2 result, else the baseline) and fails now is charged to the item being gated, never to an earlier one. The item gets
// exactly one repair unit on its own work, with the reproducer as data; G2 judges the repaired tree against the item's own base, and the commit holds both units. The fake
// run host plays the units; git, the sandboxed checks, the ledger, the gates and the supervisor commit are real. No test calls a real model.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { FORMAT_CHECK, RUN_CONVENTIONS, ledgerRows } from '../helpers/run-fixtures.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import {
  A_TEST,
  A_UNIT,
  B_FIRST,
  B_REPAIR,
  MARKER_CHECK,
  MARKER_SCRIPT,
  attemptsDb,
  checkpointsOf,
  cloneCommits,
  evidenceOf,
  gatesOf,
  runScenario,
  s52Host,
  scenario,
  stepsOf,
  workspaceOf,
} from '../helpers/repair-scenarios.ts';
import type { Ran, Scenario } from '../helpers/repair-scenarios.ts';
import { itemStatesOf } from '../helpers/independent-work.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const baseOf = (s: Scenario, runId: string): string => (ledgerRows<{ base_revision: string }>(s.roots, 'SELECT base_revision FROM runs WHERE run_id = ?', runId)[0] as { base_revision: string }).base_revision;

describe('S-52 offline: B breaks a test A added, the failure is charged to B, one repair fixes it, A stays done (tracer)', () => {
  let s: Scenario;
  let ran: Ran;
  before(async () => {
    s = scenario(cleanup);
    ran = await runScenario(s, s52Host());
  });

  it('ends ready_for_review with A and B done and one repair attempt of B beside the three units', () => {
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.deepEqual(itemStatesOf(s.roots, ran.runId), [
      ['A', 'done'],
      ['B', 'done'],
    ]);
    assert.deepEqual(
      attemptsDb(s.roots, ran.runId).map((a) => `${a.item_id}:${a.reason}`),
      ['A:initial', 'B:initial', 'B:repair'],
    );
    assert.equal(ran.host.calls.length, 3, 'one unit for A, one for B and one repair of B');
  });

  it("charges the failing check to B: B's first G2 failed on checks-delta with failed evidence that names B, and its second G2 passed", () => {
    const g2 = gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2');
    assert.deepEqual(
      g2.map((g) => `${g.work_item}:${g.passed}`),
      ['A:1', 'B:0', 'B:1'],
    );
    const failures = JSON.parse((g2[1] as { failures_json: string }).failures_json) as Array<{ rule: string; detail: string }>;
    assert.deepEqual(failures.map((f) => f.rule), ['checks-delta']);
    assert.match((failures[0] as { detail: string }).detail, /test \(regressed\)/);
    const failed = evidenceOf(s.roots, ran.runId).filter((e) => e.kind === 'check' && e.name === 'test' && e.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.work_item, 'B');
    assert.equal((JSON.parse((failed[0] as { environment_json: string }).environment_json) as { preExisting?: boolean }).preExisting, undefined, 'a regression is not flagged pre-existing');
  });

  it('gave the repair unit the check name, the command and the failing test as data, and the instruction not to weaken the test', () => {
    const prompt = ran.host.calls[2]?.prompt ?? '';
    assert.match(prompt, /Work item B:/);
    assert.match(prompt, /test/);
    assert.match(prompt, /npm test/);
    assert.ok(prompt.includes(A_TEST.name), 'the failing test ID is in the prompt');
    assert.ok(prompt.includes('Fix the code. Do not delete, skip or change the failing test.'));
    const [step] = stepsOf(s.roots, ran.runId, 'repair:reproducer');
    assert.ok(step !== undefined, 'a repair:reproducer step holds the reproducer');
    assert.deepEqual(step.result['repairFor'], ['test']);
  });

  it('commits B once with the paths of both B units, and A keeps its own commit untouched', () => {
    const commits = cloneCommits(workspaceOf(s.roots, ran.runId), baseOf(s, ran.runId));
    assert.equal(commits.length, 2);
    const commitStepOfA = stepsOf(s.roots, ran.runId, 'commit').find((c) => c.result['attemptId'] === attemptsDb(s.roots, ran.runId)[0]?.attempt_id);
    assert.equal(commits[0]?.sha, commitStepOfA?.result['commit'], "A's commit is the one recorded when A finished");
    assert.deepEqual(commits[0]?.files.sort(), ['src/a-helper.ts', 'test/slug.test.ts']);
    // The slug is back to what the pin had, so the net change of B holds the file each unit added and nothing for the file the repair undid.
    assert.deepEqual(commits[1]?.files.sort(), ['src/b-first.ts', 'src/b-repair.ts']);
    assert.equal(commits[1]?.attempt, attemptsDb(s.roots, ran.runId)[2]?.attempt_id, "B's commit names the repair attempt, the last one");
  });

  it("leaves A's G2 evidence alone: one passed G2 row for A and no stale row, and the repair checkpoint is taken once", () => {
    const rows = gatesOf(s.roots, ran.runId).filter((g) => g.work_item === 'A');
    assert.deepEqual(rows.map((g) => `${g.gate}:${g.passed}`), ['G2:1']);
    assert.equal(checkpointsOf(s.roots, ran.runId).filter((a) => a === 'repair').length, 1);
  });
});

describe('AUT-16 adjacency: a failure that was there before the item is not charged to it', () => {
  it('a check that failed at base and still fails is pre-existing: B starts no repair', async () => {
    const s = scenario(cleanup, {
      files: { 'scripts/format-check.mjs': "process.stderr.write('format check failed\\n');\nprocess.exit(1);\n" },
      conventions: { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, FORMAT_CHECK], agentCommands: ['npm test'] },
    });
    const ran = await runScenario(s, { perItem: { A: A_UNIT, B: { ...B_FIRST, edits: { 'src/b-first.ts': 'export const bFirst = 1;\n' } } } });
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.deepEqual(
      attemptsDb(s.roots, ran.runId).map((a) => a.reason),
      ['initial', 'initial'],
      'no repair attempt',
    );
    const format = evidenceOf(s.roots, ran.runId).filter((e) => e.name === 'format' && e.environment_json.includes('"label":"g2"'));
    assert.equal(format.length, 2, 'the failing check ran after each item');
    for (const row of format) assert.equal((JSON.parse(row.environment_json) as { preExisting?: boolean }).preExisting, true);
  });

  it("a check that failed at base, passed after A and fails after B is charged to B, because the start statuses are A's G2 result", async () => {
    const s = scenario(cleanup, {
      files: { 'src/marker.txt': 'bad\n', 'scripts/marker-check.mjs': MARKER_SCRIPT },
      conventions: { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, MARKER_CHECK], agentCommands: ['npm test'] },
    });
    const a: FakeRunOptions = { edits: { 'src/marker.txt': 'good\n' }, summary: true, verification: 'passed' };
    const b: FakeRunOptions = { ...B_FIRST, edits: { 'src/marker.txt': 'bad\n', 'src/b-first.ts': 'export const bFirst = 1;\n' }, perAttempt: [{}, { ...B_REPAIR, edits: { 'src/marker.txt': 'good\n' } }] };
    const ran = await runScenario(s, { perItem: { A: a, B: b } });
    assert.equal(ran.state, 'ready_for_review', `ended ${ran.state} (${ran.reason ?? 'no reason'})`);
    assert.deepEqual(
      attemptsDb(s.roots, ran.runId).map((x) => `${x.item_id}:${x.reason}`),
      ['A:initial', 'B:initial', 'B:repair'],
    );
    const g2 = gatesOf(s.roots, ran.runId).filter((g) => g.gate === 'G2');
    assert.deepEqual(g2.map((g) => `${g.work_item}:${g.passed}`), ['A:1', 'B:0', 'B:1']);
    const failures = JSON.parse((g2[1] as { failures_json: string }).failures_json) as Array<{ detail: string }>;
    assert.match((failures[0] as { detail: string }).detail, /marker \(regressed\)/);
  });
});
