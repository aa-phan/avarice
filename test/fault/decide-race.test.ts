// The lost-wakeup race between `decide` and the run supervisor (plan 03-26; research Pitfall 3, D-16, AUT-3, AUT-5, T-03-50). A run that stops at an item
// decision does not end its supervisor at once: it moves to blocked_on_decision, releases its lease, looks again, and goes on only if an answer made an item ready
// in that window; `decide` writes the answer, then starts a supervisor only if nobody holds a live lease. Whichever of the two happens second sees the other's write,
// so a run must never stay blocked with an answer waiting, and never run an item twice. The scenario is the four-item run of plan 03-18 (B asks; A, C and D finish).
//
// The supervisor is the real detached process of the test CLI and `decide` is production main(). Where the answer lands is chosen with a held process (the test CLI
// stops a process at the fault point named by AVARICE_FAULT, so the test can write in that window), or with a kill:
//
//   before the block                   the decision is open and the supervisor is still running C: the live supervisor takes the answered B next
//   between the block and the release  the run is blocked_on_decision and the supervisor still holds the lease: it releases it, looks again and goes on
//   between the release and the look   no lease is held: decide starts a second supervisor; either supervisor may win the lease, and one continues the run
//   a kill at the block                the supervisor dies holding the lease: an answer under the live lease starts nobody and `resume` continues the run once it
//                                      lapses; an answer after it lapsed starts a supervisor
//
// Each ends ready_for_review with exactly one resumed launch of B, every item committed once, the fences of the lease only growing, and no supervisor exiting with an
// error. The fake run host plays the units; nothing calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { BLOCK_KILL_POINT, RUN_EXPIRY_WAIT_MS, TEST_CLI, exitRecords, heldProcess, makeHold, resumeRunCli, runHostEnv, sleepSync, startRunArgs, watchLease, whenReached } from '../helpers/fault-run.ts';
import type { Hold, LeaseSample } from '../helpers/fault-run.ts';
import { decideMain, resumedHost, withSupervisorEntry } from '../helpers/decide-cli.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, runIdOfOutput, runRowOf, s17Fixture, S17_QUESTION, unitOf } from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';
import { ledgerRows } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const ALL_COMMITS = ['Collapse repeated dashes', 'Add a helper module', 'Map a status code', 'Cover the status mapper with a test'];
// Long enough that a process stopped at a held point keeps its lease while the test writes, short enough to read as a lease in the ledger.
const HELD_LEASE_TTL_MS = '60000';

interface Race {
  f: S17Fixture;
  host: FakeRunOptions;
  exitLog: string;
  recordB: string;
}

// B asks on its first call; its resumed call finishes it. A, C and D are plain units.
function race(): Race {
  const f = s17Fixture(cleanup);
  const recordB = join(f.roots.base, 'unit-B-resumed.json');
  const resumed = resumedHost(recordB).perItem?.['B'] as FakeRunOptions;
  const host: FakeRunOptions = { perItem: { A: unitOf('A'), B: { ...unitOf('B', { question: S17_QUESTION }), resume: resumed.resume as FakeRunOptions }, C: unitOf('C'), D: unitOf('D') } };
  return { f, host, exitLog: join(f.roots.base, 'exits.jsonl'), recordB };
}

// `start` without `--wait`: it returns once the detached supervisor is spawned; the test follows the run in the ledger.
function startDetached(r: Race, env: Record<string, string>): string {
  const result = runCli(['start', '--brief', r.f.brief, '--policy', 'routine'], {
    roots: r.f.roots,
    cwd: r.f.repo.path,
    entry: TEST_CLI,
    env: { ...runHostEnv(r.host, { AVARICE_TEST_EXIT_LOG: r.exitLog, ...env }) },
    timeoutMs: 120_000,
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return runIdOfOutput(result.stdout);
}

async function until<T>(what: string, read: () => T | undefined, limitMs = 120_000): Promise<T> {
  const end = Date.now() + limitMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const stateOf = (roots: CliRoots, runId: string): string => runRowOf(roots, runId).state;
const openDecisionOf = (roots: CliRoots, runId: string): string | undefined => decisionsOf(roots, runId).find((d) => d.state === 'open')?.decision_id;

// The run is finished (or stuck): a lost wakeup shows as a run that stays blocked_on_decision with an answered decision.
async function finished(roots: CliRoots, runId: string): Promise<void> {
  await until(
    'the run to reach ready_for_review (a run still blocked_on_decision here is a lost wakeup)',
    () => {
      const state = stateOf(roots, runId);
      if (state === 'ready_for_review') return true;
      if (state === 'failed' || state === 'cancelled') assert.fail(`the run ended ${state}`);
      return undefined;
    },
  );
}

// The supervisors that ran have all exited by the time the checks look at their codes.
async function supervisorsExited(exitLog: string, count: number): Promise<Array<{ argv: string[]; code: number | null }>> {
  return until(`${count} supervisor exit record(s)`, () => {
    const records = exitRecords(exitLog).filter((x) => x.argv[0] === 'supervise');
    return records.length >= count ? records : undefined;
  }, 60_000);
}

// The lease only moves forward: fences never fall, one fence has one holder, and a holder that gave the lease up never has it back.
function assertLeaseExclusive(samples: readonly LeaseSample[]): void {
  const holders = samples.filter((s) => s.holder !== null);
  for (let i = 1; i < holders.length; i += 1) assert.ok((holders[i] as LeaseSample).fence >= (holders[i - 1] as LeaseSample).fence, `the fence fell: ${JSON.stringify(samples)}`);
  const byFence = new Map<number, Set<string>>();
  for (const s of holders) byFence.set(s.fence, (byFence.get(s.fence) ?? new Set()).add(s.holder as string));
  for (const [fence, who] of byFence) assert.equal(who.size, 1, `fence ${fence} had two holders: ${JSON.stringify(samples)}`);
  const order: string[] = [];
  for (const s of holders) if (order.at(-1) !== s.holder) order.push(s.holder as string);
  assert.equal(new Set(order).size, order.length, `a holder took the lease again after another held it: ${JSON.stringify(samples)}`);
}

// What every ordering must end with: one continuation of the run, one resumed unit of B, nothing run twice.
function assertOneContinuation(r: Race, runId: string, decisionId: string, samples: readonly LeaseSample[]): void {
  const { roots } = r.f;
  const run = runRowOf(roots, runId);
  assert.deepEqual([run.state, run.lease_holder], ['ready_for_review', null], 'the run is ready for review and no lease is held');
  assert.equal(
    ledgerRows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition'", runId).filter((e) => (JSON.parse(e.data_json) as { to: string }).to === 'ready_for_review').length,
    1,
    'ready_for_review once',
  );
  assert.deepEqual(
    itemStatesOf(roots, runId).map((x) => x.join(':')),
    ['A:done', 'B:done', 'C:done', 'D:done'],
  );
  const attempts = attemptsOfRun(roots, runId);
  assert.deepEqual(
    ['A', 'B', 'C', 'D'].map((id) => attempts.filter((a) => a.item_id === id).map((a) => a.reason)),
    [['initial'], ['initial', 'resume'], ['initial'], ['initial']],
    'no item ran twice, and B has its first unit and one resume',
  );
  const launches = ledgerRows<{ result_json: string }>(roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map(
    (l) => JSON.parse(l.result_json) as { itemId: string; answeredDecisionId?: string },
  );
  assert.equal(launches.length, 5, 'five launches: A, B, C, the resume of B and D');
  assert.equal(launches.filter((l) => l.itemId === 'B' && l.answeredDecisionId === decisionId).length, 1, 'exactly one launch of B\'s resumed unit');
  assert.deepEqual(
    ledgerRows<{ used: number; reserved: number }>(roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0],
    { used: 5, reserved: 0 },
    'five invocations were charged and none is reserved',
  );
  assert.deepEqual(
    decisionsOf(roots, runId).map((d) => [d.state, d.answer]),
    [['answered', '1']],
    'one decision, answered once',
  );
  assert.equal(ledgerRows(roots, "SELECT 1 FROM events WHERE run_id = ? AND type = 'decision.answered'", runId).length, 1);
  assert.deepEqual(commitsOfRun(run.workspace_path, r.f.pin).map((c) => c.subject).sort(), [...ALL_COMMITS].sort(), 'every item committed once');
  assert.deepEqual(ledgerRows(roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId), [], 'no step is left in flight');
  assert.equal(ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId)[0]?.n, 0, 'every attempt ended');
  assertLeaseExclusive(samples);
}

function assertCleanExits(records: ReadonlyArray<{ argv: string[]; code: number | null }>): void {
  for (const record of records) assert.ok(record.code === 0 || record.code === 3, `a supervisor exited ${String(record.code)}: neither ready for review nor a clean stop or lease conflict`);
  assert.ok(records.some((x) => x.code === 0), 'one supervisor saw the run through to ready_for_review');
}

const supervisorStarts = (roots: CliRoots, runId: string): number => ledgerRows(roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'supervisor:decide'", runId).length;

// Holds the supervisor of a started run at `point` and runs `landing` in the window; returns the run and the lease samples taken throughout.
async function heldRace(r: Race, name: string, point: string, landing: (hold: Hold, runId: string) => Promise<void>): Promise<{ runId: string; decisionId: string; samples: LeaseSample[] }> {
  const hold = makeHold(r.f.roots, name, point);
  const runId = startDetached(r, { ...hold.env, AVARICE_LEASE_TTL_MS: HELD_LEASE_TTL_MS });
  const watcher = watchLease(r.f.roots, runId);
  let decisionId = '';
  let samples: LeaseSample[] = [];
  try {
    await whenReached(hold, async () => {
      assert.deepEqual(heldProcess(hold).argv.slice(0, 1), ['supervise'], 'the held process is the run\'s supervisor');
      await landing(hold, runId);
      decisionId = decisionsOf(r.f.roots, runId)[0]?.decision_id ?? '';
    });
    await finished(r.f.roots, runId);
  } finally {
    samples = watcher.stop();
  }
  return { runId, decisionId, samples };
}

describe('the answer lands before the block: the supervisor is still running C when B\'s decision is answered', () => {
  it('starts no supervisor, and the live supervisor takes the answered B after C and finishes the run', async () => {
    const r = race();
    const result = await heldRace(r, 'before-block', 'after-checkpoint:launch:run#3', async (_hold, runId) => {
      // Held at the launch of the third unit (C): B has asked and is parked, its decision is open, and the run is still running under a live lease.
      const run = runRowOf(r.f.roots, runId);
      assert.deepEqual([run.state, run.lease_holder !== null], ['running', true]);
      assert.deepEqual(
        itemStatesOf(r.f.roots, runId).map((x) => x.join(':')),
        ['A:done', 'B:blocked_on_decision', 'C:delegated', 'D:ready'],
        'C is delegated and its unit has not been launched',
      );
      const decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 0, 'decide saw a live lease and started nobody: the running supervisor takes B next');
    });
    const exits = await supervisorsExited(r.exitLog, 1);
    assertOneContinuation(r, result.runId, result.decisionId, result.samples);
    assertCleanExits(exits);
    assert.equal(exits.length, 1, 'one supervisor ran the whole run');
    assert.equal(runRowOf(r.f.roots, result.runId).lease_fence, 1, 'the one lease the run ever took');
  });
});

describe('the answer lands between the block and the release: the run is blocked_on_decision and the supervisor still holds the lease', () => {
  it('starts no supervisor; the holder releases the lease, looks again and goes on in the same process', async () => {
    const r = race();
    const result = await heldRace(r, 'block-release', 'after-transition:blocked_on_decision', async (_hold, runId) => {
      const run = runRowOf(r.f.roots, runId);
      assert.deepEqual([run.state, run.reason, run.lease_holder !== null], ['blocked_on_decision', 'decision', true]);
      const decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 0, 'the lease was live: decide started nobody');
    });
    const exits = await supervisorsExited(r.exitLog, 1);
    assertOneContinuation(r, result.runId, result.decisionId, result.samples);
    assertCleanExits(exits);
    assert.equal(exits.length, 1);
    assert.equal(runRowOf(r.f.roots, result.runId).lease_fence, 2, 'the same supervisor took the lease a second time after the look');
  });
});

describe('the answer lands between the release and the look: no lease is held, so decide starts a second supervisor', () => {
  it('when the second supervisor is done before the first looks again, the first finds nothing to continue and exits cleanly', async () => {
    const r = race();
    const result = await heldRace(r, 'release-look-late', 'after-release:blocked', async (_hold, runId) => {
      const run = runRowOf(r.f.roots, runId);
      assert.deepEqual([run.state, run.lease_holder], ['blocked_on_decision', null], 'the lease is released');
      const decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 1, 'no lease: decide started the supervisor');
      // The first supervisor stays held until the second has finished the run, so its look finds a run that needs nothing.
      await finished(r.f.roots, runId);
    });
    const exits = await supervisorsExited(r.exitLog, 2);
    assertOneContinuation(r, result.runId, result.decisionId, result.samples);
    assertCleanExits(exits);
    assert.equal(exits.length, 2, 'two supervisors ran: the held one and the one decide started');
  });

  it('when the first supervisor looks again at once, one of the two takes the lease and the other leaves cleanly: one continuation', async () => {
    const r = race();
    const result = await heldRace(r, 'release-look-early', 'after-release:blocked', async (_hold, runId) => {
      const decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 1);
      // The held supervisor is let go as soon as decide returns, while the second one is still starting.
    });
    const exits = await supervisorsExited(r.exitLog, 2);
    assertOneContinuation(r, result.runId, result.decisionId, result.samples);
    assertCleanExits(exits);
  });
});

describe('the answer lands after a supervisor was killed at the block', () => {
  it('under the lease it still holds: decide starts nobody, and `resume` continues the run once the lease has lapsed', async () => {
    const r = race();
    // The supervisor dies at the transition to blocked_on_decision with a lease that lapses 6 s later.
    const started = runCli([...startRunArgs(r.f.brief)], {
      roots: r.f.roots,
      cwd: r.f.repo.path,
      entry: TEST_CLI,
      env: runHostEnv(r.host, { AVARICE_FAULT: BLOCK_KILL_POINT, AVARICE_LEASE_TTL_MS: '6000', AVARICE_TEST_EXIT_LOG: r.exitLog }),
      timeoutMs: 300_000,
    });
    const runId = runIdOfOutput(started.stdout);
    assert.equal(started.code, 3, started.stdout + started.stderr);
    const watcher = watchLease(r.f.roots, runId);
    let samples: LeaseSample[] = [];
    let decisionId = '';
    try {
      const before = runRowOf(r.f.roots, runId);
      assert.deepEqual([before.state, before.lease_holder !== null], ['blocked_on_decision', true], 'killed holding the lease');

      decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 0, 'the dead supervisor\'s lease was still live: decide started nobody');
      assert.equal(stateOf(r.f.roots, runId), 'blocked_on_decision', 'the answer waits for whoever takes the run next');

      await until('the dead supervisor\'s lease to lapse', () => {
        const run = ledgerRows<{ lease_expires_at: string | null }>(r.f.roots, 'SELECT lease_expires_at FROM runs WHERE run_id = ?', runId)[0];
        return run?.lease_expires_at !== null && run !== undefined && Date.parse(run.lease_expires_at as string) < Date.now() ? true : undefined;
      });
      // Nobody is going to look at the run unless the owner does: `resume` must continue a blocked run whose decision was answered.
      const resumed = resumeRunCli(r.f.roots, runId, r.host, { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      await finished(r.f.roots, runId);
    } finally {
      samples = watcher.stop();
    }
    const exits = await supervisorsExited(r.exitLog, 1);
    assertOneContinuation(r, runId, decisionId, samples);
    assertCleanExits(exits);
    assert.equal(exits.length, 1, 'the killed supervisor left no record; one supervisor finished the run');
  });

  it('after the lease has lapsed: decide starts the supervisor, which takes the lapsed lease and continues the run', async () => {
    const r = race();
    const started = runCli([...startRunArgs(r.f.brief)], {
      roots: r.f.roots,
      cwd: r.f.repo.path,
      entry: TEST_CLI,
      env: runHostEnv(r.host, { AVARICE_FAULT: BLOCK_KILL_POINT, AVARICE_TEST_EXIT_LOG: r.exitLog }),
      timeoutMs: 300_000,
    });
    const runId = runIdOfOutput(started.stdout);
    assert.equal(started.code, 3, started.stdout + started.stderr);
    const watcher = watchLease(r.f.roots, runId);
    let samples: LeaseSample[] = [];
    let decisionId = '';
    try {
      sleepSync(RUN_EXPIRY_WAIT_MS);
      decisionId = openDecisionOf(r.f.roots, runId) as string;
      const answered = await withSupervisorEntry(r.host, () => decideMain(r.f.roots, [decisionId, '1', '--wait']), { AVARICE_TEST_EXIT_LOG: r.exitLog });
      assert.equal(answered.code, 0, answered.err + answered.out);
      assert.equal(supervisorStarts(r.f.roots, runId), 1, 'the lease had lapsed: decide started the supervisor');
      await finished(r.f.roots, runId);
    } finally {
      samples = watcher.stop();
    }
    const exits = await supervisorsExited(r.exitLog, 1);
    assertOneContinuation(r, runId, decisionId, samples);
    assertCleanExits(exits);
  });
});
