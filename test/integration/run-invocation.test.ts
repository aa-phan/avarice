// Run-aware budget reservation and invocation bookkeeping (plan 02-12; CON-13, FR-7): a run reserves from its own budget rows before
// launch, records `launch:run` before the host starts, settles after, charges a killed invocation its reservation and an orphaned
// reservation on the next reserve, and its `invocation.finished` event carries the run, attempt and invocation IDs. The code is the
// onboarding pair generalized (budget.ts, invocation.ts), so Phase 1 behaviour is pinned by its own suites. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { reserveRunInvocation, settleInvocation } from '../../src/app/budget.ts';
import { completeRunInvocation, prepareRunInvocation } from '../../src/app/invocation.ts';
import type { PreparedRunInvocation } from '../../src/app/invocation.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { InvocationDetails, InvocationOutcome } from '../../src/ports/agent-host.ts';
import type { BudgetRow, RunRow } from '../../src/ports/ledger.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function envFor(roots: CliRoots): NodeJS.ProcessEnv {
  return { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT, AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude' };
}

interface Unit {
  roots: CliRoots;
  deps: AppDeps;
  runId: string;
  clone: string;
  gsdCoreDir: string;
  close(): void;
}

// A run in `running` with its clone, a work item, and the `gsd:inspect` step the supervisor's configure action will record.
function unit(): Unit {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const composed = createDeps(envFor(roots));
  assert.ok(composed.ok, 'composition');
  const { deps } = composed.value;
  const started = startRun(deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
  assert.ok(started.ok, JSON.stringify(started));
  const runId = started.value.runId;

  const workspace = deps.runWorkspace;
  assert.ok(workspace);
  const pin = started.value.contract.workspace.baseRevision;
  const prepared = workspace.prepare({ repoPath: repo.path, workRoot: deps.profile.workRoot, runId, pin });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const moved = deps.ledger.transitionRun(runId, { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: deps.clock.nowMs(), workspacePath: prepared.value.path, branch: prepared.value.branch });
  assert.ok(moved.ok, JSON.stringify(moved));

  const gsdCoreDir = join(roots.base, 'gsd-core');
  const agentsDir = join(roots.base, 'agents');
  mkdirSync(gsdCoreDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  const inspect = deps.ledger.recordRunStep(runId, { step: 'gsd:inspect', status: 'completed', result: { gsdCoreDir, agentsDir }, nowMs: deps.clock.nowMs(), completedAtMs: deps.clock.nowMs() });
  assert.ok(inspect.ok);
  return { roots, deps, runId, clone: prepared.value.path, gsdCoreDir, close: composed.value.close };
}

interface EventView {
  runId: string | null;
  attemptId: string | null;
  invocationId: string | null;
  data: Record<string, unknown>;
}

// The events of one type for the run, read straight from the ledger file.
function eventsOf(u: Unit, type: string): EventView[] {
  const handle = new DatabaseSync(join(u.roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    const rows = handle.prepare('SELECT run_id, attempt_id, invocation_id, data_json FROM events WHERE type = ? AND run_id = ? ORDER BY seq').all(type, u.runId) as Array<Record<string, string | null>>;
    return rows.map((r) => ({ runId: r['run_id'] ?? null, attemptId: r['attempt_id'] ?? null, invocationId: r['invocation_id'] ?? null, data: JSON.parse(r['data_json'] as string) as Record<string, unknown> }));
  } finally {
    handle.close();
  }
}

function runOf(u: Unit): RunRow {
  const run = u.deps.ledger.getRun(u.runId);
  assert.ok(run.ok);
  return run.value;
}

function budgetsOf(u: Unit): Record<string, BudgetRow> {
  const rows = u.deps.ledger.getBudgets(u.runId);
  assert.ok(rows.ok);
  return Object.fromEntries(rows.value.map((r) => [r.name, r]));
}

const budget = (u: Unit, name: string): BudgetRow => {
  const row = budgetsOf(u)[name];
  assert.ok(row, `a ${name} budget row`);
  return row;
};

function withUnit(fn: (u: Unit) => void): void {
  const u = unit();
  try {
    fn(u);
  } finally {
    u.close();
  }
}

const details = (extra: Partial<InvocationDetails> = {}): InvocationDetails => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  headMoved: false,
  transcriptBytes: 1234,
  hookDenies: 0,
  hookBudgetDenies: 0,
  numTurns: 7,
  resultSeen: true,
  isError: false,
  ...extra,
});

const outcomeOf = (extra: Partial<InvocationOutcome> = {}): InvocationOutcome => ({
  sessionId: 'sess-1',
  kind: 'progressed',
  permissionDenials: [],
  costUsd: 0.4,
  durationMs: 90_000,
  headBefore: 'a'.repeat(40),
  headAfter: 'a'.repeat(40),
  details: details(),
  ...extra,
});

describe('reserveRunInvocation: the run reserves from its own budget rows', () => {
  it('grants a fresh run the contract wall clock (120 min) and the per-invocation cost cap, and reserves one invocation', () => {
    withUnit((u) => {
      const reserved = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(reserved.ok);
      assert.ok(reserved.value.granted);
      assert.equal(reserved.value.reservation.runId, u.runId);
      assert.equal(reserved.value.reservation.purpose, 'run');
      assert.equal(reserved.value.reservation.wallClockMs, 120 * 60_000);
      assert.equal(reserved.value.reservation.costCapUsd, 2);
      assert.equal(budget(u, 'invocations').reserved, 1);
      assert.equal(budget(u, 'invocations').used, 0);
      assert.equal(budget(u, 'invocations').limit, 3, 'the limit is the contract limit and the reservation never raised it');
    });
  });

  it('caps the grant at what is left: the remaining wall clock and the remaining cost', () => {
    withUnit((u) => {
      assert.ok(u.deps.ledger.chargeBudget(u.runId, 'wallClockMs', 110 * 60_000, { fromReserved: false }).ok);
      assert.ok(u.deps.ledger.chargeBudget(u.runId, 'costUsd', 9.5, { fromReserved: false }).ok);
      const reserved = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(reserved.ok && reserved.value.granted);
      assert.equal(reserved.value.reservation.wallClockMs, 10 * 60_000);
      assert.equal(reserved.value.reservation.costCapUsd, 0.5);
    });
  });

  it('refuses the fourth reservation after three settled ones, naming the invocations budget', () => {
    withUnit((u) => {
      for (let i = 0; i < 3; i += 1) {
        const reserved = reserveRunInvocation(u.deps, runOf(u));
        assert.ok(reserved.ok && reserved.value.granted, `reservation ${i + 1}`);
        assert.ok(settleInvocation(u.deps, reserved.value.reservation, { durationMs: 1000, costUsd: 0.1 }).ok);
      }
      const fourth = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(fourth.ok);
      assert.deepEqual(fourth.value, { granted: false, budget: 'invocations' });
      assert.equal(budget(u, 'invocations').used, 3);
      assert.equal(budget(u, 'invocations').reserved, 0);
    });
  });

  it('refuses with the wall clock budget when none is left, and with the cost budget when none is left', () => {
    withUnit((u) => {
      assert.ok(u.deps.ledger.chargeBudget(u.runId, 'costUsd', 10, { fromReserved: false }).ok);
      const noCost = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(noCost.ok);
      assert.deepEqual(noCost.value, { granted: false, budget: 'costUsd' });
    });
    withUnit((u) => {
      assert.ok(u.deps.ledger.chargeBudget(u.runId, 'wallClockMs', 120 * 60_000, { fromReserved: false }).ok);
      const noClock = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(noClock.ok);
      assert.deepEqual(noClock.value, { granted: false, budget: 'wallClockMs' });
    });
  });

  it('charges an orphaned reservation on the next reserve: invocations plus one, cost plus the reservation, one event with the run ID', () => {
    withUnit((u) => {
      const first = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(first.ok && first.value.granted);
      // The holder died: no settle. The next reserve turns the reservation into spent budget.
      const next = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(next.ok && next.value.granted);
      assert.equal(budget(u, 'invocations').used, 1, 'the orphan was charged one invocation');
      assert.equal(budget(u, 'invocations').reserved, 1, 'and the new reservation is the only one held');
      assert.equal(budget(u, 'costUsd').used, 2, 'and the cost reservation it was granted');
      assert.equal(next.value.reservation.costCapUsd, 2, 'the 3.00 left still allows the per-invocation 2.00');

      const events = eventsOf(u, 'invocation.orphan-charged');
      assert.equal(events.length, 1);
      assert.equal(events[0]?.runId, u.runId);
      assert.equal(events[0]?.data['runId'], u.runId);
      assert.equal(events[0]?.data['invocations'], 1);
      assert.equal(events[0]?.data['costChargedUsd'], 2);
    });
  });

  it('never refunds or raises: a settled run keeps what it spent, and a second ensure of the rows changes no limit', () => {
    withUnit((u) => {
      const before = budgetsOf(u);
      const reserved = reserveRunInvocation(u.deps, runOf(u));
      assert.ok(reserved.ok && reserved.value.granted);
      assert.ok(settleInvocation(u.deps, reserved.value.reservation, { durationMs: 5000, costUsd: 0.75 }).ok);
      const after = budgetsOf(u);
      for (const name of Object.keys(before)) assert.equal(after[name]?.limit, before[name]?.limit, `${name} limit unchanged`);
      assert.equal(after['costUsd']?.used, 0.75);
      assert.equal(after['wallClockMs']?.used, 5000);
      assert.equal(after['invocations']?.used, 1);
    });
  });
});

describe('prepareRunInvocation: launch:run is recorded before the host starts', () => {
  it('records launch:run attempt 1 as started with the invocation, session and attempt IDs and returns a run-owned request', () => {
    withUnit((u) => {
      const run = runOf(u);
      const attempt = u.deps.ledger.recordRunAttempt(u.runId, { reason: 'unit', nowMs: u.deps.clock.nowMs() });
      assert.ok(attempt.ok);
      const prepared = prepareRunInvocation(u.deps, run, '/gsd-quick --validate --text "task"', { attemptId: attempt.value.attemptId, itemId: 'A' });
      assert.ok(prepared.ok, JSON.stringify(prepared));
      assert.ok(prepared.value.granted);
      const { request, reservation } = prepared.value.prepared;
      assert.equal(request.purpose, 'run');
      assert.equal(request.ownerKind, 'run');
      assert.equal(request.ownerId, u.runId);
      assert.equal(request.runId, u.runId);
      assert.equal(request.model, 'sonnet', 'the work item model');
      assert.equal(request.cwd, realpathSync(u.clone));
      assert.equal(request.scope.purpose, 'run');
      assert.equal(request.costCapUsd, reservation.costCapUsd);
      assert.equal(request.wallClockMs, reservation.wallClockMs);
      assert.match(request.invocationId, /^inv_[0-9A-Z]{26}$/);
      assert.match(request.sessionId ?? '', /^[0-9a-f-]{36}$/);
      assert.deepEqual(request.extensions.skills, ['gsd-quick']);
      assert.equal(prepared.value.prepared.attempt, 1);
      // The host's TMPDIR and the npm cache exist before it starts: its sandbox listens on a unix socket in TMPDIR, and a missing
      // directory made every Bash call fail `Sandbox is required but failed to initialize` in the first live run (plan 02-20).
      const scratch = request.scope.scratchDir as string;
      assert.ok(statSync(join(scratch, 'tmp')).isDirectory(), 'scratch/tmp exists');
      assert.ok(statSync(join(scratch, 'npm-cache')).isDirectory(), 'scratch/npm-cache exists');

      const steps = u.deps.ledger.getRunSteps(u.runId).ok ? (u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: Array<{ step: string; attempt: number; status: string; result: unknown }> }).value : [];
      const launch = steps.filter((s) => s.step === 'launch:run');
      assert.equal(launch.length, 1);
      assert.equal(launch[0]?.status, 'started');
      assert.equal(launch[0]?.attempt, 1);
      assert.deepEqual(launch[0]?.result, { invocationId: request.invocationId, sessionId: request.sessionId, purpose: 'run', attemptId: attempt.value.attemptId, itemId: 'A', model: 'sonnet' });
      assert.equal(budget(u, 'invocations').reserved, 1, 'the budget was reserved before the launch');
    });
  });

  it('numbers the next launch:run step 2 and is refused with a budget name, creating nothing, when invocations are used up', () => {
    withUnit((u) => {
      const attempt = u.deps.ledger.recordRunAttempt(u.runId, { reason: 'unit', nowMs: u.deps.clock.nowMs() });
      assert.ok(attempt.ok);
      const options = { attemptId: attempt.value.attemptId, itemId: 'A' };
      const first = prepareRunInvocation(u.deps, runOf(u), 'p', options);
      assert.ok(first.ok && first.value.granted);
      assert.ok(completeRunInvocation(u.deps, first.value.prepared, ok(outcomeOf())).ok);
      const second = prepareRunInvocation(u.deps, runOf(u), 'p', options);
      assert.ok(second.ok && second.value.granted);
      assert.equal(second.value.prepared.attempt, 2);
      assert.ok(completeRunInvocation(u.deps, second.value.prepared, ok(outcomeOf())).ok);
      const third = prepareRunInvocation(u.deps, runOf(u), 'p', options);
      assert.ok(third.ok && third.value.granted);
      assert.ok(completeRunInvocation(u.deps, third.value.prepared, ok(outcomeOf())).ok);

      const stepsBefore = (u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: unknown[] }).value.length;
      const fourth = prepareRunInvocation(u.deps, runOf(u), 'p', options);
      assert.ok(fourth.ok);
      assert.deepEqual(fourth.value, { granted: false, budget: 'invocations' });
      assert.equal((u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: unknown[] }).value.length, stepsBefore, 'no launch step was recorded for a refused reservation');
    });
  });

  it('refuses a run with no clone recorded, before anything is reserved', () => {
    withUnit((u) => {
      const run = { ...runOf(u), workspacePath: null };
      const attempt = u.deps.ledger.recordRunAttempt(u.runId, { reason: 'unit', nowMs: u.deps.clock.nowMs() });
      assert.ok(attempt.ok);
      const prepared = prepareRunInvocation(u.deps, run, 'p', { attemptId: attempt.value.attemptId, itemId: 'A' });
      assert.equal(prepared.ok, false);
      assert.equal(budget(u, 'invocations').reserved, 0);
    });
  });
});

describe('completeRunInvocation: settle, record, correlate', () => {
  function launched(u: Unit): { prepared: PreparedRunInvocation; attemptId: string } {
    const attempt = u.deps.ledger.recordRunAttempt(u.runId, { reason: 'unit', nowMs: u.deps.clock.nowMs() });
    assert.ok(attempt.ok);
    const prepared = prepareRunInvocation(u.deps, runOf(u), 'p', { attemptId: attempt.value.attemptId, itemId: 'A' });
    assert.ok(prepared.ok && prepared.value.granted);
    return { prepared: prepared.value.prepared, attemptId: attempt.value.attemptId };
  }

  it('records completed with cost, durations and counts, stores the transcript with retention run, and appends invocation.finished with runId, attemptId and invocationId', () => {
    withUnit((u) => {
      const { prepared, attemptId } = launched(u);
      const digest = 'b'.repeat(64);
      const done = completeRunInvocation(u.deps, prepared, ok(outcomeOf({ transcriptArtifact: digest })));
      assert.ok(done.ok);

      const steps = (u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: Array<{ step: string; status: string; result: Record<string, unknown> }> }).value;
      const launch = steps.find((s) => s.step === 'launch:run');
      assert.equal(launch?.status, 'completed');
      assert.equal(launch?.result['costUsd'], 0.4);
      assert.equal(launch?.result['costChargedUsd'], 0.4);
      assert.equal(launch?.result['durationMs'], 90_000);
      assert.equal(launch?.result['invocationId'], prepared.request.invocationId);
      assert.equal(launch?.result['attemptId'], attemptId);
      assert.equal(launch?.result['transcript'], digest);

      assert.equal(budget(u, 'invocations').used, 1);
      assert.equal(budget(u, 'invocations').reserved, 0);
      assert.equal(budget(u, 'wallClockMs').used, 90_000);
      assert.equal(budget(u, 'costUsd').used, 0.4);

      const handle = new DatabaseSync(join(u.roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
      try {
        const artifact = handle.prepare('SELECT kind, run_id, retention, size FROM artifacts WHERE digest = ?').get(digest) as Record<string, unknown>;
        assert.deepEqual({ ...artifact }, { kind: 'transcript', run_id: u.runId, retention: 'run', size: 1234 });
      } finally {
        handle.close();
      }

      const events = eventsOf(u, 'invocation.finished');
      const finished = events[0];
      assert.equal(events.length, 1);
      assert.equal(finished?.runId, u.runId);
      assert.equal(finished?.attemptId, attemptId);
      assert.equal(finished?.invocationId, prepared.request.invocationId);
      const data = finished?.data as Record<string, unknown>;
      assert.equal(data['runId'], u.runId);
      assert.equal(data['attemptId'], attemptId);
      assert.equal(data['invocationId'], prepared.request.invocationId);
      assert.equal(data['outcome'], 'progressed');
      assert.equal(data['numTurns'], 7);
      assert.equal('onboardingId' in data, false, 'a run event names no onboarding');
    });
  });

  it('charges a killed invocation the larger of what it reported and its reservation (never a refund)', () => {
    withUnit((u) => {
      const { prepared } = launched(u);
      const killed = outcomeOf({ costUsd: 0.5, details: details({ timedOut: true, signal: 'SIGKILL', exitCode: null }) });
      assert.ok(completeRunInvocation(u.deps, prepared, ok(killed)).ok);
      assert.equal(budget(u, 'costUsd').used, 2, 'the reservation (2.00) beats the reported 0.50');
      const events = eventsOf(u, 'invocation.finished');
      assert.equal(events[0]?.data['costBasis'], 'reservation');
      assert.equal(events[0]?.data['costChargedUsd'], 2);
    });
  });

  it('records a host error as failed, charges an interrupted invocation its reservation, and returns the host error unchanged', () => {
    withUnit((u) => {
      const { prepared } = launched(u);
      const failure = err({ kind: 'timeout' as const, afterMs: 3_600_000, sideEffect: 'unknown' as const });
      const done = completeRunInvocation(u.deps, prepared, failure);
      assert.equal(done.ok, false);
      assert.deepEqual(done.ok ? null : done.error, { kind: 'timeout', afterMs: 3_600_000, sideEffect: 'unknown' });
      const steps = (u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: Array<{ step: string; status: string; result: Record<string, unknown> }> }).value;
      const launch = steps.find((s) => s.step === 'launch:run');
      assert.equal(launch?.status, 'failed');
      assert.equal(launch?.result['error'], 'timeout');
      assert.equal(budget(u, 'costUsd').used, 2);
      assert.equal(budget(u, 'invocations').used, 1);
    });
  });

  it('records a denied host error with the (clipped) rule and no cost beyond the reported', () => {
    withUnit((u) => {
      const { prepared } = launched(u);
      const denied = err({ kind: 'denied' as const, rule: `enforcement_failure:${'x'.repeat(400)}`, enforcer: 'avarice' as const });
      const done = completeRunInvocation(u.deps, prepared, denied);
      assert.equal(done.ok, false);
      const steps = (u.deps.ledger.getRunSteps(u.runId) as { ok: true; value: Array<{ step: string; result: Record<string, unknown> }> }).value;
      const rule = steps.find((s) => s.step === 'launch:run')?.result['rule'];
      assert.equal(typeof rule, 'string');
      assert.equal((rule as string).length, 200);
      assert.equal(budget(u, 'costUsd').used, 0);
    });
  });
});
