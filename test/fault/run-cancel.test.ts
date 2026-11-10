// Edges and kill points of `avarice cancel` (plan 03-24; AUT-12, S-20, T-03-47, T-03-48; FR-7, NFR-6). The cases:
//
//   ordering      two open decisions are withdrawn in decision-ID order, each with a decision.withdrawn event
//   empty         a run with no open decision, no lease and a host process its dead supervisor left behind: the host is reaped, nothing is withdrawn, the run is cancelled
//   terminal      a failed, cancelled or closed run exits 3 and writes no row
//   adjacency     a cancel that races a stage transition: the transition commits and the cancel then applies to the new state, or the cancel commits and the stage's
//                 transition fails its guard; never both cancelled and moved on
//   mid-cancel    the supervisor (live-supervisor cancel) or `cancel` itself (no supervisor) dies after the withdrawals and before the transition: running `cancel`
//                 again, or `supervise`, finishes the cancel with no second withdrawal and no new unit
//   after-cancel-request   `cancel` dies right after its request is committed: the next supervisor start cancels the run at entry, reaps the host and launches nothing
//
// `cancel` needs a terminal, so a case that kills it runs it on a real pseudo-terminal (test/helpers/pty-drive.py, python3); the others run it in this process on a
// stream that claims to be one. The fake run host is the only host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { cancelRun } from '../../src/app/cancel.ts';
import { makeRunContext } from '../../src/app/run-context.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { Ledger } from '../../src/ports/ledger.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { CANCEL_KILL_POINTS, RUN_EXPIRY_WAIT_MS, TEST_CLI, openRaw, runHostEnv, runOnTerminal, runRunWithFault, runSurvivorPidFile, sleepSync } from '../helpers/fault-run.ts';
import { attemptsOfRun, decisionsOf, runRowOf, s17Fixture, unitOf, S17_QUESTION } from '../helpers/independent-work.ts';
import { runCli } from '../helpers/run-cli.ts';
import { FIXED_SLUG, ledgerRows, profileEnv, startWithFakeRunHost } from '../helpers/run-fixtures.ts';
import { waitFor } from '../helpers/shell-streams.ts';
import { cancelCli, eventsOf, rowsSnapshot, singleFixture, startBlockedS17 } from '../helpers/cancel-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
// Host processes a case leaves running on purpose: ended in `after`, whatever the case did or did not reach.
const survivors: number[] = [];

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

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

const HAS_PYTHON = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const NO_PYTHON = HAS_PYTHON ? false : 'python3 is not installed, so the pseudo-terminal harness cannot run';

const LIVE_LEASE_TTL_MS = 3000;
// The lease of a killed live supervisor has lapsed after this, with a margin for a loaded machine.
const LIVE_LEASE_EXPIRY_WAIT_MS = LIVE_LEASE_TTL_MS + 1500;

const UNIT: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

const countOf = (roots: CliRoots, sql: string, ...params: Array<string | number>): number => (ledgerRows<{ n: number }>(roots, sql, ...params)[0] as { n: number }).n;
const launchSteps = (roots: CliRoots, runId: string): number => countOf(roots, "SELECT count(*) AS n FROM run_steps WHERE run_id = ? AND step = 'launch:run'", runId);
const transitionsTo = (roots: CliRoots, runId: string, to: string): number => eventsOf(roots, runId, 'run.transition').filter((t) => t['to'] === to).length;
const stateOf = (roots: CliRoots, runId: string): string => runRowOf(roots, runId).state;

// The S-17 run with a live supervisor: B has asked (one open decision) and C, the next item, hangs in its unit until it is aborted. `fault` arms a kill point for
// the supervisor (the process `start` spawns).
function startLiveS17(fault?: string): { f: ReturnType<typeof s17Fixture>; runId: string } {
  const f = s17Fixture(cleanup);
  const host: FakeRunOptions = { perItem: { A: unitOf('A'), B: unitOf('B', { question: S17_QUESTION }), C: unitOf('C', { hangUntilAbort: { maxMs: 60_000 } }), D: unitOf('D') } };
  const started = runCli(['start', '--brief', f.brief, '--policy', 'routine'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    // A live supervisor must stay live while the fake unit blocks its event loop for about a second at a time: its lease is far longer than the suite's usual 400 ms.
    env: runHostEnv(host, { AVARICE_LEASE_TTL_MS: String(LIVE_LEASE_TTL_MS), ...(fault === undefined ? {} : { AVARICE_FAULT: fault }) }),
    timeoutMs: 120_000,
  });
  assert.equal(started.code, 0, started.stdout + started.stderr);
  const runId = (/^run (run_[0-9A-Z]{26}): /m.exec(started.stdout) as RegExpExecArray)[1] as string;
  return { f, runId };
}

// Waits until C's unit is in flight with B's decision open.
async function untilHung(roots: CliRoots, runId: string): Promise<void> {
  await waitFor(
    () =>
      ledgerRows(roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'launch:run' AND status = 'started'", runId).length > 0 &&
      ledgerRows(roots, "SELECT 1 FROM decisions WHERE run_id = ? AND state = 'open'", runId).length > 0,
    'the unit of C to hang with B asking',
    90_000,
  );
}

const fakeHost = (): { host: FakeRunHost } => ({ host: new FakeRunHost({}) });

describe('ordering: open decisions are withdrawn in decision-ID order, each with its own event (AUT-12)', () => {
  const f = s17Fixture(cleanup);
  let runId = '';
  const ids: string[] = [];

  it('is blocked on two open decisions, one per item that asked', () => {
    // B asks and so does C, each its own question: two independent items, two decisions, and D waits behind B. C's choice must not be B's
    // options, or the numbered-choice attribution would (correctly) give it to B and C would not pause.
    const host: FakeRunOptions = {
      perItem: { A: unitOf('A'), B: unitOf('B', { question: S17_QUESTION }), C: unitOf('C', { question: 'Which helper name?\n1. toSlug\n2. makeSlug' }), D: unitOf('D') },
    };
    const ran = startWithFakeRunHost(f.roots, f.repo, f.brief, host as Record<string, unknown>);
    assert.equal(ran.code, 3, ran.stdout + ran.stderr);
    runId = (/^run (run_[0-9A-Z]{26}): /m.exec(ran.stdout) as RegExpExecArray)[1] as string;
    const open = decisionsOf(f.roots, runId).filter((d) => d.state === 'open');
    assert.equal(open.length, 2, 'two open decisions');
    ids.push(...open.map((d) => d.decision_id));
  });

  it('withdraws both, in decision-ID order, and the status order of the decisions is the order they were opened in', async () => {
    const ran = await cancelCli(f.roots, [runId]);
    assert.equal(ran.code, 0, ran.err + ran.out);
    assert.equal(ran.out, `run ${runId}: cancelled; 2 decisions withdrawn\n`);
    const withdrawn = eventsOf(f.roots, runId, 'decision.withdrawn');
    assert.deepEqual(
      withdrawn.map((e) => e['decisionId']),
      [...ids].sort(),
      'two decision.withdrawn events, in decision-ID order',
    );
    assert.ok(withdrawn.every((e) => e['reason'] === 'cancel'));
    const opened = ledgerRows<{ decision_id: string }>(f.roots, 'SELECT decision_id FROM decisions WHERE run_id = ? ORDER BY opened_at, rowid', runId).map((d) => d.decision_id);
    assert.deepEqual(opened, [...ids].sort(), 'the decisions list in the order they were opened, which is their ID order');
    assert.equal(stateOf(f.roots, runId), 'cancelled');
  });
});

describe('empty: a run with no open decision and no lease, and a host its dead supervisor left running, is cancelled and the host is reaped (AUT-12)', () => {
  const f = singleFixture(cleanup);
  let runId = '';
  let survivor = 0;

  it('is `running` with nobody holding the lease, a surviving host process and no decision', () => {
    const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-invocation:run', UNIT);
    runId = killed.runId;
    survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8'));
    survivors.push(survivor);
    assert.ok(isAlive(survivor), 'the host process of the killed supervisor is still running');
    sleepSync(RUN_EXPIRY_WAIT_MS);
    assert.equal(stateOf(f.roots, runId), 'running');
    assert.equal(decisionsOf(f.roots, runId).length, 0, 'no decision exists');
    assert.equal(launchSteps(f.roots, runId), 1);
  });

  it('cancel withdraws nothing, ends the host, ends the attempt cancelled, keeps the invocation charged and moves the run to cancelled', async () => {
    const ran = await cancelCli(f.roots, [runId], { overrides: fakeHost() });
    assert.equal(ran.code, 0, ran.err + ran.out);
    assert.equal(ran.out, `run ${runId}: cancelled; 0 decisions withdrawn\n`);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.withdrawn'), []);
    assert.equal(stateOf(f.roots, runId), 'cancelled');
    assert.equal(runRowOf(f.roots, runId).lease_holder, null);
    await waitFor(() => !isAlive(survivor), 'the surviving host to be gone', 15_000);
    assert.equal(eventsOf(f.roots, runId, 'invocation.reaped').length, 1, 'exactly one invocation.reaped event');
    assert.deepEqual(
      attemptsOfRun(f.roots, runId).map((a) => a.outcome),
      ['cancelled'],
    );
    assert.equal(launchSteps(f.roots, runId), 1, 'no second unit');
    const budget = ledgerRows<{ used: number; reserved: number }>(f.roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0];
    assert.deepEqual([budget?.used, budget?.reserved], [1, 0], 'the killed invocation is charged and nothing is reserved');
    assert.deepEqual(ledgerRows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId), [], 'no step is left in flight');
  });
});

describe('terminal: cancelling a failed, cancelled or closed run exits 3 and writes no row (AUT-12)', () => {
  const s = startBlockedS17(cleanup);
  const { f, runId } = s;

  for (const state of ['failed', 'closed', 'cancelled'] as const) {
    it(`a ${state} run: exit 3, \`already ${state}\`, no row written`, async () => {
      // The ledger is moved to the state by hand: the run reached it by its own road in the suites that cover those roads.
      const db = openRaw(f.roots, false);
      try {
        db.prepare('UPDATE runs SET state = ?, lease_holder = NULL WHERE run_id = ?').run(state, runId);
      } finally {
        db.close();
      }
      const before = rowsSnapshot(f.roots, runId);
      const ran = await cancelCli(f.roots, [runId]);
      assert.equal(ran.code, 3, ran.err + ran.out);
      assert.match(ran.err, new RegExp(`already ${state}`));
      assert.deepEqual(rowsSnapshot(f.roots, runId), before);
      assert.equal(before.cancelRequestedAt, null, 'no request was recorded');
    });
  }
});

describe('adjacency: a cancel that races a stage transition is decided by the row version and the lease fence (AUT-12)', () => {
  it('a request that commits right after the stage moved the run: the transition stands, the cancel applies to the new state, no unit launches', async () => {
    const f = singleFixture(cleanup);
    const host = new FakeRunHost(UNIT);
    const composed = createDeps(profileEnv(f.roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const real = composed.value.deps;
      const started = startRun(real, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const { runId } = started.value;
      let raced = false;
      // The request is committed in the window right after the first transition to `running` commits: the point `after-transition:running` names.
      const ledger = new Proxy(real.ledger, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop !== 'transitionRun' || typeof value !== 'function') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          return (...args: unknown[]) => {
            const moved = (value as (...a: unknown[]) => { ok: boolean }).apply(target, args);
            if (moved.ok && !raced && (args[2] as { to: string }).to === 'running') {
              raced = true;
              assert.ok(target.requestRunCancel(runId, { by: 'owner', nowMs: Date.now() }).ok);
            }
            return moved;
          };
        },
      }) as Ledger;
      const deps: AppDeps = { ...real, ledger };
      const outcome = await runSupervisor(deps, runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.ok(raced, 'the request was committed in the window');
      assert.equal(outcome.value.state, 'cancelled');
      assert.equal(host.calls.length, 0, 'no unit was launched');
      const to = eventsOf(f.roots, runId, 'run.transition').map((t) => t['to']);
      assert.equal(to.filter((x) => x === 'running').length, 1, 'the stage transition committed once');
      assert.equal(to.at(-1), 'cancelled', 'and the cancel applied to the new state');
      assert.equal(to.filter((x) => x === 'cancelled').length, 1);
    } finally {
      composed.value.close();
    }
  });

  it('a cancel that commits first fences out the stage: its transition fails its guard and the run never ends moved on', async () => {
    const f = singleFixture(cleanup);
    const composed = createDeps(profileEnv(f.roots), { host: new FakeRunHost(UNIT) });
    assert.ok(composed.ok, 'composition');
    try {
      const { deps } = composed.value;
      const started = startRun(deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const { runId } = started.value;
      // A supervisor that holds the lease, reads the run and then stalls past its lease: the state a stage is in when a cancel races it.
      const grant = deps.ledger.acquireRunLease(runId, 'stalled-supervisor', 300, Date.now());
      assert.ok(grant.ok);
      const stale = makeRunContext(deps, runId, grant.value.fence, [], new AbortController().signal);
      const row = deps.ledger.getRun(runId);
      assert.ok(row.ok);
      sleepSync(500);

      const cancelled = await cancelRun(deps, runId, 'owner', Date.now());
      assert.ok(cancelled.ok, JSON.stringify(cancelled));
      assert.equal(cancelled.value.kind, 'cancelled');

      const moved = stale.transition(row.value, 'running', 'context-pack');
      assert.equal(moved.ok, false, 'the stage transition of the fenced-out supervisor is refused');
      assert.equal(stateOf(f.roots, runId), 'cancelled');
      assert.equal(transitionsTo(f.roots, runId, 'running'), 0, 'the run never moved on');
      assert.equal(transitionsTo(f.roots, runId, 'cancelled'), 1);
    } finally {
      composed.value.close();
    }
  });
});

describe('mid-cancel: a supervisor killed after the withdrawals and before the transition (AUT-12)', () => {
  for (const finisher of ['cancel', 'supervise'] as const) {
    it(`${finisher} finishes the cancel: no second withdrawal, no new unit, one transition to cancelled`, async () => {
      const { f, runId } = startLiveS17('mid-cancel');
      await untilHung(f.roots, runId);
      const launchesBefore = launchSteps(f.roots, runId);

      const requested = await cancelCli(f.roots, [runId], { overrides: fakeHost() });
      assert.equal(requested.code, 0, requested.err + requested.out);
      assert.equal(requested.out, `run ${runId}: cancel requested\n`);

      // The supervisor aborts C's unit, withdraws B's decision, and is killed at `mid-cancel`: the decision is withdrawn and the run is not yet cancelled.
      await waitFor(() => ledgerRows(f.roots, "SELECT 1 FROM decisions WHERE run_id = ? AND state = 'withdrawn'", runId).length === 1, 'the supervisor to withdraw the decision', 60_000);
      sleepSync(LIVE_LEASE_EXPIRY_WAIT_MS);
      assert.equal(stateOf(f.roots, runId), 'running', 'the supervisor died before the transition');
      assert.equal(eventsOf(f.roots, runId, 'decision.withdrawn').length, 1);

      if (finisher === 'cancel') {
        const again = await cancelCli(f.roots, [runId], { overrides: fakeHost() });
        assert.equal(again.code, 0, again.err + again.out);
        assert.equal(again.out, `run ${runId}: cancelled; 0 decisions withdrawn\n`, 'nothing is withdrawn a second time');
      } else {
        const supervised = runCli(['supervise', runId], { roots: f.roots, entry: TEST_CLI, env: runHostEnv({}), timeoutMs: 120_000 });
        assert.equal(supervised.code, 3, supervised.stdout + supervised.stderr);
        assert.equal(supervised.stdout.trim().split('\n')[0], `run ${runId}: cancelled`);
      }
      assert.equal(stateOf(f.roots, runId), 'cancelled');
      assert.equal(eventsOf(f.roots, runId, 'decision.withdrawn').length, 1, 'one withdrawal in all');
      assert.equal(transitionsTo(f.roots, runId, 'cancelled'), 1, 'one transition to cancelled');
      assert.equal(launchSteps(f.roots, runId), launchesBefore, 'no new unit');
      assert.equal(countOf(f.roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId), 0, 'every attempt ended');
      assert.equal(runRowOf(f.roots, runId).lease_holder, null);
    });
  }
});

describe('mid-cancel: `cancel` itself killed after the withdrawals, before the transition (AUT-12)', { skip: NO_PYTHON }, () => {
  it('running `cancel` again completes it with no second withdrawal', async () => {
    const s = startBlockedS17(cleanup);
    const { f, runId, decisionId } = s;
    const killed = runOnTerminal(f.roots, ['cancel', runId], { AVARICE_FAULT: 'mid-cancel', AVARICE_LEASE_TTL_MS: '400', AVARICE_FAKE_HOST: JSON.stringify({ run: {} }) });
    assert.ok(killed !== null);
    assert.notEqual(killed.code, 0, `the command was killed at mid-cancel: ${killed.output}`);
    assert.equal(ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE decision_id = ?', decisionId)[0]?.state, 'withdrawn', 'the decision was withdrawn before the kill');
    assert.equal(stateOf(f.roots, runId), 'blocked_on_decision', 'the run was not yet cancelled');
    assert.notEqual(rowsSnapshot(f.roots, runId).cancelRequestedAt, null, 'the request stands');

    sleepSync(RUN_EXPIRY_WAIT_MS);
    const again = await cancelCli(f.roots, [runId], { overrides: fakeHost() });
    assert.equal(again.code, 0, again.err + again.out);
    assert.equal(again.out, `run ${runId}: cancelled; 0 decisions withdrawn\n`);
    assert.equal(stateOf(f.roots, runId), 'cancelled');
    assert.equal(eventsOf(f.roots, runId, 'decision.withdrawn').length, 1, 'one withdrawal in all');
    assert.equal(transitionsTo(f.roots, runId, 'cancelled'), 1);
  });
});

describe('after-cancel-request: `cancel` killed right after its request is committed (AUT-12)', { skip: NO_PYTHON }, () => {
  it('the next supervisor start cancels the run at entry: the host is reaped, no stage runs and no unit launches', async () => {
    const f = singleFixture(cleanup);
    const killedRun = runRunWithFault(f.roots, f.repo, f.brief, 'mid-invocation:run', UNIT);
    const { runId } = killedRun;
    const survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8'));
    survivors.push(survivor);
    sleepSync(RUN_EXPIRY_WAIT_MS);
    assert.ok(isAlive(survivor), 'the host of the killed supervisor is still running');

    const killed = runOnTerminal(f.roots, ['cancel', runId], { AVARICE_FAULT: 'after-cancel-request', AVARICE_LEASE_TTL_MS: '400', AVARICE_FAKE_HOST: JSON.stringify({ run: {} }) });
    assert.ok(killed !== null);
    assert.notEqual(killed.code, 0, `the command was killed at after-cancel-request: ${killed.output}`);
    assert.notEqual(rowsSnapshot(f.roots, runId).cancelRequestedAt, null, 'the request was committed before the kill');
    assert.equal(stateOf(f.roots, runId), 'running', 'nothing else happened');
    assert.ok(isAlive(survivor), 'the host was not touched');

    const launches = launchSteps(f.roots, runId);
    const supervised = runCli(['supervise', runId], { roots: f.roots, entry: TEST_CLI, env: runHostEnv({}), timeoutMs: 120_000 });
    assert.equal(supervised.code, 3, supervised.stdout + supervised.stderr);
    assert.equal(supervised.stdout.trim().split('\n')[0], `run ${runId}: cancelled`);
    await waitFor(() => !isAlive(survivor), 'the surviving host to be gone', 15_000);
    assert.equal(launchSteps(f.roots, runId), launches, 'no new unit');
    assert.equal(eventsOf(f.roots, runId, 'invocation.reaped').length, 1);
    assert.equal(transitionsTo(f.roots, runId, 'cancelled'), 1);
    assert.deepEqual(
      attemptsOfRun(f.roots, runId).map((a) => a.outcome),
      ['cancelled'],
    );
    const budget = ledgerRows<{ used: number; reserved: number }>(f.roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0];
    assert.deepEqual([budget?.used, budget?.reserved], [1, 0]);
    const actions = ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
    assert.equal(actions.filter((a) => a === 'reconcile').length, 0, 'no reconcile ran: the cancel came before the prelude');
  });
});

describe('the cancel kill points are the ones this suite names', () => {
  it('lists after-cancel-request and mid-cancel', () => {
    assert.deepEqual([...CANCEL_KILL_POINTS], ['after-cancel-request', 'mid-cancel']);
  });
});
