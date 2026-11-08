// R-IN-06 (plan 02-30; FR-7, CON-13): a supervisor that loses the run lease while its unit is in flight ends the unit's host at once, instead of
// waiting out the unit's wall clock while it spends budget. The lease is stolen from inside the fake host's unit (a second SQLite connection writes
// another holder, the fence plus one and a far expiry into the run row), the supervisor's renewal timer fails on its next tick, and the supervisor aborts
// the signal its stage context hands to the host. The test uses scratch repositories, the fake run host and a real process group (a sleeper started in its
// own group by the host); no model is called. It drives the supervisor itself, not through runInProcess, because the supervisor ends with an error here.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunOutcome } from '../../src/app/run-service.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { openRaw } from '../helpers/fault-run.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
// The sleeper is ended by the host when it works; this is the backstop for a run in which the abort never came.
const sleepers: number[] = [];
after(() => {
  for (const pid of sleepers) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FAR_EXPIRY = new Date(Date.now() + 3_600_000).toISOString();
const OBSERVE_WITHIN_MS = 2000;
const GROUP_GONE_WITHIN_MS = 15_000;

const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

describe('a lease lost while the unit is in flight aborts the unit (R-IN-06)', () => {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  const brief = writeBrief(join(roots.base, 'briefs'));

  let stolenAtMs: number | undefined;
  let runId = '';
  let outcome: Result<RunOutcome> | undefined;
  let host: FakeRunHost | undefined;
  let hungMs = 0;

  const steal = (): void => {
    const db = openRaw(roots, false);
    try {
      db.prepare('UPDATE runs SET lease_holder = ?, lease_expires_at = ?, lease_fence = lease_fence + 1 WHERE run_id = ?').run('another-supervisor', FAR_EXPIRY, runId);
    } finally {
      db.close();
    }
    stolenAtMs = Date.now();
  };

  it('runs the supervisor with a unit that hangs until it is aborted and whose lease is taken', async () => {
    const was = process.env['AVARICE_LEASE_TTL_MS'];
    process.env['AVARICE_LEASE_TTL_MS'] = '600';
    const options: FakeRunOptions = {
      edits: { 'src/slug.ts': FIXED_SLUG },
      summary: true,
      verification: 'passed',
      hangUntilAbort: { maxMs: 8000, onStart: steal },
    };
    host = new FakeRunHost(options);
    const composed = createDeps(profileEnv(roots), { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      runId = started.value.runId;
      const t0 = Date.now();
      outcome = await runSupervisor(composed.value.deps, runId);
      hungMs = Date.now() - t0;
    } finally {
      composed.value.close();
      if (was === undefined) delete process.env['AVARICE_LEASE_TTL_MS'];
      else process.env['AVARICE_LEASE_TTL_MS'] = was;
      if (host.sleeperPid !== undefined) sleepers.push(host.sleeperPid);
    }
    assert.ok(stolenAtMs !== undefined, 'the lease was stolen from inside the unit');
  });

  it('the host observes the abort within 2000 ms of the theft', () => {
    assert.ok(host?.abortedAtMs !== undefined, `the host never saw an abort (the unit hung for ${hungMs} ms)`);
    assert.ok(stolenAtMs !== undefined);
    assert.ok(host.abortedAtMs - stolenAtMs <= OBSERVE_WITHIN_MS, `the abort came ${host.abortedAtMs - stolenAtMs} ms after the theft`);
  });

  it("the sleeper's process group is gone within 15000 ms", async () => {
    const pid = host?.sleeperPid;
    assert.ok(pid !== undefined, 'the host started a sleeper');
    const deadline = Date.now() + GROUP_GONE_WITHIN_MS;
    while (groupAlive(pid) && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(groupAlive(pid), false, 'the process group ended');
  });

  it('the supervisor ends with an error', () => {
    assert.ok(outcome !== undefined && !outcome.ok, `the supervisor returned ${JSON.stringify(outcome)}`);
  });

  it('no classify checkpoint exists for the attempt: the unit was not judged by the supervisor that lost the lease', () => {
    const actions = ledgerRows<{ next_action: string }>(roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
    assert.ok(actions.includes('launch:run'), `the unit was launched: ${actions.join(',')}`);
    assert.equal(actions.includes('classify'), false, `no classify checkpoint: ${actions.join(',')}`);
    assert.equal(actions.includes('discard-attempt'), false, `no discard: ${actions.join(',')}`);
  });

  it('the invocation stays charged: the invocations budget shows the unit used, nothing reserved', () => {
    const budget = ledgerRows<{ used: number; reserved: number }>(roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0];
    assert.ok(budget !== undefined);
    assert.equal(budget.used + budget.reserved, 1, 'one invocation is charged');
    assert.equal(budget.used, 1, 'it is settled as used');
  });

  it('the unit was invoked once: no retry under a lease this supervisor no longer held', () => {
    assert.equal(host?.calls.length, 1);
  });
});
