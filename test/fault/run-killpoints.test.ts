// Run kill-point suite (plan 02-17; AC-3, NFR-6, FR-7, success criterion 4: killing the supervisor and running `avarice resume` continues from the last
// checkpoint, and after a forced kill during verification `resume` identifies the interrupted attempt in 100% of fault-injection cases).
// For every point of RUN_KILL_POINTS: start a run in its own profile with the point armed (the detached supervisor dies by SIGKILL, no cleanup runs, and
// whatever the unit's host left running keeps running), check that `status` shows the run as interrupted and never as ready_for_review and names the
// interrupted attempt or action the ledger holds, resume it, and compare the result with an uninterrupted run of the same brief in a second profile.
// The fake run host is the only host; no model is called.
//
// The suite is built to be resilient, never tolerant: one case at a time (no parallel CLI runs), a lease that has lapsed and then a margin before status is
// read, every wait generous, a child that outlives the point ended in `after`. A point that does not kill, a run that is not identified, or a result that
// differs from the reference fails its case; nothing is retried and no tolerance is applied. The AC-3 line is printed at the end and asserted equal.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_NEXT_ACTIONS } from '../../src/domain/run-lifecycle.ts';
import type { RunState } from '../../src/domain/run-lifecycle.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import {
  RUN_EXPIRY_WAIT_MS,
  RUN_KILL_POINTS,
  ledgerInterruption,
  normalizeRunResult,
  openRaw,
  resumeRunCli,
  rows,
  runIdFromOutput,
  runRunWithFault,
  runStatusJson,
  runSurvivorPidFile,
  sleepSync,
  statusCli,
} from '../helpers/fault-run.ts';
import type { RunKillPoint, RunResult } from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
// Host processes the kill cases leave running on purpose: ended in `after`, whatever a case did or did not reach.
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
// Two required checks: a verification killed after the first has a second that never completed, and every pass has more than one evidence row to compare.
const LINT_CHECK = { name: 'lint', argv: ['node', 'scripts/lint-ok.mjs'], timeoutSec: 60, required: true } as const;
const TWO_CHECKS = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, LINT_CHECK], agentCommands: ['npm test'] };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/lint-ok.mjs': 'process.exit(0);\n' });
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, TWO_CHECKS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

const lines = (stdout: string): string[] => stdout.trim().split('\n');

// The state and the next action `status` must report right after the kill. A transition commits the checkpoint of the action that follows it, so
// `after-transition:running` and the first `after-checkpoint:context-pack` fire in the same instant; the `#2` form is the stage's own checkpoint of the
// same name. `mid-*` points are inside the action their last checkpoint named.
const EXPECTED_AT_KILL: Readonly<Record<RunKillPoint, { state: RunState; nextAction: string }>> = {
  'after-checkpoint:prepare-workspace': { state: 'contract_ready', nextAction: 'prepare-workspace' },
  'after-checkpoint:configure-gsd': { state: 'contract_ready', nextAction: 'configure-gsd' },
  'after-checkpoint:install-deps': { state: 'contract_ready', nextAction: 'install-deps' },
  'after-checkpoint:validate-checks': { state: 'contract_ready', nextAction: 'validate-checks' },
  'after-checkpoint:baseline': { state: 'contract_ready', nextAction: 'baseline' },
  'after-checkpoint:verify-enforcement': { state: 'contract_ready', nextAction: 'verify-enforcement' },
  'after-transition:running': { state: 'running', nextAction: 'context-pack' },
  'after-checkpoint:context-pack': { state: 'running', nextAction: 'context-pack' },
  'after-checkpoint:context-pack#2': { state: 'running', nextAction: 'context-pack' },
  'after-checkpoint:launch:run': { state: 'running', nextAction: 'launch:run' },
  'mid-invocation:run': { state: 'running', nextAction: 'launch:run' },
  'after-checkpoint:classify': { state: 'running', nextAction: 'classify' },
  'after-checkpoint:discard-attempt': { state: 'running', nextAction: 'discard-attempt' },
  'after-checkpoint:gate:g2': { state: 'running', nextAction: 'gate:g2' },
  'after-checkpoint:commit': { state: 'running', nextAction: 'commit' },
  'mid-commit': { state: 'running', nextAction: 'commit' },
  'after-transition:verifying': { state: 'verifying', nextAction: 'verify:checks' },
  'after-checkpoint:verify:checks': { state: 'verifying', nextAction: 'verify:checks' },
  'after-checkpoint:verify:checks#2': { state: 'verifying', nextAction: 'verify:checks' },
  'mid-verify': { state: 'verifying', nextAction: 'verify:checks' },
  'after-checkpoint:gate:g4': { state: 'verifying', nextAction: 'gate:g4' },
  'after-checkpoint:handoff:fetch': { state: 'verifying', nextAction: 'handoff:fetch' },
  'mid-handoff': { state: 'verifying', nextAction: 'handoff:fetch' },
  'mid-handoff#2': { state: 'verifying', nextAction: 'handoff:fetch' },
};

// A unit whose supervisor died before its outcome was recorded is read as inconclusive and retried once, so the run has a second attempt and a second
// invocation. Points before the unit launches, and after it was judged, do not.
const RETRIED: ReadonlySet<RunKillPoint> = new Set<RunKillPoint>(['after-checkpoint:launch:run', 'mid-invocation:run', 'after-checkpoint:classify', 'after-checkpoint:discard-attempt']);
// Of those, the ones that spent a second invocation: the unit of `launch:run` never started, so only one was ever reserved.
const SECOND_INVOCATION: ReadonlySet<RunKillPoint> = new Set<RunKillPoint>(['mid-invocation:run', 'after-checkpoint:classify', 'after-checkpoint:discard-attempt']);

// What the fake unit does in the killed process, and in the resumed one (a fresh process: its host plays these options from its first invocation).
function hostsFor(point: RunKillPoint): { kill: FakeRunOptions; resume: FakeRunOptions } {
  // The CON-16 recovery path is reached by a unit that crashed, so its first attempt crashes after writing two files; the retry does the work.
  if (point === 'after-checkpoint:discard-attempt') return { kill: { perAttempt: [{ crash: { afterFiles: ['src/slug.ts', 'src/extra.ts'] } }, FIX] }, resume: FIX };
  return { kill: FIX, resume: FIX };
}

let reference: RunResult;
let referenceRunId = '';
let total = 0;
let identified = 0;

before(() => {
  const f = fixture();
  const ran = startWithFakeRunHost(f.roots, f.repo, f.brief, FIX as Record<string, unknown>);
  assert.equal(ran.code, 0, ran.stdout + ran.stderr);
  referenceRunId = runIdFromOutput(ran.stdout);
  reference = normalizeRunResult(f.roots, referenceRunId);
});

describe('RUN_KILL_POINTS covers every action and transition of a run', () => {
  it('lists an after-checkpoint point for every action of contract_ready, running and verifying, and has at least 24 entries', () => {
    for (const state of ['contract_ready', 'running', 'verifying'] as const) {
      // `park` is reached only by an item that stops to ask: its kill points belong to the park suite (test/fault/run-park.test.ts), whose scenario asks.
      for (const action of (RUN_NEXT_ACTIONS[state] ?? []).filter((a) => a !== 'park')) assert.ok((RUN_KILL_POINTS as readonly string[]).includes(`after-checkpoint:${action}`), `${state} action ${action} has a kill point`);
    }
    for (const state of ['running', 'verifying']) assert.ok((RUN_KILL_POINTS as readonly string[]).includes(`after-transition:${state}`), `the transition to ${state} has a kill point`);
    for (const point of ['after-checkpoint:context-pack#2', 'after-checkpoint:verify:checks#2', 'mid-invocation:run', 'mid-commit', 'mid-verify', 'mid-handoff']) assert.ok((RUN_KILL_POINTS as readonly string[]).includes(point), point);
    assert.ok(RUN_KILL_POINTS.length >= 24, `${RUN_KILL_POINTS.length} points`);
    assert.equal(new Set(RUN_KILL_POINTS).size, RUN_KILL_POINTS.length, 'no point is listed twice');
    assert.deepEqual(Object.keys(EXPECTED_AT_KILL).sort(), [...RUN_KILL_POINTS].sort(), 'every point has an expectation');
  });

  it('the uninterrupted reference run ended ready_for_review with one commit, the fix, passed evidence and passed gates', () => {
    assert.equal(reference.state, 'ready_for_review');
    assert.equal(reference.commitCount, 1);
    assert.deepEqual(reference.changedFiles, ['src/slug.ts']);
    assert.deepEqual(reference.gates, [
      ['G0', true],
      ['G2', true],
      ['G4', true],
    ]);
    assert.deepEqual(
      reference.evidence.map((e) => `${e[0]}:${e[1]}:${e[2]}`),
      ['check:lint:passed', 'check:test:passed', 'gsd-verdict:gsd-verification:passed'],
    );
  });
});

describe('kill, then resume, reaches the result of an uninterrupted run, and resume names what was interrupted (AC-3)', () => {
  for (const point of RUN_KILL_POINTS) {
    it(point, () => {
      const f = fixture();
      const hosts = hostsFor(point);
      total += 1;
      const killed = runRunWithFault(f.roots, f.repo, f.brief, point, hosts.kill);
      const { runId } = killed;
      const expected = EXPECTED_AT_KILL[point];

      // A kill inside the unit leaves its host running, carrying the session ID in its command line.
      let survivor: number | undefined;
      if (point === 'mid-invocation:run') {
        survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim());
        assert.ok(Number.isInteger(survivor) && survivor > 1, 'the fake host recorded the survivor PID');
        survivors.push(survivor);
        assert.ok(isAlive(survivor), 'the host that carries the session ID outlived its supervisor');
      }

      // Crash consistency: the store opens and is intact, and the run is not finished.
      const db = openRaw(f.roots);
      try {
        assert.deepEqual({ ...(db.prepare('PRAGMA integrity_check').get() as object) }, { integrity_check: 'ok' });
        assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
      } finally {
        db.close();
      }
      assert.equal(rows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state, expected.state, 'the ledger state at the kill');

      // status: interrupted in its last state with the attempt and the action the ledger holds, never ready_for_review.
      sleepSync(RUN_EXPIRY_WAIT_MS);
      const inFlight = ledgerInterruption(f.roots, runId);
      assert.equal(inFlight.nextAction, expected.nextAction, 'the ledger names the action the kill interrupted');
      const status = runStatusJson(f.roots, runId);
      assert.notEqual(status.state, 'ready_for_review', 'an interrupted run is never shown as ready_for_review');
      assert.ok(status.interrupted !== undefined, 'status shows the run as interrupted');
      assert.equal(status.interrupted.presentedAs, 'paused');
      assert.equal(status.interrupted.state, expected.state);
      assert.equal(status.interrupted.reason, expected.state === 'verifying' ? 'verification interrupted' : 'supervisor interrupted');
      assert.equal(status.interrupted.nextAction, expected.nextAction);
      assert.equal(status.interrupted.attemptId, inFlight.openAttemptId, 'status names the attempt the ledger holds open');
      const step = inFlight.startedStep ?? inFlight.nextAction;
      assert.equal(status.interrupted.step, step, 'status names the step that was in flight');
      const text = statusCli(f.roots);
      assert.equal(text.code, 0, text.stderr);
      assert.match(text.stdout, new RegExp(`^run ${runId}: paused \\((verification|supervisor) interrupted\\)$`, 'm'));
      assert.ok(text.stdout.includes(`avarice resume ${runId}`), text.stdout);
      assert.doesNotMatch(text.stdout, /ready_for_review/);

      // resume names what it continues from, and the interrupted attempt (the interrupted action when no attempt is open).
      const resumed = resumeRunCli(f.roots, runId, hosts.resume);
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      const printed = lines(resumed.stdout);
      assert.equal(printed[0], `run ${runId}: resuming from ${expected.state} (next: ${expected.nextAction})`);
      assert.equal(
        printed[1],
        inFlight.openAttemptId === null ? `interrupted at ${step}` : `interrupted attempt ${inFlight.openAttemptId} at ${step}`,
        'resume identifies the interrupted attempt, or the interrupted action when no attempt is open',
      );
      identified += 1;
      assert.equal(printed.at(-1), `run ${runId}: ready_for_review`);

      // The resumed run equals the uninterrupted one: the committed tree and file list, the evidence statuses and the gate verdicts.
      const result = normalizeRunResult(f.roots, runId);
      assert.deepEqual(result, reference, 'the resumed run has the same committed tree, commit, evidence statuses and gate verdicts as an uninterrupted run');
      assert.deepEqual(checkoutSnapshot(f.repo.path), f.before, 'the user checkout is byte-identical');

      // Nothing is left in flight, the run became ready_for_review exactly once, and the budgets count what was spent.
      assert.deepEqual(rows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId), [], 'no step is left in flight');
      const ready = rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition'", runId).filter((e) => (JSON.parse(e.data_json) as { to: string }).to === 'ready_for_review');
      assert.equal(ready.length, 1, 'ready_for_review once');
      const attempts = rows<{ outcome: string | null }>(f.roots, 'SELECT outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);
      assert.equal(attempts.length, RETRIED.has(point) ? 2 : 1, 'one attempt, or two when the interrupted unit was retried');
      assert.equal(attempts.at(-1)?.outcome, 'handed-off');
      assert.equal(rows<{ used: number }>(f.roots, "SELECT used FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0]?.used, SECOND_INVOCATION.has(point) ? 2 : 1, 'invocations used');
      assert.equal(rows<{ reserved: number }>(f.roots, "SELECT reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0]?.reserved, 0, 'no reservation is left');

      if (survivor !== undefined) {
        assert.equal(isAlive(survivor), false, 'the resume ended the host that carried the interrupted session ID');
        assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'invocation.reaped'", runId)[0]?.n, 1, 'exactly one invocation.reaped event');
      }
    });
  }
});

describe('AC-3: the interrupted attempt is identified in every fault-injection case', () => {
  it('prints and asserts `AC-3: n/n interrupted attempts identified`', () => {
    const line = `AC-3: ${identified}/${total} interrupted attempts identified`;
    console.log(line);
    assert.equal(total, RUN_KILL_POINTS.length, 'every point ran');
    assert.equal(identified, total, line);
    assert.ok(referenceRunId !== '');
  });
});
