// `avarice cancel` (plan 03-24; AUT-12, owner decision 3 of 2026-11-08; S-20, T-03-47, T-03-48). The four-item scenario of plan 03-18 (S-17) is run through the
// real CLI with the fake run host until B asks and the run is blocked on one decision with no supervisor alive; the command then runs in this process through
// main() on a stream that claims to be a terminal. Every write is observed with raw SQL on the ledger, and the user's checkout is compared as one digest. No
// test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import type { InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { TEST_CLI, runHostEnv, runIdFromOutput } from '../helpers/fault-run.ts';
import { attemptsOfRun, itemStatesOf, runRowOf, s17Fixture, s17Host } from '../helpers/independent-work.ts';
import { runCli } from '../helpers/run-cli.ts';
import { FIXED_SLUG, ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import { waitFor } from '../helpers/shell-streams.ts';
import { cancelCli, checkoutState, cloneKept, eventsOf, rowsSnapshot, singleFixture, startBlockedS17 } from '../helpers/cancel-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('cancel: a run blocked on a decision, with no live supervisor, is cancelled from a terminal (tracer; AUT-12, S-20)', () => {
  const s = startBlockedS17(cleanup);
  const { f, runId, decisionId } = s;
  const checkoutBefore = checkoutState(f.repo.path);
  let first: Awaited<ReturnType<typeof cancelCli>>;

  it('is blocked on one open decision, with the lease free, before the cancel', () => {
    const row = runRowOf(f.roots, runId);
    assert.deepEqual([row.state, row.reason, row.lease_holder], ['blocked_on_decision', 'decision', null]);
    assert.deepEqual(
      ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE run_id = ?', runId).map((d) => d.state),
      ['open'],
    );
  });

  it('exits 0 and prints one result line: the run is cancelled and one decision was withdrawn', async () => {
    first = await cancelCli(f.roots, [runId]);
    assert.equal(first.code, 0, first.err + first.out);
    assert.equal(first.out, `run ${runId}: cancelled; 1 decision withdrawn\n`);
  });

  it('withdrew the decision with the reason cancel, moved the run to cancelled and freed the lease', () => {
    const decision = ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE decision_id = ?', decisionId)[0];
    assert.equal(decision?.state, 'withdrawn');
    const withdrawn = eventsOf(f.roots, runId, 'decision.withdrawn');
    assert.deepEqual(withdrawn, [{ runId, decisionId, reason: 'cancel' }]);
    const row = runRowOf(f.roots, runId);
    assert.deepEqual([row.state, row.reason, row.lease_holder], ['cancelled', null, null]);
    const transitions = eventsOf(f.roots, runId, 'run.transition').filter((t) => t['to'] === 'cancelled');
    assert.equal(transitions.length, 1, 'one transition to cancelled');
    assert.equal(transitions[0]?.['from'], 'blocked_on_decision');
    assert.equal(transitions[0]?.['withdrawn'], 1);
    assert.equal(ledgerRows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId)[0]?.n, 0, 'every attempt ended');
  });

  it('leaves the user checkout byte-identical and keeps the run clone and its branch (S-20, T-03-47)', () => {
    assert.equal(checkoutState(f.repo.path), checkoutBefore, 'the digest of the checkout is equal before and after');
    const kept = cloneKept(f.roots, runId);
    assert.equal(kept.directory, true, 'the run clone directory still exists');
    assert.equal(kept.head, true, 'the clone still has its HEAD');
    assert.ok(kept.branch !== null && kept.branch !== '', 'the run still names its branch');
  });

  it('a second cancel exits 3 with `already cancelled` and writes nothing', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const again = await cancelCli(f.roots, [runId]);
    assert.equal(again.code, 3, again.err + again.out);
    assert.match(again.err, /already cancelled/);
    assert.equal(again.out, '');
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('`resume` reports the cancelled run as stopped and takes no lease', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['resume', runId], { env: profileEnv(f.roots), io: { out: (t) => void out.push(t), err: (t) => void err.push(t) } });
    assert.equal(code, 3, err.join('') + out.join(''));
    assert.equal(out.join('').trim(), `run ${runId}: cancelled`);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
    assert.equal(runRowOf(f.roots, runId).lease_holder, null);
  });
});

describe('cancel refuses outside a person at a terminal, and writes nothing (CS-11, T-03-48)', () => {
  const s = startBlockedS17(cleanup);
  const { f, runId } = s;

  const inRunTree = (): Result<ProcessEntry[]> =>
    ok([
      { pid: 300, ppid: 250, command: 'node avarice.ts cancel' },
      { pid: 250, ppid: 200, command: 'claude -p --session-id 4b6f0f67-6b8b-4a91-9a1c-0c2f3d6f6f11 /gsd-quick' },
      { pid: 200, ppid: 100, command: 'node avarice.ts supervise run_X' },
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 1, ppid: 0, command: '/sbin/launchd' },
    ]);

  it('exits 64 under AVARICE_RUN', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const r = await cancelCli(f.roots, [runId], { env: { AVARICE_RUN: runId } });
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /AVARICE_RUN/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('exits 64 without a terminal on standard input or output', async () => {
    const before = rowsSnapshot(f.roots, runId);
    for (const stream of [{ stdinIsTty: false }, { stdoutIsTty: false }] as const) {
      const r = await cancelCli(f.roots, [runId], stream);
      assert.equal(r.code, 64, r.err + r.out);
      assert.match(r.err, /interactive terminal/);
    }
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it("exits 64 from inside a run's process tree", async () => {
    const before = rowsSnapshot(f.roots, runId);
    const r = await cancelCli(f.roots, [runId], { ancestry: inRunTree });
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /process tree/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('exits 64 for no run ID, two run IDs, a malformed ID and an unknown run', async () => {
    const before = rowsSnapshot(f.roots, runId);
    for (const argv of [[], [runId, runId], ['not-a-run']] as const) {
      const r = await cancelCli(f.roots, argv);
      assert.equal(r.code, 64, `${argv.join(' ')}: ${r.err}${r.out}`);
    }
    const unknown = await cancelCli(f.roots, ['run_00000000000000000000000000']);
    assert.equal(unknown.code, 64, unknown.err + unknown.out);
    assert.match(unknown.err, /no run/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
    assert.equal(rowsSnapshot(f.roots, runId).state, 'blocked_on_decision', 'the run is untouched');
  });
});

// ---- a supervisor holds the lease (plan 03-24, Task 2) -----------------------------------------------------------------------------------------------------

const sessionAlive = (sessionId: string): boolean => execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' }).split('\n').some((line) => line.includes(sessionId) && !line.includes('ps -axo'));

const HANG: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed', hangUntilAbort: { maxMs: 40_000 } };

describe('cancel with a live supervisor in the middle of a unit: the unit is aborted, ended cancelled and never retried (AUT-12)', () => {
  const s = singleFixture(cleanup);
  let runId = '';
  let sessionId = '';
  let ran: Awaited<ReturnType<typeof cancelCli>>;
  let elapsedMs = 0;

  it('starts a supervisor whose unit hangs, with the launch step in flight and a host process carrying the session', async () => {
    const started = runCli(['start', '--brief', s.brief, '--policy', 'routine'], { roots: s.roots, cwd: s.repo.path, entry: TEST_CLI, env: runHostEnv(HANG), timeoutMs: 120_000 });
    assert.equal(started.code, 0, started.stdout + started.stderr);
    runId = runIdFromOutput(started.stdout);
    await waitFor(() => ledgerRows(s.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'launch:run' AND status = 'started'", runId).length > 0, 'the unit to start', 60_000);
    const launch = ledgerRows<{ result_json: string }>(s.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run'", runId)[0] as { result_json: string };
    sessionId = (JSON.parse(launch.result_json) as { sessionId: string }).sessionId;
    await waitFor(() => sessionAlive(sessionId), 'the host process of the unit', 20_000);
    assert.notEqual(runRowOf(s.roots, runId).lease_holder, null, 'a supervisor holds the lease');
  });

  it('`cancel --wait` records the request, says so, and follows the run to cancelled', async () => {
    const t0 = Date.now();
    ran = await cancelCli(s.roots, [runId, '--wait']);
    elapsedMs = Date.now() - t0;
    assert.equal(ran.code, 0, ran.err + ran.out);
    assert.deepEqual(ran.out.trim().split('\n'), [`run ${runId}: cancel requested`, `run ${runId}: cancelled`]);
    assert.ok(elapsedMs < 20_000, `the unit was aborted within a few lease ticks, not at its own limit (${elapsedMs} ms)`);
    assert.notEqual(ledgerRows<{ cancel_requested_by: string | null }>(s.roots, 'SELECT cancel_requested_by FROM runs WHERE run_id = ?', runId)[0]?.cancel_requested_by, null);
  });

  it('the run is cancelled with the lease free, its attempt ended cancelled, and no host process is left', async () => {
    const row = runRowOf(s.roots, runId);
    assert.deepEqual([row.state, row.reason, row.lease_holder], ['cancelled', null, null]);
    assert.deepEqual(
      attemptsOfRun(s.roots, runId).map((a) => [a.reason, a.outcome]),
      [['initial', 'cancelled']],
    );
    await waitFor(() => !sessionAlive(sessionId), 'the host process to be gone', 15_000);
    assert.deepEqual(ledgerRows(s.roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId), [], 'no step is left in flight');
  });

  it('nothing was classified, discarded or launched a second time, and the killed invocation stays charged', () => {
    const actions = ledgerRows<{ next_action: string }>(s.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
    assert.ok(actions.includes('launch:run'), actions.join(','));
    assert.equal(actions.includes('classify'), false, `no classify checkpoint: ${actions.join(',')}`);
    assert.equal(actions.includes('discard-attempt'), false, `no discard: ${actions.join(',')}`);
    assert.equal(ledgerRows<{ n: number }>(s.roots, "SELECT count(*) AS n FROM run_steps WHERE run_id = ? AND step = 'launch:run'", runId)[0]?.n, 1, 'exactly one launch:run step for the item');
    const budget = ledgerRows<{ used: number; reserved: number }>(s.roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0];
    assert.deepEqual([budget?.used, budget?.reserved], [1, 0], 'one invocation, settled as used');
    // G0 is the enforcement check before any unit; G1 to G3 judge a unit and G4 the whole run.
    assert.equal(ledgerRows(s.roots, "SELECT 1 FROM gate_results WHERE run_id = ? AND gate <> 'G0'", runId).length, 0, 'no gate judged the unit');
  });

  it('`cancel` again exits 3 and writes nothing', async () => {
    const before = rowsSnapshot(s.roots, runId);
    const again = await cancelCli(s.roots, [runId]);
    assert.equal(again.code, 3, again.err + again.out);
    assert.match(again.err, /already cancelled/);
    assert.deepEqual(rowsSnapshot(s.roots, runId), before);
  });
});

// A host that plays the fake unit and then, once, asks to cancel the run, as an owner at another terminal would while the unit was finishing.
class CancelsAfterFirstUnit extends FakeRunHost {
  onFirst: () => void = () => undefined;
  override async invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    const outcome = await super.invoke(req, signal);
    if (this.calls.length === 1) this.onFirst();
    return outcome;
  }
}

describe('cancel between items and at the start of a supervisor: no further unit is launched (AUT-12)', () => {
  it('a request that lands as item A finishes is acted on before B launches: A stays committed, nothing else ran, the run is cancelled', async () => {
    const f = s17Fixture(cleanup);
    const host = new CancelsAfterFirstUnit(s17Host({}));
    const composed = createDeps(profileEnv(f.roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const { runId } = started.value;
      host.onFirst = () => void composed.value.deps.ledger.requestRunCancel(runId, { by: 'owner', nowMs: Date.now() });
      const outcome = await runSupervisor(composed.value.deps, runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'cancelled');
      assert.equal(host.calls.length, 1, 'only the first unit was launched');
      assert.deepEqual(itemStatesOf(f.roots, runId), [
        ['A', 'done'],
        ['B', 'ready'],
        ['C', 'ready'],
        ['D', 'ready'],
      ]);
      assert.deepEqual(
        attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.outcome]),
        [['A', 'committed']],
      );
      assert.equal(runRowOf(f.roots, runId).lease_holder, null);
    } finally {
      composed.value.close();
    }
  });

  it('a supervisor that starts on a run with a request standing cancels it at entry: no stage runs and no unit launches', async () => {
    const f = singleFixture(cleanup);
    const host = new FakeRunHost({ edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' });
    const composed = createDeps(profileEnv(f.roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const { runId } = started.value;
      assert.ok(composed.value.deps.ledger.requestRunCancel(runId, { by: 'owner', nowMs: Date.now() }).ok);
      const outcome = await runSupervisor(composed.value.deps, runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'cancelled');
      assert.equal(host.calls.length, 0, 'no unit was launched');
      const actions = ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
      assert.equal(actions.includes('prepare-workspace'), false, `no stage ran: ${actions.join(',')}`);
      assert.equal(runRowOf(f.roots, runId).lease_holder, null);
    } finally {
      composed.value.close();
    }
  });
});
