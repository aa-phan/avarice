// Crash safety of an item-local block (plan 03-18; AUT-3, T-03-33, T-03-34; FR-7, NFR-6). The S-17 brief (test/helpers/independent-work.ts) is the scenario: B
// asks, is parked and blocked, C completes, and the run is blocked on one decision. The supervisor is killed (SIGKILL, no cleanup) at the three points of that
// block, then the run is resumed, and what it ends as is compared with an uninterrupted run of the same brief in a second profile:
//
//   after-checkpoint:park   the park checkpoint is committed and the delta is still in the tree: the resume parks it and writes the decision
//   mid-park                the delta is parked and its step is recorded, the decision is not: the resume writes it from the step, B is not run again
//   after-release:blocked   the run is blocked and the lease is released, and the supervisor dies before it looks again: nothing is left to repair
//
// The fake run host is the only host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { runCli } from '../helpers/run-cli.ts';
import { PARK_KILL_POINTS, RUN_EXPIRY_WAIT_MS, TEST_CLI, resumeRunCli, runHostEnv, runRunWithFault, sleepSync, startRunArgs } from '../helpers/fault-run.ts';
import type { ParkKillPoint } from '../helpers/fault-run.ts';
import { ledgerRows, startWithFakeRunHost } from '../helpers/run-fixtures.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, parkRefOf, runIdOfOutput, runRowOf, s17Fixture, s17Host } from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const HOST = s17Host();

// What a blocked run is, apart from the IDs, times and paths that differ by design.
interface Blocked {
  run: [string, string | null];
  items: Array<[string, string]>;
  attempts: Array<[string | null, string, string | null]>;
  decisions: Array<{ class: string; state: string; options: string[]; affected: string[]; issue: string }>;
  parkSteps: Array<{ itemId: string; status: string; paths: string[] }>;
  parkRef: boolean;
  commits: Array<{ subject: string; files: string[] }>;
  invocationsUsed: number | undefined;
  gates: Array<[string | null, number]>;
  lease: string | null;
}

function blockedOf(f: S17Fixture, runId: string): Blocked {
  const run = runRowOf(f.roots, runId);
  return {
    run: [run.state, run.reason],
    items: itemStatesOf(f.roots, runId),
    attempts: attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.reason, a.outcome]),
    decisions: decisionsOf(f.roots, runId).map((d) => ({
      class: d.class,
      state: d.state,
      options: (JSON.parse(d.options_json) as Array<{ key: string }>).map((o) => o.key),
      affected: JSON.parse(d.affected_items_json) as string[],
      issue: d.issue,
    })),
    parkSteps: ledgerRows<{ status: string; result_json: string }>(f.roots, "SELECT status, result_json FROM run_steps WHERE run_id = ? AND step = 'park' ORDER BY rowid", runId).map((r) => {
      const body = JSON.parse(r.result_json) as { itemId: string; paths?: string[] };
      return { itemId: body.itemId, status: r.status, paths: body.paths ?? [] };
    }),
    parkRef: parkRefOf(run.workspace_path, runId, 'B') !== null,
    commits: commitsOfRun(run.workspace_path, f.pin),
    invocationsUsed: ledgerRows<{ used: number }>(f.roots, "SELECT used FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0]?.used,
    gates: ledgerRows<{ work_item: string | null; passed: number }>(f.roots, "SELECT work_item, passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId).map((g) => [g.work_item, g.passed]),
    lease: run.lease_holder,
  };
}

const notificationsOf = (roots: CliRoots): Array<[string, string, number]> =>
  ledgerRows<{ kind: string; state: string; subject_ids_json: string }>(roots, 'SELECT kind, state, subject_ids_json FROM notifications ORDER BY rowid').map((n) => [n.kind, n.state, (JSON.parse(n.subject_ids_json) as string[]).length]);

// The banner is raised by the supervise process after the run stops, so a read right after `--wait` can precede it.
async function bannerSettled(roots: CliRoots): Promise<void> {
  const end = Date.now() + 30_000;
  while (ledgerRows(roots, "SELECT 1 FROM notifications WHERE state = 'pending'").length > 0) {
    if (Date.now() > end) assert.fail('the banner was never delivered');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let reference: Blocked;
let referenceNotifications: Array<[string, string, number]>;

describe('the uninterrupted S-17 run is the reference', () => {
  it('ends blocked_on_decision with A and C done, B parked, one open decision and one delivered notice', async () => {
    const f = s17Fixture(cleanup);
    const ran = startWithFakeRunHost(f.roots, f.repo, f.brief, HOST as Record<string, unknown>);
    assert.equal(ran.code, 3, ran.stdout + ran.stderr);
    const runId = runIdOfOutput(ran.stdout);
    await bannerSettled(f.roots);
    reference = blockedOf(f, runId);
    referenceNotifications = notificationsOf(f.roots);
    assert.deepEqual(reference.run, ['blocked_on_decision', 'decision']);
    assert.deepEqual(reference.items, [
      ['A', 'done'],
      ['B', 'blocked_on_decision'],
      ['C', 'done'],
      ['D', 'ready'],
    ]);
    assert.equal(reference.decisions.length, 1);
    assert.equal(reference.parkRef, true);
    assert.equal(reference.invocationsUsed, 3);
    assert.deepEqual(referenceNotifications, [['decisions', 'delivered', 1]]);
  });
});

describe('a supervisor killed inside the block resumes to the same blocked state, and B is not run again', () => {
  for (const point of ['after-checkpoint:park', 'mid-park'] as const satisfies readonly ParkKillPoint[]) {
    it(point, async () => {
      const f = s17Fixture(cleanup);
      const killed = runRunWithFault(f.roots, f.repo, f.brief, point, HOST);
      const { runId } = killed;
      // The kill is inside the block: B has asked and nothing has moved the run on. The park step shows how far the block got.
      const midway = blockedOf(f, runId);
      assert.equal(midway.run[0], 'running', 'the run is interrupted in running');
      assert.equal(midway.decisions.length, 0, 'no decision was written yet');
      assert.deepEqual(
        midway.parkSteps.map((s) => s.status),
        [point === 'mid-park' ? 'completed' : 'started'],
        'the park step says how far the park got',
      );
      assert.equal(midway.parkRef, point === 'mid-park', 'the delta is out of the tree only after the park');
      assert.equal(midway.attempts.length, 2, 'A and B had run');

      sleepSync(RUN_EXPIRY_WAIT_MS);
      const resumed = resumeRunCli(f.roots, runId, HOST);
      assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
      assert.match(resumed.stdout.trim().split('\n').at(-1) as string, new RegExp(`^run ${runId}: blocked_on_decision`));
      await bannerSettled(f.roots);

      const result = blockedOf(f, runId);
      assert.deepEqual(result, reference, 'the resumed run is the uninterrupted run');
      assert.equal(result.attempts.filter((a) => a[0] === 'B').length, 1, 'no second unit of B ran');
      assert.deepEqual(notificationsOf(f.roots), referenceNotifications);
      assert.deepEqual(
        ledgerRows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId),
        [],
        'no step is left in flight',
      );
      assert.equal(ledgerRows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL", runId)[0]?.n, 0, 'every attempt ended');
    });
  }

  it('after-release:blocked', async () => {
    const f = s17Fixture(cleanup);
    const start = runCli(startRunArgs(f.brief), { roots: f.roots, cwd: f.repo.path, entry: TEST_CLI, env: runHostEnv(HOST, { AVARICE_FAULT: 'after-release:blocked' }), timeoutMs: 300_000 });
    const runId = runIdOfOutput(start.stdout);
    // The supervisor died after it released the lease and before it looked again (and before its banner): the run is blocked, no lease is held,
    // and the one notice it queued was never raised.
    const midway = blockedOf(f, runId);
    assert.deepEqual(midway.run, ['blocked_on_decision', 'decision']);
    assert.equal(midway.lease, null, 'the lease was released');
    assert.deepEqual(notificationsOf(f.roots), [['decisions', 'pending', 1]], 'the supervisor died before its banner');

    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, HOST);
    assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
    const result = blockedOf(f, runId);
    assert.deepEqual(result, midway, 'a resume of a blocked run changes nothing: no lease, no second decision');
    assert.equal(result.decisions.length, 1);
    assert.deepEqual(
      { ...result, ...{ parkRef: reference.parkRef } },
      { ...reference, ...{ lease: null } },
      'and the blocked state is the reference one',
    );
  });
});

describe('the park kill points are the ones this suite names', () => {
  it('lists after-checkpoint:park, mid-park and after-release:blocked', () => {
    assert.deepEqual([...PARK_KILL_POINTS], ['after-checkpoint:park', 'mid-park', 'after-release:blocked']);
  });
});
