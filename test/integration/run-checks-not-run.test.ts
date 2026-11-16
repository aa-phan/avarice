// D-35 (plan 03-51; AUT-16, AUT-12): a check the conventions declare and the run does not execute, because it is neither required nor a target, is reported as
// `not run: not required` in `status` (JSON and text), in the review summary (the inbox) and on the evidence line. A real run through `start --wait` with the fake run
// host: the conventions declare `test` (required, the brief's target) and `e2e` (not required; a script that exits 1 if it ever runs). The check is still never run:
// the ledger holds no evidence row for it and G4 passes for the handed-off commit, exactly as without the change. No test calls a real model; no banner is posted.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The script of the not-required check: it writes to stderr and exits 1, so a run that ever executed it would record a failed evidence row.
const E2E_SCRIPT = "process.stderr.write('e2e: this check must not run\\n');\nprocess.exit(1);\n";

const CONVENTIONS = {
  ...RUN_CONVENTIONS_WITH_COMMANDS,
  checks: [
    { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
    { name: 'e2e', argv: ['node', 'scripts/e2e.mjs'], timeoutSec: 60, required: false },
  ],
  // The script sits under a protected glob, so no unit may edit it.
  paths: { write: ['src/**', 'test/**'], protected: ['scripts/**'], artifacts: [] },
};

interface RunJson {
  runId: string;
  [key: string]: unknown;
}

interface Fixture {
  roots: CliRoots;
  runId: string;
  started: ReturnType<typeof startWithFakeRunHost>;
}

function startedRun(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/e2e.mjs': E2E_SCRIPT });
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, CONVENTIONS);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const started = startWithFakeRunHost(roots, repo, brief, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' });
  const match = /^run (run_[0-9A-Z]{26}): /.exec(started.stdout.split('\n')[0] ?? '');
  return { roots, runId: match === null ? '' : (match[1] as string), started };
}

describe('a declared check that is not required is reported as not run, and is still never run (D-35)', () => {
  const f = startedRun();
  const NOT_RUN = [{ name: 'e2e', reason: 'not required' }];

  it('the run reached ready_for_review through start --wait', () => {
    assert.equal(f.started.code, 0, f.started.stderr + f.started.stdout);
    assert.match(f.runId, /^run_[0-9A-Z]{26}$/);
  });

  it('status --json gives the run entry `checksNotRun` as its last key', () => {
    const ran = runCli(['status', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    const [project] = JSON.parse(ran.stdout) as Array<{ runs: RunJson[] }>;
    const run = project?.runs[0] as RunJson;
    assert.equal(run.runId, f.runId);
    const keys = Object.keys(run);
    assert.equal(keys.at(-1), 'checksNotRun', `the last key of the run entry, got ${keys.join(', ')}`);
    assert.deepEqual(run['checksNotRun'], NOT_RUN);
    assert.deepEqual(keys.slice(-4, -1), ['items', 'decisions', 'notifications'], 'the keys before it are the ones a run entry without it has');
  });

  it('status (text) names the check on the evidence line, after the measured entries', () => {
    const ran = runCli(['status'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /^ {2}evidence: test passed, e2e not run: not required$/m);
    assert.match(ran.stdout, /^ {2}evidence: .*e2e not run: not required/m);
  });

  it('inbox --json gives the review entry `checksNotRun` as its last key', () => {
    const ran = runCli(['inbox', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    const view = JSON.parse(ran.stdout) as { reviews: Array<Record<string, unknown>> };
    assert.equal(view.reviews.length, 1);
    const review = view.reviews[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(review), ['runId', 'title', 'branch', 'commit', 'repository', 'checksNotRun']);
    assert.equal(review['runId'], f.runId);
    assert.deepEqual(review['checksNotRun'], NOT_RUN);
  });

  it('inbox (text) prints a `checks <runId>:` line after the reviews table', () => {
    const ran = runCli(['inbox'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split('\n');
    const line = lines.indexOf(`checks ${f.runId}: e2e not run: not required`);
    assert.ok(line > lines.indexOf('reviews:'), `the checks line follows the reviews table:\n${ran.stdout}`);
  });

  it('the ledger holds no evidence row named e2e, and G4 passed for the handed-off commit', () => {
    const evidence = ledgerRows<{ name: string }>(f.roots, 'SELECT e.name FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ?', f.runId);
    assert.ok(evidence.length > 0, 'the required check left evidence');
    assert.deepEqual(
      evidence.filter((row) => row.name === 'e2e'),
      [],
      'D-35 reports the check and never runs it',
    );
    const g4 = ledgerRows<{ passed: number }>(f.roots, "SELECT passed FROM gate_results WHERE run_id = ? AND gate = 'G4' ORDER BY rowid", f.runId);
    assert.ok(g4.length > 0, 'G4 was judged');
    assert.equal((g4.at(-1) as { passed: number }).passed, 1, 'G4 passed');
  });
});
