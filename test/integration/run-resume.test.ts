// `avarice resume <run_id>` (plan 02-17; FR-7, NFR-6, CON-13, CON-16, AC-3): the supervisor of a killed run is killed, `resume` takes the lease once it has
// lapsed, reaps what the dead supervisor left running by session ID, reconciles from the ledger and git (never from chat history), and the run goes on to
// ready_for_review. Every kill here is a real SIGKILL of the detached supervisor process (AVARICE_FAULT, or the fake host dying inside the unit); the
// fake run host plays the unit through the real hook entry; git, the ledger, the lease and the gates are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createDeps } from '../../src/cli/composition.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import {
  RUN_EXPIRY_WAIT_MS,
  ledgerInterruption,
  normalizeRunResult,
  resumeRunCli,
  rows,
  runRunWithFault,
  runStatusJson,
  sleepSync,
  statusCli,
} from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

// Two required checks, so a verification killed after the first has a second that never completed: `test` fails at the pin (the bug) and passes
// once the unit has fixed it, `lint` passes throughout.
const LINT_CHECK = { name: 'lint', argv: ['node', 'scripts/lint-ok.mjs'], timeoutSec: 60, required: true } as const;
const TWO_CHECKS = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, LINT_CHECK], agentCommands: ['npm test'] };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(conventions: unknown = TWO_CHECKS): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/lint-ok.mjs': 'process.exit(0);\n' });
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  return { roots, repo, pin, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

const lines = (stdout: string): string[] => stdout.trim().split('\n');

interface TransitionRow {
  from: string;
  to: string;
  reason: string | null;
}

// The committed run transitions, oldest first, with the `data.reason` the reconcile wrote (a reason on a state other than blocked_on_decision is data).
function transitionsOf(f: Fixture, runId: string): TransitionRow[] {
  return rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE type = 'run.transition' AND run_id = ? ORDER BY seq", runId).map((r) => {
    const data = JSON.parse(r.data_json) as { from: string; to: string; reason?: string };
    return { from: data.from, to: data.to, reason: data.reason ?? null };
  });
}

interface EvidenceDb {
  name: string;
  status: string;
  revision: string;
  environment_json: string;
  created_at: string;
  rowid: number;
}
const checkEvidenceOf = (f: Fixture, runId: string): EvidenceDb[] =>
  rows<EvidenceDb>(
    f.roots,
    "SELECT e.name, e.status, e.revision, e.environment_json, e.created_at, e.rowid FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' ORDER BY e.rowid",
    runId,
  ).filter((r) => (JSON.parse(r.environment_json) as { phase?: string }).phase === 'final');

describe('a run killed during verification is shown paused, then re-verified on resume (S-3, AC-3; tracer)', () => {
  const f = fixture();
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX);
  const { runId } = killed;
  const atKill = ledgerInterruption(f.roots, runId);
  const commitAtKill = rows<{ workspace_path: string }>(f.roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', runId)[0]?.workspace_path ?? '';
  const headAtKill = git(commitAtKill, ['rev-parse', 'HEAD']).trim();
  let resumed: ReturnType<typeof resumeRunCli> | undefined;

  it('`start --wait` reports the interrupted run and the way to continue, and the ledger holds the interrupted attempt', () => {
    assert.equal(killed.start.code, 3);
    assert.match(killed.start.stdout, new RegExp(`^run ${runId}: interrupted in verifying \\(next: verify:checks\\)$`, 'm'));
    assert.match(killed.start.stdout, new RegExp(`^continue with: avarice resume ${runId}$`, 'm'));
    assert.ok(atKill.openAttemptId !== null, 'the attempt is still open: the hand-off ends it');
    assert.equal(atKill.nextAction, 'verify:checks');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.environment_json LIKE '%\"phase\":\"final\"%'", runId)[0]?.n, 1, 'one check of the final pass finished before the kill');
  });

  it('status shows it as paused (verification interrupted), never as ready_for_review', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const text = statusCli(f.roots);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, new RegExp(`^run ${runId}: paused \\(verification interrupted\\)$`, 'm'));
    assert.match(text.stdout, new RegExp(`^ {2}interrupted attempt ${atKill.openAttemptId} at verify:checks$`, 'm'));
    assert.doesNotMatch(text.stdout, /ready_for_review/);
    const json = runStatusJson(f.roots, runId);
    assert.equal(json.state, 'verifying');
    assert.deepEqual(json.interrupted, {
      state: 'verifying',
      presentedAs: 'paused',
      reason: 'verification interrupted',
      attemptId: atKill.openAttemptId,
      step: 'verify:checks',
      nextAction: 'verify:checks',
      resumeCommand: `avarice resume ${runId}`,
    });
  });

  it('refuses while another supervisor holds a live lease: exit 3, `lease must expire first`, nothing changed', () => {
    const composed = createDeps(profileEnv(f.roots), { host: new FakeRunHost({}) });
    assert.ok(composed.ok, 'composition');
    const { deps } = composed.value;
    const versionBefore = rows<{ version: number; lease_fence: number }>(f.roots, 'SELECT version, lease_fence FROM runs WHERE run_id = ?', runId)[0];
    const grant = deps.ledger.acquireRunLease(runId, 'another-supervisor', 120_000, Date.now());
    assert.ok(grant.ok, 'the lapsed lease can be taken by another holder');
    try {
      const refused = resumeRunCli(f.roots, runId, FIX);
      assert.equal(refused.code, 3, refused.stdout + refused.stderr);
      assert.match(refused.stderr, /lease must expire first/);
      assert.doesNotMatch(refused.stdout, /resuming/);
      const versionNow = rows<{ version: number; lease_fence: number }>(f.roots, 'SELECT version, lease_fence FROM runs WHERE run_id = ?', runId)[0];
      assert.equal(versionNow?.version, versionBefore?.version, 'the run row did not move');
      assert.equal(versionNow?.lease_fence, grant.value.fence, 'the other holder still has its lease: resume did not take it');
      assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.status = 'inconclusive'", runId)[0]?.n, 0, 'nothing was reconciled');
    } finally {
      deps.ledger.releaseRunLease(runId, 'another-supervisor', grant.value.fence);
      composed.value.close();
    }
  });

  it('resume prints where it continues from and the interrupted attempt, then the run is ready_for_review (exit 0)', () => {
    resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(lines(resumed.stdout), [
      `run ${runId}: resuming from verifying (next: verify:checks)`,
      `interrupted attempt ${atKill.openAttemptId} at verify:checks`,
      `run ${runId}: ready_for_review`,
    ]);
  });

  it('the ledger moves verifying -> paused (verification interrupted) -> verifying -> ready_for_review', () => {
    const transitions = transitionsOf(f, runId);
    const toVerifying = transitions.findIndex((t) => t.to === 'verifying');
    assert.ok(toVerifying >= 0);
    assert.deepEqual(
      transitions.slice(toVerifying).map((t) => `${t.from}>${t.to}${t.reason !== null ? `:${t.reason}` : ''}`),
      ['running>verifying', 'verifying>paused:verification interrupted', 'paused>verifying', 'verifying>ready_for_review'],
    );
  });

  it('inserts an inconclusive row for the check that had no completed row, none for the one that had, then re-verifies both at the same commit', () => {
    const rowsOf = checkEvidenceOf(f, runId);
    const summary = rowsOf.map((r) => `${r.name}:${r.status}`);
    assert.deepEqual(summary, ['test:passed', 'lint:inconclusive', 'test:passed', 'lint:passed'], 'the interrupted pass, the inconclusive row, then the whole re-verification');
    const revisions = new Set(rowsOf.map((r) => r.revision));
    assert.equal(revisions.size, 1, 'every row of the final pass names the same committed revision');
    assert.equal([...revisions][0], `git:${headAtKill}`);
    const inconclusive = JSON.parse((rowsOf[1] as EvidenceDb).environment_json) as Record<string, unknown>;
    assert.equal(inconclusive['interrupted'], true);
    assert.equal(inconclusive['phase'], 'final');
  });

  it('hands off the commit that was verified, once, and the run shows as ready with its final evidence passed', () => {
    const json = runStatusJson(f.roots, runId);
    assert.equal(json.state, 'ready_for_review');
    assert.equal(json.interrupted, undefined);
    assert.equal(json.commit, headAtKill, 'the commit that was verified is the commit that was handed off');
    assert.deepEqual(
      json.evidence.map((e) => [e.name, e.status]),
      [
        ['test', 'passed'],
        ['lint', 'passed'],
      ],
    );
    assert.equal(git(f.repo.path, ['rev-parse', `refs/heads/avarice/${runId}`]).trim(), headAtKill);
    assert.deepEqual(checkoutSnapshot(f.repo.path), f.before, 'the source checkout is unchanged');
    assert.equal(normalizeRunResult(f.roots, runId).commitCount, 1, 'one commit, made once');
    assert.ok(resumed !== undefined);
  });
});

describe('resume of a run that is already finished, unknown, or an onboarding', () => {
  const f = fixture(RUN_CONVENTIONS);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:handoff:fetch', FIX);
  const { runId } = killed;

  it('a run in a stop state is reported without taking the lease', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const first = resumeRunCli(f.roots, runId, FIX);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.equal(lines(first.stdout).at(-1), `run ${runId}: ready_for_review`);
    const fenceBefore = rows<{ lease_fence: number; version: number }>(f.roots, 'SELECT lease_fence, version FROM runs WHERE run_id = ?', runId)[0];
    const again = resumeRunCli(f.roots, runId, FIX);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(again.stdout.trim(), `run ${runId}: ready_for_review`, 'nothing to resume: the state alone is printed');
    assert.deepEqual(rows(f.roots, 'SELECT lease_fence, version FROM runs WHERE run_id = ?', runId)[0], fenceBefore, 'no lease was taken and nothing moved');
  });

  it('an unknown run ID is a usage error (exit 64)', () => {
    const unknown = resumeRunCli(f.roots, 'run_00000000000000000000000000', FIX);
    assert.equal(unknown.code, 64, unknown.stdout + unknown.stderr);
  });

  it('an onb_ ID keeps its Phase 1 behaviour: an unknown onboarding is a usage error from the onboarding path', () => {
    const unknown = runCli(['resume', 'onb_00000000000000000000000000'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(unknown.code, 64, unknown.stdout + unknown.stderr);
    assert.match(unknown.stderr, /^avarice resume: /);
    assert.doesNotMatch(unknown.stdout + unknown.stderr, /\brun_/, 'no run is involved');
  });
});
