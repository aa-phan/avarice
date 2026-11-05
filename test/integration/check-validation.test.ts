// ONB-10 active validation of the declared checks, and the D-12 baseline (plan 02-14; ONB-10, AUT-8, FR-5, CON-8; SC 1, SC 4). The fake run host
// plays the unit; everything else is real: git, the validation clone, the sandboxed checks, the ledger, G2 and G4. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_BRIEF,
  RUN_CONVENTIONS_WITH_FORMAT,
  briefTargeting,
  commitConventions,
  ledgerRows,
  makeRunRepoWithFormat,
  onboardRunRepo,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
}

// An onboarded repository with the given conventions committed on top of the pin (D-16).
export function fixture(conventions: unknown = RUN_CONVENTIONS_WITH_FORMAT, extraFiles: Readonly<Record<string, string>> = {}): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepoWithFormat(extraFiles);
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  return { roots, repo, pin };
}

function start(f: Fixture, briefText: string, run: FakeRunOptions = FIX, name = 'brief.md'): CliResult {
  const brief = writeBrief(join(f.roots.base, 'briefs'), briefText, name);
  return startWithFakeRunHost(f.roots, f.repo, brief, run as Record<string, unknown>);
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

interface EvidenceDb {
  name: string;
  kind: string;
  status: string;
  revision: string;
  environment_json: string;
}
const evidenceOf = (f: Fixture, runId: string, label: string): EvidenceDb[] =>
  ledgerRows<EvidenceDb>(
    f.roots,
    "SELECT e.name, e.kind, e.status, e.revision, e.environment_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' ORDER BY e.rowid",
    runId,
  ).filter((e) => (JSON.parse(e.environment_json) as { label: string }).label === label);

const environmentOf = (e: EvidenceDb): Record<string, unknown> => JSON.parse(e.environment_json) as Record<string, unknown>;

const validationsOf = (f: Fixture): Array<{ name: string; verdict: string; detail_json: string }> =>
  ledgerRows(f.roots, 'SELECT name, verdict, detail_json FROM check_validations ORDER BY rowid');

const stepOf = (f: Fixture, runId: string, step: string): { status: string; result: Record<string, unknown> } | undefined => {
  const row = ledgerRows<{ status: string; result_json: string }>(f.roots, 'SELECT status, result_json FROM run_steps WHERE run_id = ? AND step = ?', runId, step)[0];
  return row === undefined ? undefined : { status: row.status, result: JSON.parse(row.result_json) as Record<string, unknown> };
};

describe('a run whose untargeted check already fails at the pin reaches ready_for_review (tracer, D-12, AUT-8)', () => {
  const f = fixture();
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/);
  });

  it('validated both declared checks as active, in declared order, before any invocation', () => {
    assert.deepEqual(validationsOf(f).map((v) => [v.name, v.verdict]), [['test', 'active'], ['format', 'active']]);
    const steps = ledgerRows<{ step: string }>(f.roots, 'SELECT step FROM run_steps WHERE run_id = ? ORDER BY rowid', runId).map((s) => s.step);
    assert.ok(steps.indexOf('checks:validate') < steps.indexOf('baseline'), 'validation before the baseline');
    assert.ok(steps.indexOf('baseline') < steps.indexOf('launch:run'), 'the baseline before the unit');
    const validated = stepOf(f, runId, 'checks:validate');
    assert.equal(validated?.status, 'completed');
    assert.deepEqual((validated?.result['checks'] as Array<{ name: string; verdict: string }>).map((c) => [c.name, c.verdict]), [['test', 'active'], ['format', 'active']]);
  });

  it('records each check at the pin: test failed (the bug), format failed', () => {
    const base = evidenceOf(f, runId, 'base');
    assert.deepEqual(base.map((e) => [e.name, e.status]), [['test', 'failed'], ['format', 'failed']]);
    assert.equal(stepOf(f, runId, 'baseline')?.status, 'completed');
  });

  it('records the final evidence: test passed, format failed and flagged preExisting; G4 passed', () => {
    const final = evidenceOf(f, runId, 'final');
    assert.deepEqual(final.map((e) => [e.name, e.status]), [['test', 'passed'], ['format', 'failed']]);
    assert.equal(environmentOf(final[0] as EvidenceDb)['preExisting'], undefined);
    assert.equal(environmentOf(final[1] as EvidenceDb)['preExisting'], true);
    const gates = ledgerRows<{ gate: string; passed: number }>(f.roots, "SELECT gate, passed FROM gate_results WHERE run_id = ? AND gate IN ('G2', 'G4') ORDER BY rowid", runId);
    assert.deepEqual(gates.map((g) => [g.gate, g.passed]), [['G2', 1], ['G4', 1]]);
  });

  it('lists the pre-existing failure in the ready_for_review transition', () => {
    const events = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId);
    const last = JSON.parse(events.at(-1)?.data_json as string) as Record<string, unknown>;
    assert.equal(last['to'], 'ready_for_review');
    assert.equal(last['preExisting'], 'format');
  });

  it('opens one attempt for the whole run: the baseline opens it and the unit adopts it', () => {
    const attempts = ledgerRows<{ reason: string; outcome: string }>(f.roots, 'SELECT reason, outcome FROM attempts WHERE run_id = ?', runId);
    assert.deepEqual(attempts.map((a) => [a.reason, a.outcome]), [['initial', 'handed-off']]);
  });

  it('a second run on the same pin and checks reuses the two verdicts and adds no validation row', () => {
    const second = start(f, RUN_BRIEF, FIX, 'second.md');
    assert.equal(second.code, 0, second.stderr + second.stdout);
    const secondId = runIdOf(second.stdout);
    assert.notEqual(secondId, runId);
    assert.equal(validationsOf(f).length, 2, 'no new check_validations row');
    assert.equal(stepOf(f, secondId, 'checks:validate')?.result['reused'], 2);
  });
});

describe('a brief that targets the check that fails at the pin blocks the run (D-12)', () => {
  const f = fixture();
  const result = start(f, briefTargeting('test', 'format'));
  const runId = runIdOf(result.stdout);

  it('ends blocked_on_decision (decision) with a checks-delta failure naming format as target-not-passed, and no branch', () => {
    assert.equal(result.code, 3, result.stderr + result.stdout);
    const run = ledgerRows<{ state: string; reason: string }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0];
    assert.deepEqual([run?.state, run?.reason], ['blocked_on_decision', 'decision']);
    // G2 holds the checks delta (docs/contracts-and-state.md), so the failing target stops the unit there, before the commit.
    const gate = ledgerRows<{ gate: string; failures_json: string }>(f.roots, "SELECT gate, failures_json FROM gate_results WHERE run_id = ? AND passed = 0", runId)[0];
    assert.equal(gate?.gate, 'G2');
    assert.match(gate?.failures_json as string, /checks-delta/);
    assert.match(gate?.failures_json as string, /format \(target-not-passed\)/);
    assert.equal(ledgerRows(f.roots, 'SELECT 1 FROM run_steps WHERE run_id = ? AND step = ?', runId, 'commit').length, 0, 'nothing was committed');
  });
});
