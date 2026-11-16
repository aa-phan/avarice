// How a run stops when the unit loops or spends a budget (plan 02-16; CON-14, S-15, AUT-7): a hook loop-limit stop and an exhausted budget
// are decisions with a named cause, never a branch. The fake run host plays the unit through the REAL hook entry, so the denial count, the
// `continue: false` output, the `loop.limit` event and the toolCalls charge are the production ones. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_CONVENTIONS_WITH_COMMANDS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

const start = (f: Fixture, run: FakeRunOptions, extraArgs: readonly string[] = []): CliResult => startWithFakeRunHost(f.roots, f.repo, f.brief, run as Record<string, unknown>, extraArgs);

const runIdOf = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
};
const lastLine = (stdout: string): string => stdout.trim().split('\n').at(-1) as string;

const decisionsOf = (f: Fixture, runId: string): Array<{ class: string; issue: string; state: string }> => ledgerRows<{ class: string; issue: string; state: string }>(f.roots, 'SELECT class, issue, state FROM decisions WHERE run_id = ? ORDER BY rowid', runId);
const attemptsOf = (f: Fixture, runId: string): Array<{ ordinal: number; outcome: string | null }> => ledgerRows<{ ordinal: number; outcome: string | null }>(f.roots, 'SELECT ordinal, outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);
const classifyOf = (f: Fixture, runId: string): Record<string, unknown> => JSON.parse(ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'classify'", runId)[0]?.result_json as string) as Record<string, unknown>;
const sourceRefs = (f: Fixture): string[] => git(f.repo.path, ['for-each-ref', '--format=%(refname)', 'refs/heads/avarice/']).split('\n').filter((line) => line !== '');

function assertBlocked(f: Fixture, r: CliResult, reason: string, decisionClass: string): { runId: string; issue: string } {
  const runId = runIdOf(r.stdout);
  assert.equal(r.code, 3, r.stderr + r.stdout);
  assert.equal(lastLine(r.stdout), `run ${runId}: blocked_on_decision (${reason})`);
  const decisions = decisionsOf(f, runId);
  assert.equal(decisions.length, 1, 'one decision');
  assert.equal(decisions[0]?.class, decisionClass);
  assert.equal(decisions[0]?.state, 'open');
  assert.deepEqual(sourceRefs(f), [], 'no refs/heads/avarice/* in the source');
  assert.deepEqual(checkoutSnapshot(f.repo.path), f.before, 'the source checkout is unchanged');
  return { runId, issue: decisions[0]?.issue as string };
}

describe('a loop limit stops the run for escalation (CON-14)', () => {
  it('three denied calls in a row: the hook stops the invocation, and the run is blocked (decision) as repeated_failure naming the limit', () => {
    const f = fixture();
    const r = start(f, { denyLoop: 3 });
    const { runId, issue } = assertBlocked(f, r, 'decision', 'repeated_failure');
    assert.equal(issue, 'loop limit: 3 consecutive denials');
    assert.equal(classifyOf(f, runId)['loopLimit'], 'consecutive-denials');
    const events = ledgerRows<{ run_id: string; invocation_id: string; data_json: string }>(f.roots, "SELECT run_id, invocation_id, data_json FROM events WHERE run_id = ? AND type = 'loop.limit'", runId);
    assert.equal(events.length, 1, 'one loop.limit event');
    assert.equal(events[0]?.run_id, runId);
    assert.deepEqual(JSON.parse(events[0]?.data_json as string), { runId, invocationId: events[0]?.invocation_id, reason: 'consecutive-denials', count: 3, limit: 3 });
    assert.equal(attemptsOf(f, runId).length, 1, 'a loop is not retried');
  });

  it('a unit that loops after doing its work is still escalated: it classified progressed, and nothing was committed', () => {
    const f = fixture();
    const r = start(f, { ...FIX, denyLoop: 3 });
    const { runId, issue } = assertBlocked(f, r, 'decision', 'repeated_failure');
    assert.equal(issue, 'loop limit: 3 consecutive denials');
    const classify = classifyOf(f, runId);
    assert.equal(classify['kind'], 'progressed', 'by the facts alone this unit made its in-scope change and wrote its SUMMARY');
    assert.equal(ledgerRows<{ n: number }>(f.roots, "SELECT COUNT(*) AS n FROM run_steps WHERE run_id = ? AND step IN ('commit', 'discard')", runId)[0]?.n, 0, 'no commit and no discard');
    assert.equal(ledgerRows<{ n: number }>(f.roots, "SELECT COUNT(*) AS n FROM gate_results WHERE run_id = ? AND gate IN ('G2', 'G4')", runId)[0]?.n, 0, 'neither G2 nor G4 ran on a stopped unit');
  });

  it('two denials in a row do not stop the unit (boundary): it is judged as before', () => {
    const f = fixture();
    const r = start(f, { denyLoop: 2 });
    const { runId, issue } = assertBlocked(f, r, 'decision', 'permission');
    assert.match(issue, /denied 2 call\(s\)/);
    assert.equal(classifyOf(f, runId)['loopLimit'], null);
  });

  it('a moved clone HEAD is still the enforcement failure, whatever else the unit did', () => {
    const f = fixture();
    const r = start(f, { denyLoop: 3, commitAttempt: true });
    assertBlocked(f, r, 'enforcement_failure', 'permission');
  });
});

describe('an exhausted budget is a budget decision naming the budget, withdraw only (S-15)', () => {
  it('toolCalls=5 and six calls: kind budget_exhausted, blocked (budget_exhausted), class budget naming toolCalls, the limit unchanged', () => {
    const f = fixture();
    const r = start(f, { toolCallFlood: 6 }, ['--budget', 'toolCalls=5']);
    const { runId, issue } = assertBlocked(f, r, 'budget_exhausted', 'budget');
    assert.match(issue, /toolCalls/);
    assert.equal(classifyOf(f, runId)['kind'], 'budget_exhausted');
    const budget = ledgerRows<{ used: number; limit_value: number }>(f.roots, "SELECT used, limit_value FROM budgets WHERE run_id = ? AND name = 'toolCalls'", runId)[0];
    assert.equal(budget?.limit_value, 5, 'the limit is the one the owner set; nothing raised it');
    assert.equal(budget?.used, 5, 'the five allowed calls stay charged');
    assert.equal(attemptsOf(f, runId).length, 1, 'a spent budget is not retried');
  });

  it('a unit that spends its budget on the way to a long run of denials is a budget decision, not a loop-limit one', () => {
    const f = fixture();
    const r = start(f, FIX, ['--budget', 'toolCalls=2']);
    const { runId, issue } = assertBlocked(f, r, 'budget_exhausted', 'budget');
    assert.match(issue, /toolCalls/);
    assert.equal(classifyOf(f, runId)['kind'], 'budget_exhausted');
  });
});
