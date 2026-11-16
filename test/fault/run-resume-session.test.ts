// Crash safety of the resume of an answered item (plan 03-22; AUT-3, AUT-5, AUT-12, T-03-42, T-03-43; FR-7, NFR-6). The S-17 brief (test/helpers/independent-work.ts)
// is the scenario: B asks and is parked, C completes, the run blocks, the owner answers B's decision, and a supervisor takes the run up and resumes B's own
// session. That supervisor is killed (SIGKILL, no cleanup) at each point of the resume, the run is resumed with `avarice resume`, and what it ends as is compared
// with an uninterrupted run of the same scenario in a second profile (the committed tree and file list, the evidence statuses and the gate verdicts):
//
//   after-checkpoint:unpark  the `unpark` checkpoint is committed; the delta may not be back in the tree yet
//   mid-unpark               the delta is back in the tree and the host was not called: a second unpark would change nothing
//   mid-invocation:run       the supervisor dies inside the resumed unit and the host process of the resumed session is left running: the resume reaps it by the
//                            resumed session ID, puts the clone back to the item's base and runs a fresh unit that carries the answer
//
// The fake run host is the only host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { createDeps } from '../../src/cli/composition.ts';
import { RESUME_KILL_POINTS, RUN_EXPIRY_WAIT_MS, TEST_CLI, normalizeRunResult, resumeRunCli, runHostEnv, runSurvivorPidFile, sleepSync } from '../helpers/fault-run.ts';
import type { ResumeKillPoint, RunResult } from '../helpers/fault-run.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ledgerRows, profileEnv, startWithFakeRunHost } from '../helpers/run-fixtures.ts';
import { attemptsOfRun, existsInClone, itemStatesOf, parkRefOf, runIdOfOutput, runRowOf, s17Fixture, s17Host, unitOf } from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';
import { git } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const STATUS_410 = 'export const status = 410;\n';

// B's resumed call finishes the item under a quick directory of its own, so it never writes over the records the first unit parked.
const RESUMED_B: FakeRunOptions = { ...unitOf('B'), quickId: '261105-fk2-resume' };

// The host script of the supervisors after the answer. A fresh call of B (the fallback after a killed resume) plays `perItem.B`; a resumed call plays `.resume`.
function hostAfterAnswer(resume: FakeRunOptions = RESUMED_B): FakeRunOptions {
  return { perItem: { A: unitOf('A'), B: { ...unitOf('B'), resume }, C: unitOf('C'), D: unitOf('D') } };
}

interface Blocked {
  f: S17Fixture;
  runId: string;
}

// The S-17 run until B is blocked and the owner has answered its decision with option 2 (through the ledger: the answer is what the scenario needs, not the
// command). Nothing runs after the answer; the caller starts the supervisor, with a fault armed or not.
async function answeredRun(): Promise<Blocked> {
  const f = s17Fixture(cleanup);
  const started = startWithFakeRunHost(f.roots, f.repo, f.brief, s17Host() as Record<string, unknown>);
  assert.equal(started.code, 3, started.stdout + started.stderr);
  const runId = runIdOfOutput(started.stdout);
  // The banner of the block is raised by the supervisor after it stops; a supervisor started now must not race it.
  const end = Date.now() + 30_000;
  while (ledgerRows(f.roots, "SELECT 1 FROM notifications WHERE state = 'pending'").length > 0) {
    if (Date.now() > end) assert.fail('the banner was never delivered');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const decisionId = (ledgerRows<{ decision_id: string }>(f.roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId)[0] as { decision_id: string }).decision_id;
  const composed = createDeps(profileEnv(f.roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    const answered = composed.value.deps.ledger.answerDecision({ runId, decisionId, answer: '2', answeredBy: 'owner', channel: 'terminal', expectContractVersion: 1, nowMs: Date.now() });
    assert.ok(answered.ok, JSON.stringify(answered));
  } finally {
    composed.value.close();
  }
  return { f, runId };
}

// `avarice supervise <run>` through the test CLI: the supervisor that takes up an answered blocked run. With a point, it must die there.
function supervise(b: Blocked, host: FakeRunOptions, point?: ResumeKillPoint): ReturnType<typeof runCli> {
  let hostOptions = host;
  let armed = point !== undefined;
  if (point === 'mid-invocation:run') {
    // The supervisor dies inside the resumed unit after it wrote one file; the host process carrying the resumed session's ID is left running.
    hostOptions = { ...host, perItem: { ...host.perItem, B: { ...unitOf('B'), resume: { ...RESUMED_B, killInUnit: { afterFiles: ['src/status.ts'], survivorPidFile: runSurvivorPidFile(b.f.roots) } } } } };
    armed = false;
  }
  const result = runCli(['supervise', b.runId], {
    roots: b.f.roots,
    cwd: b.f.repo.path,
    entry: TEST_CLI,
    env: runHostEnv(hostOptions, armed && point !== undefined ? { AVARICE_FAULT: point } : {}),
    timeoutMs: 300_000,
  });
  if (point !== undefined && result.signal !== 'SIGKILL') {
    throw new Error(`kill point ${point}: expected the supervisor to die by SIGKILL, got signal ${String(result.signal)} code ${String(result.code)}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

const stepsInFlight = (roots: CliRoots, runId: string): unknown[] => ledgerRows(roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId);
const openAttempts = (roots: CliRoots, runId: string): number => ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId)[0]?.n ?? 0;
const launchSteps = (roots: CliRoots, runId: string): Array<{ status: string; sessionId: string; itemId: string }> =>
  ledgerRows<{ status: string; result_json: string }>(roots, "SELECT status, result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map((r) => {
    const body = JSON.parse(r.result_json) as { sessionId: string; itemId: string };
    return { status: r.status, sessionId: body.sessionId, itemId: body.itemId };
  });
const lastCheckpoint = (roots: CliRoots, runId: string): string | undefined =>
  ledgerRows<{ next_action: string }>(roots, "SELECT next_action FROM checkpoints WHERE run_id = ? AND next_action != 'none' ORDER BY seq DESC", runId)[0]?.next_action;

let reference: RunResult;
let referenceCalls = 0;

describe('the uninterrupted resume is the reference', () => {
  it('ends ready_for_review with every item done, B resumed once, and the tree the killed runs must reach', async () => {
    const b = await answeredRun();
    const done = supervise(b, hostAfterAnswer());
    assert.equal(done.code, 0, done.stdout + done.stderr);
    reference = normalizeRunResult(b.f.roots, b.runId);
    referenceCalls = attemptsOfRun(b.f.roots, b.runId).filter((a) => a.item_id === 'B').length;
    assert.equal(reference.state, 'ready_for_review');
    assert.equal(reference.commitCount, 4);
    assert.deepEqual(
      attemptsOfRun(b.f.roots, b.runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['C', 'initial'],
        ['B', 'resume'],
        ['D', 'initial'],
      ],
    );
    assert.equal(referenceCalls, 2);
  });
});

describe('a supervisor killed inside the resume ends the run as the uninterrupted one does (AUT-12)', () => {
  it('after-checkpoint:unpark: the resume repeats the unpark and resumes B again, so B has one resume that ran', async () => {
    const b = await answeredRun();
    supervise(b, hostAfterAnswer(), 'after-checkpoint:unpark');
    const clone = runRowOf(b.f.roots, b.runId).workspace_path;
    assert.equal(runRowOf(b.f.roots, b.runId).state, 'running', 'the run is interrupted in running');
    assert.equal(lastCheckpoint(b.f.roots, b.runId), 'unpark', 'the last checkpoint is the unpark');
    assert.deepEqual(itemStatesOf(b.f.roots, b.runId)[1], ['B', 'delegated']);
    assert.notEqual(parkRefOf(clone, b.runId, 'B'), null, 'B is still parked: the delta is not given up before the host answered');

    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(b.f.roots, b.runId, hostAfterAnswer());
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(normalizeRunResult(b.f.roots, b.runId), reference);
    assert.deepEqual(stepsInFlight(b.f.roots, b.runId), [], 'no step is left in flight');
    assert.equal(openAttempts(b.f.roots, b.runId), 0, 'every attempt ended');
    assert.equal(parkRefOf(clone, b.runId, 'B'), null, 'the park ref went with B\'s commit');
    // The host was called once for B's resume: the killed supervisor never reached it.
    assert.deepEqual(launchSteps(b.f.roots, b.runId).filter((l) => l.itemId === 'B').map((l) => l.status), ['completed', 'completed']);
  });

  it('mid-unpark: the delta is back in the tree when the supervisor dies, and it is in the commit once', async () => {
    const b = await answeredRun();
    supervise(b, hostAfterAnswer(), 'mid-unpark');
    const clone = runRowOf(b.f.roots, b.runId).workspace_path;
    assert.equal(existsInClone(clone, 'src/status.ts'), true, "B's parked file is back in the tree");
    assert.equal(readFileSync(`${clone}/src/status.ts`, 'utf8'), STATUS_410);
    assert.equal(launchSteps(b.f.roots, b.runId).filter((l) => l.itemId === 'B').length, 1, 'the host was not called for the resume: only the first unit of B launched');

    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(b.f.roots, b.runId, hostAfterAnswer());
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(normalizeRunResult(b.f.roots, b.runId), reference);
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), STATUS_410, 'the delta was applied once');
    assert.deepEqual(stepsInFlight(b.f.roots, b.runId), []);
    assert.equal(openAttempts(b.f.roots, b.runId), 0);
    assert.equal(parkRefOf(clone, b.runId, 'B'), null);
  });

  it('mid-invocation:run: the host of the resumed session is reaped by the resumed session ID, and B finishes with a fresh unit that carries the answer', async () => {
    const b = await answeredRun();
    const firstSession = (ledgerRows<{ gsd_session: string }>(b.f.roots, "SELECT gsd_session FROM work_items WHERE run_id = ? AND item_id = 'B'", b.runId)[0] as { gsd_session: string }).gsd_session;
    supervise(b, hostAfterAnswer(), 'mid-invocation:run');
    const survivor = Number(readFileSync(runSurvivorPidFile(b.f.roots), 'utf8'));
    assert.doesNotThrow(() => process.kill(survivor, 0), 'the host process of the resumed session is still running');
    // The launch step that was in flight carries the session that was resumed, which is what the reap searches for.
    const inFlight = launchSteps(b.f.roots, b.runId).filter((l) => l.status === 'started');
    assert.deepEqual(
      inFlight.map((l) => [l.itemId, l.sessionId]),
      [['B', firstSession]],
    );

    try {
      sleepSync(RUN_EXPIRY_WAIT_MS);
      const resumed = resumeRunCli(b.f.roots, b.runId, hostAfterAnswer());
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      assert.throws(() => process.kill(survivor, 0), 'the resume ended the surviving host');
      assert.deepEqual(normalizeRunResult(b.f.roots, b.runId), reference);
      assert.equal(ledgerRows(b.f.roots, "SELECT 1 FROM events WHERE run_id = ? AND type = 'invocation.reaped'", b.runId).length, 1, 'one host was reaped');
      assert.deepEqual(
        launchSteps(b.f.roots, b.runId)
          .filter((l) => l.itemId === 'B')
          .map((l) => l.status),
        ['completed', 'interrupted', 'completed'],
        'the first unit, the interrupted resume and the fresh unit that followed it',
      );
      assert.deepEqual(
        attemptsOfRun(b.f.roots, b.runId).map((a) => [a.item_id, a.reason, a.outcome]),
        [
          ['A', 'initial', 'committed'],
          ['B', 'initial', 'blocked:decision'],
          ['C', 'initial', 'committed'],
          ['B', 'resume', 'discarded'],
          ['B', 'answer', 'committed'],
          ['D', 'initial', 'handed-off'],
        ],
      );
      assert.equal(openAttempts(b.f.roots, b.runId), 0);
      assert.deepEqual(stepsInFlight(b.f.roots, b.runId), []);
    } finally {
      try {
        process.kill(survivor, 'SIGKILL');
      } catch {
        // already ended by the reap
      }
    }
  });
});

describe('the resume kill points are the ones this suite names', () => {
  it('lists after-checkpoint:unpark, mid-unpark and mid-invocation:run', () => {
    assert.deepEqual([...RESUME_KILL_POINTS], ['after-checkpoint:unpark', 'mid-unpark', 'mid-invocation:run']);
  });
});
