// `avarice resume <run_id>` (plan 02-17; FR-7, NFR-6, CON-13, CON-16, AC-3): the supervisor of a killed run is killed, `resume` takes the lease once it has
// lapsed, reaps what the dead supervisor left running by session ID, reconciles from the ledger and git (never from chat history), and the run goes on to
// ready_for_review. Every kill here is a real SIGKILL of the detached supervisor process (AVARICE_FAULT, or the fake host dying inside the unit); the
// fake run host plays the unit through the real hook entry; git, the ledger, the lease and the gates are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
  runSurvivorPidFile,
  sleepSync,
  statusCli,
} from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
// Host processes the kill cases leave running on purpose (the host of a supervisor that died inside its unit): ended in `after`.
const survivors: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

after(() => {
  for (const pid of survivors) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
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

// ---- an item in flight when the supervisor died (Task 2) ---------------------------------------------------------------------------------------

const ONE_CHECK = RUN_CONVENTIONS_WITH_COMMANDS;
const MARKER = 'partial write of a unit whose supervisor was killed';

const cloneOf = (f: Fixture, runId: string): string => (rows<{ workspace_path: string }>(f.roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', runId)[0] as { workspace_path: string }).workspace_path;
const runRow = (f: Fixture, runId: string): { state: string; version: number; reason: string | null } =>
  rows<{ state: string; version: number; reason: string | null }>(f.roots, 'SELECT state, version, reason FROM runs WHERE run_id = ?', runId)[0] as { state: string; version: number; reason: string | null };
const itemStateOf = (f: Fixture, runId: string): string => (rows<{ state: string }>(f.roots, 'SELECT state FROM work_items WHERE run_id = ?', runId)[0] as { state: string }).state;

interface StepDb {
  attempt: number;
  status: string;
  result: Record<string, unknown>;
}
const stepsNamed = (f: Fixture, runId: string, name: string): StepDb[] =>
  rows<{ attempt: number; status: string; result_json: string }>(f.roots, 'SELECT attempt, status, result_json FROM run_steps WHERE run_id = ? AND step = ? ORDER BY attempt', runId, name).map((r) => ({
    attempt: r.attempt,
    status: r.status,
    result: JSON.parse(r.result_json) as Record<string, unknown>,
  }));

interface AttemptDb {
  attempt_id: string;
  ordinal: number;
  reason: string;
  outcome: string | null;
}
const attemptsOf = (f: Fixture, runId: string): AttemptDb[] => rows<AttemptDb>(f.roots, 'SELECT attempt_id, ordinal, reason, outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);
const budgetOf = (f: Fixture, runId: string, name: string): { used: number; reserved: number; limit_value: number } =>
  rows<{ used: number; reserved: number; limit_value: number }>(f.roots, 'SELECT used, reserved, limit_value FROM budgets WHERE run_id = ? AND name = ?', runId, name)[0] as { used: number; reserved: number; limit_value: number };
const eventSeqs = (f: Fixture, runId: string, type: string): number[] => rows<{ seq: number }>(f.roots, 'SELECT seq FROM events WHERE run_id = ? AND type = ? ORDER BY seq', runId, type).map((r) => r.seq);
const transitionSeq = (f: Fixture, runId: string, from: string, to: string): number | undefined =>
  rows<{ seq: number; data_json: string }>(f.roots, "SELECT seq, data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId).find((r) => {
    const d = JSON.parse(r.data_json) as { from: string; to: string };
    return d.from === from && d.to === to;
  })?.seq;
const contractOf = (f: Fixture, runId: string): { budgets: { invocations: number; toolCalls: number; wallClockMinutes: number; costUsd: { perRun: number; perInvocation: number } } } =>
  JSON.parse(readFileSync(join(f.roots.AVARICE_DATA_ROOT, 'runs', runId, 'contract-v1.json'), 'utf8')) as ReturnType<typeof contractOf>;

describe('a supervisor killed inside the unit leaves its host running: a failed reap stops the resume, a good one comes first, then discard and retry (FR-7, CON-16, CON-13)', () => {
  const f = fixture(ONE_CHECK);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-invocation:run', FIX);
  const { runId } = killed;
  const clone = cloneOf(f, runId);
  const survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim());
  survivors.push(survivor);
  const atKill = ledgerInterruption(f.roots, runId);
  const cloneDigest = (): string => `${git(clone, ['status', '--porcelain=v2', '--untracked-files=all'])}\n${readFileSync(join(clone, 'src', 'slug.ts'), 'utf8')}`;
  const dirty = cloneDigest();

  it('after the kill the host that carries the session ID is alive, its launch is `started`, and the unit left a partial write in the clone', () => {
    assert.ok(Number.isInteger(survivor) && survivor > 1, 'the fake host recorded the survivor PID');
    assert.ok(isAlive(survivor), 'the host outlived its supervisor');
    assert.deepEqual(stepsNamed(f, runId, 'launch:run').map((s) => [s.attempt, s.status]), [[1, 'started']]);
    assert.match(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8'), new RegExp(MARKER));
    assert.equal(itemStateOf(f, runId), 'delegated');
    assert.ok(atKill.openAttemptId !== null && atKill.startedStep === 'launch:run');
  });

  it('a reap that fails stops the resume (exit 70) with the launch still `started`, the host alive and nothing in the clone or the run changed', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const before = runRow(f, runId);
    const resumed = resumeRunCli(f.roots, runId, { ...FIX, reapFails: true });
    assert.equal(resumed.code, 70, resumed.stdout + resumed.stderr);
    assert.match(resumed.stderr, /could not be resumed/);
    assert.match(resumed.stderr, /could not search for processes/);
    assert.deepEqual(stepsNamed(f, runId, 'launch:run').map((s) => [s.attempt, s.status]), [[1, 'started']], 'every row is still started');
    assert.ok(isAlive(survivor), 'the host was not touched');
    assert.equal(cloneDigest(), dirty, 'nothing in the clone changed');
    assert.deepEqual(runRow(f, runId), before, 'the run did not move');
    assert.equal(attemptsOf(f, runId).length, 1, 'no second attempt');
    assert.equal(eventSeqs(f, runId, 'invocation.reaped').length, 0);
    assert.equal(stepsNamed(f, runId, 'discard').length, 0);
  });

  it('the next resume reaps the host first, then discards the clone to the attempt snapshot and retries once, and the run is ready_for_review', () => {
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(lines(resumed.stdout), [
      `run ${runId}: resuming from running (next: launch:run)`,
      `interrupted attempt ${atKill.openAttemptId} at launch:run`,
      `run ${runId}: ready_for_review`,
    ]);
    assert.equal(isAlive(survivor), false, 'the resume ended the host that carried the interrupted session ID');
    const reaped = rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'invocation.reaped'", runId);
    assert.equal(reaped.length, 1);
    assert.equal((JSON.parse((reaped[0] as { data_json: string }).data_json) as { terminated: number }).terminated, 1);
    assert.deepEqual(stepsNamed(f, runId, 'launch:run').map((s) => [s.attempt, s.status]), [
      [1, 'interrupted'],
      [2, 'completed'],
    ]);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.reason, a.outcome]), [
      [1, 'initial', 'discarded'],
      [2, 'con16-retry', 'handed-off'],
    ]);
    assert.equal(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8'), FIXED_SLUG, 'the partial write is gone: the retry began from the snapshot');
    assert.deepEqual(git(clone, ['diff', '--name-only', f.pin, 'HEAD']).trim().split('\n'), ['src/slug.ts']);
  });

  it('ordering edge: the reap is recorded before the run is paused, and the pause before the retry attempt starts', () => {
    const reaped = eventSeqs(f, runId, 'invocation.reaped')[0] as number;
    const paused = transitionSeq(f, runId, 'running', 'paused') as number;
    const back = transitionSeq(f, runId, 'paused', 'running') as number;
    const retryStarted = eventSeqs(f, runId, 'attempt.started')[1] as number;
    assert.ok(reaped < paused, 'reap before reconcile');
    assert.ok(paused < back && back < retryStarted, 'reconcile before any stage runs again');
    const interrupted = eventSeqs(f, runId, 'invocation.interrupted');
    assert.equal(interrupted.length, 1);
    assert.ok(reaped < (interrupted[0] as number), 'the launch is marked interrupted only after the host is gone');
  });

  it('the killed invocation stays charged: 2 invocations used, cost at least its reservation, every limit as the contract set it (CON-13)', () => {
    const budgets = contractOf(f, runId).budgets;
    const invocations = budgetOf(f, runId, 'invocations');
    assert.equal(invocations.used, 2);
    assert.equal(invocations.reserved, 0);
    assert.equal(invocations.limit_value, budgets.invocations);
    assert.ok(budgetOf(f, runId, 'costUsd').used >= Math.min(budgets.costUsd.perInvocation, budgets.costUsd.perRun), 'the killed invocation was charged its cost reservation');
    assert.equal(budgetOf(f, runId, 'costUsd').limit_value, budgets.costUsd.perRun);
    assert.equal(budgetOf(f, runId, 'toolCalls').limit_value, budgets.toolCalls);
    assert.equal(budgetOf(f, runId, 'wallClockMs').limit_value, budgets.wallClockMinutes * 60_000);
    assert.equal(eventSeqs(f, runId, 'invocation.orphan-charged').length, 1);
  });
});

describe('a supervisor killed between the commit and its record: the commit is recognised by its trailer and kept, never repeated (FR-7, T-02-57)', () => {
  const f = fixture(ONE_CHECK);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-commit', FIX);
  const { runId } = killed;
  const clone = cloneOf(f, runId);
  const atKill = ledgerInterruption(f.roots, runId);
  const headAtKill = git(clone, ['rev-parse', 'HEAD']).trim();

  it('the commit exists with the open attempt in its trailer, and the ledger has neither the commit step nor a done item', () => {
    assert.notEqual(headAtKill, f.pin, 'the supervisor committed before it died');
    assert.match(git(clone, ['log', '-1', '--format=%B']), new RegExp(`^Avarice-Attempt: ${atKill.openAttemptId}$`, 'm'));
    assert.deepEqual(stepsNamed(f, runId, 'commit'), []);
    assert.equal(itemStateOf(f, runId), 'gated');
    assert.equal(atKill.nextAction, 'commit');
  });

  it('resume records the item checkpoint with that commit and goes on to verifying with no second commit', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, {});
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(lines(resumed.stdout), [
      `run ${runId}: resuming from running (next: commit)`,
      `interrupted attempt ${atKill.openAttemptId} at commit`,
      `run ${runId}: ready_for_review`,
    ]);
    const commit = stepsNamed(f, runId, 'commit');
    assert.equal(commit.length, 1);
    assert.equal(commit[0]?.result['commit'], headAtKill);
    assert.equal(commit[0]?.result['attemptId'], atKill.openAttemptId);
    assert.equal(commit[0]?.result['reconciled'], true);
    assert.equal(git(clone, ['rev-parse', 'HEAD']).trim(), headAtKill, 'HEAD is the commit made before the kill');
    assert.equal(normalizeRunResult(f.roots, runId).commitCount, 1);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.outcome]), [[1, 'handed-off']], 'no retry: the unit had finished');
    assert.equal(budgetOf(f, runId, 'invocations').used, 1);
    assert.equal(transitionSeq(f, runId, 'running', 'paused'), undefined, 'the run was not paused: nothing in the unit was interrupted');
  });
});

describe('a commit on the clone that the supervisor did not make for the open attempt is a containment failure, not the item\'s commit (T-02-57)', () => {
  const f = fixture(ONE_CHECK);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-commit', FIX);
  const { runId } = killed;
  const clone = cloneOf(f, runId);

  it('HEAD moved with no Avarice-Attempt trailer: the run blocks with enforcement_failure, records no commit and hands nothing off', () => {
    git(clone, ['-c', 'user.name=Bypass', '-c', 'user.email=bypass@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--amend', '-q', '-m', 'a commit that is not the supervisor\'s']);
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, {});
    assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
    assert.equal(lines(resumed.stdout).at(-1), `run ${runId}: blocked_on_decision (enforcement_failure)`);
    assert.deepEqual(stepsNamed(f, runId, 'commit'), []);
    assert.equal(stepsNamed(f, runId, 'handoff:fetch').length, 0);
    assert.equal(runRow(f, runId).reason, 'enforcement_failure');
    assert.deepEqual(rows(f.roots, 'SELECT class FROM decisions WHERE run_id = ?', runId), [{ class: 'permission' }]);
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'containment.finding'", runId)[0]?.n, 1);
    assert.equal(git(f.repo.path, ['branch', '--list', `avarice/${runId}`]).trim(), '', 'no ref was handed to the source');
  });
});

describe('a supervisor killed between the fetch and its record: the hand-off is repeated and is idempotent (FR-7)', () => {
  const f = fixture(ONE_CHECK);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-handoff', FIX);
  const { runId } = killed;
  const headAtKill = git(cloneOf(f, runId), ['rev-parse', 'HEAD']).trim();

  it('the ref is in the source but no handoff step is recorded and the run is still verifying', () => {
    assert.equal(git(f.repo.path, ['rev-parse', `refs/heads/avarice/${runId}`]).trim(), headAtKill);
    assert.deepEqual(stepsNamed(f, runId, 'handoff:fetch'), []);
    assert.equal(runRow(f, runId).state, 'verifying');
  });

  it('resume repeats the fetch (created false), records it once and reaches ready_for_review on the same commit', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, {});
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(lines(resumed.stdout).at(-1), `run ${runId}: ready_for_review`);
    const handoff = stepsNamed(f, runId, 'handoff:fetch');
    assert.equal(handoff.length, 1);
    assert.equal(handoff[0]?.result['created'], false, 'the ref already existed at that commit');
    assert.equal(handoff[0]?.result['commit'], headAtKill);
    assert.equal(git(f.repo.path, ['rev-parse', `refs/heads/avarice/${runId}`]).trim(), headAtKill);
    assert.equal(eventSeqs(f, runId, 'handoff.fetched').length, 1);
    assert.deepEqual(
      rows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId),
      [{ state: 'ready_for_review' }],
    );
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.status = 'inconclusive'", runId)[0]?.n, 0, 'the checks had all finished: nothing is marked interrupted');
  });
});

describe('a unit that crashed and a supervisor killed at its discard-attempt checkpoint: resume discards to the snapshot and retries (CON-16)', () => {
  const f = fixture(ONE_CHECK);
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:discard-attempt', { perAttempt: [{ crash: { afterFiles: ['src/slug.ts', 'src/extra.ts'] } }, FIX] });
  const { runId } = killed;
  const clone = cloneOf(f, runId);

  it('the crashed unit\'s files are still in the clone when the supervisor dies: the restore had not begun', () => {
    assert.equal(existsSync(join(clone, 'src', 'extra.ts')), true);
    assert.equal(itemStateOf(f, runId), 'delegated');
    assert.deepEqual(stepsNamed(f, runId, 'discard'), []);
  });

  it('resume restores the clone, retries once and reaches ready_for_review; the crashed attempt is `discarded`, the retry handed off', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(lines(resumed.stdout).at(-1), `run ${runId}: ready_for_review`);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.reason, a.outcome]), [
      [1, 'initial', 'discarded'],
      [2, 'con16-retry', 'handed-off'],
    ]);
    assert.equal(stepsNamed(f, runId, 'discard').length, 1);
    assert.equal(existsSync(join(clone, 'src', 'extra.ts')), false);
    assert.equal(budgetOf(f, runId, 'invocations').used, 2);
    assert.deepEqual(git(clone, ['diff', '--name-only', f.pin, 'HEAD']).trim().split('\n'), ['src/slug.ts']);
  });
});

describe('edges: a run killed before it leaves contract_ready, and between the two commits of one checkpoint (FR-7)', () => {
  it('empty edge: killed at the baseline checkpoint, resume continues from the first incomplete action and repeats nothing that completed', () => {
    const f = fixture(ONE_CHECK);
    const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:baseline', FIX);
    assert.equal(runRow(f, runId).state, 'contract_ready');
    assert.deepEqual(stepsNamed(f, runId, 'baseline'), []);
    assert.equal(attemptsOf(f, runId).length, 0, 'no unit and no baseline attempt yet');
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(lines(resumed.stdout), [
      `run ${runId}: resuming from contract_ready (next: baseline)`,
      'interrupted at baseline',
      `run ${runId}: ready_for_review`,
    ]);
    assert.equal(stepsNamed(f, runId, 'workspace:prepare').length, 1, 'the workspace was prepared once');
    assert.deepEqual(stepsNamed(f, runId, 'baseline').map((s) => s.status), ['completed']);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.outcome]), [[1, 'handed-off']]);
  });

  it('adjacency edge: killed between the two commits of the `context-pack` checkpoint, resume runs the unit once', () => {
    const f = fixture(ONE_CHECK);
    const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:context-pack#2', FIX);
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM checkpoints WHERE run_id = ? AND next_action = 'context-pack'", runId)[0]?.n, 2, 'both commits of the checkpoint exist');
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(lines(resumed.stdout).at(-1), `run ${runId}: ready_for_review`);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.reason, a.outcome]), [[1, 'initial', 'handed-off']]);
    assert.equal(budgetOf(f, runId, 'invocations').used, 1);
    assert.equal(normalizeRunResult(f.roots, runId).commitCount, 1);
  });
});
