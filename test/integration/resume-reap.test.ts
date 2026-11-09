// Plan 01-21 Task 2: the resume prelude, in-process. A supervisor killed before any launch leaves the onboarding in
// `planning_ready`; the tests then insert `started` launch rows the way `prepareInvocation` records them and resume
// with a host whose `reap` is observed or made to fail. What they pin: a failed reap stops the resume with every row
// still `started`; reaps run in ledger order and all complete before any row is marked; and an onboarding with no
// started launch is resumed without a single reap call. The process-level cases (a real survivor ended by its session
// ID) are in test/fault/killpoints.test.ts. Scratch repositories and temp directories only; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { reapBySessionId } from '../../src/adapters/host-claude/claude-host.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { resumeOnboarding } from '../../src/app/resume.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { AgentHost, ReapRequest } from '../../src/ports/agent-host.ts';
import type { StepResultRow } from '../../src/ports/ledger.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { EXPIRY_WAIT_MS, REPO_FILES, freshProfile, onboardingIdOf, rows, runWithFault, sleepSync } from '../helpers/fault-run.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

type ReapResult = Result<{ terminated: number }>;

interface Fixture {
  roots: CliRoots;
  onboardingId: string;
  deps: AppDeps;
  reapCalls: ReapRequest[];
  close(): void;
}

// A scratch onboarding killed at the checkpoint of `index:intel` (so before any intel or knowledge launch), reopened
// in-process with a host that wraps the fake host and answers `reap` with `reap`.
function fixture(reap: (request: ReapRequest, deps: AppDeps, onboardingId: string) => ReapResult): Fixture {
  const roots = freshProfile();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  runWithFault(roots, repo, 'after-checkpoint:index:intel');
  const onboardingId = onboardingIdOf(roots);
  // The killed process held a lease with a short expiry; the resume below takes it over once it has passed.
  sleepSync(EXPIRY_WAIT_MS);

  const reapCalls: ReapRequest[] = [];
  const inner = new FakeAgentHost();
  let current: AppDeps | undefined;
  const host: AgentHost = {
    descriptor: inner.descriptor,
    invoke: (request, signal) => inner.invoke(request, signal),
    reap: async (request) => {
      reapCalls.push(request);
      return reap(request, current as AppDeps, onboardingId);
    },
  };
  const env = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
  };
  const composed = createDeps(env, { host }, { gsd: true });
  assert.ok(composed.ok, 'composition');
  current = composed.value.deps;
  return { roots, onboardingId, deps: composed.value.deps, reapCalls, close: composed.value.close };
}

// The `started` row `prepareInvocation` records before the host is launched.
function insertStarted(deps: AppDeps, onboardingId: string, purpose: 'intel' | 'knowledge'): string {
  const sessionId = randomUUID();
  const recorded = deps.ledger.recordStepResult(onboardingId, {
    step: `launch:${purpose}`,
    attempt: 1,
    status: 'started',
    result: { invocationId: `inv_${purpose}`, sessionId, purpose },
    nowMs: Date.now(),
  });
  assert.ok(recorded.ok, 'the started row is recorded');
  return sessionId;
}

// The launch rows of the late invocations. The map launch finished before the kill and is not what these tests are about.
function launchRows(deps: AppDeps, onboardingId: string): StepResultRow[] {
  const steps = deps.ledger.getStepResults(onboardingId);
  assert.ok(steps.ok);
  return steps.value.filter((s) => s.step === 'launch:intel' || s.step === 'launch:knowledge');
}

function startedLaunches(deps: AppDeps, onboardingId: string): string[] {
  const steps = deps.ledger.getStepResults(onboardingId);
  assert.ok(steps.ok);
  return steps.value.filter((s) => s.step.startsWith('launch:') && s.status === 'started').map((s) => s.step);
}

const statusesOf = (list: StepResultRow[]): Array<{ step: string; attempt: number; status: string }> => list.map((s) => ({ step: s.step, attempt: s.attempt, status: s.status }));

describe('resume reaps every started launch before anything else (plan 01-21)', () => {
  it('fail closed: a reap that cannot end a survivor stops the resume, leaves every row started and runs no stage', async () => {
    const f = fixture(() => err({ kind: 'unavailable', cause: 'cannot search for the host process: test' }));
    try {
      const sessions = [insertStarted(f.deps, f.onboardingId, 'intel'), insertStarted(f.deps, f.onboardingId, 'knowledge')];
      const before = f.deps.ledger.getOnboarding(f.onboardingId);
      assert.ok(before.ok);
      const stepsBefore = f.deps.ledger.getStepResults(f.onboardingId);
      assert.ok(stepsBefore.ok);

      const resumed = await resumeOnboarding(f.deps, f.onboardingId);

      assert.equal(resumed.ok, false, 'the resume stops with an error');
      assert.equal(!resumed.ok && resumed.error.kind, 'unavailable');
      assert.deepEqual(f.reapCalls.map((c) => c.sessionId), [sessions[0]], 'the first failing reap stops the loop');
      assert.deepEqual(statusesOf(launchRows(f.deps, f.onboardingId)), [
        { step: 'launch:intel', attempt: 1, status: 'started' },
        { step: 'launch:knowledge', attempt: 1, status: 'started' },
      ]);
      const after = f.deps.ledger.getOnboarding(f.onboardingId);
      assert.ok(after.ok);
      assert.equal(after.value.state, 'planning_ready');
      assert.equal(after.value.version, before.value.version, 'no transition was committed');
      const stepsAfter = f.deps.ledger.getStepResults(f.onboardingId);
      assert.ok(stepsAfter.ok);
      assert.equal(stepsAfter.value.length, stepsBefore.value.length, 'no stage stored a result');
      assert.equal(stepsAfter.value.some((s) => s.step === 'index:intel'), false, 'the intel index step did not run');
      assert.deepEqual(rows<{ type: string }>(f.roots, "SELECT type FROM events WHERE type = 'invocation.reaped'"), []);
    } finally {
      f.close();
    }
  });

  it('ordering: reaps run in ledger order, every reap completes before any row is marked, and the resume reaches active', async () => {
    // The row statuses as they are at the instant of each reap call: no row may be marked while a reap is still to come.
    const statusesAtCall: string[][] = [];
    const f = fixture((_request, deps, onboardingId) => {
      statusesAtCall.push(launchRows(deps, onboardingId).map((s) => s.status));
      return ok({ terminated: 0 });
    });
    try {
      const sessions = [insertStarted(f.deps, f.onboardingId, 'intel'), insertStarted(f.deps, f.onboardingId, 'knowledge')];

      const resumed = await resumeOnboarding(f.deps, f.onboardingId);

      assert.ok(resumed.ok, 'the resume does not fail');
      assert.equal(resumed.value.state, 'active');
      assert.deepEqual(f.reapCalls.map((c) => c.sessionId), sessions, 'intel is reaped, then knowledge');
      assert.deepEqual(statusesAtCall, [
        ['started', 'started'],
        ['started', 'started'],
      ]);
      const finished = launchRows(f.deps, f.onboardingId).filter((s) => s.attempt === 1);
      assert.deepEqual(statusesOf(finished), [
        { step: 'launch:intel', attempt: 1, status: 'interrupted' },
        { step: 'launch:knowledge', attempt: 1, status: 'interrupted' },
      ]);
      assert.deepEqual(startedLaunches(f.deps, f.onboardingId), [], 'no launch is left in flight');
      assert.deepEqual(rows<{ type: string }>(f.roots, "SELECT type FROM events WHERE type = 'invocation.reaped'"), [], 'terminated 0 writes no event');
    } finally {
      f.close();
    }
  });

  it('empty: an onboarding with no started launch row is resumed with zero reap calls', async () => {
    const f = fixture(() => ok({ terminated: 0 }));
    try {
      assert.deepEqual(launchRows(f.deps, f.onboardingId), [], 'the kill came before any launch');
      const resumed = await resumeOnboarding(f.deps, f.onboardingId);
      assert.ok(resumed.ok, 'the resume does not fail');
      assert.equal(resumed.value.state, 'active');
      assert.equal(f.reapCalls.length, 0, 'nothing was reaped');
    } finally {
      f.close();
    }
  });
});

// The process-level rule: a host that outlives its supervisor is found by its session flag, whichever flag it carries. The IDs are
// unique per run because the search covers the whole process table.
describe('reapBySessionId finds a host by --session-id or --resume (plan 03-08, D-08)', () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const sleeper = (flag: string, sessionId: string): number => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', '--', flag, sessionId], { detached: true, stdio: 'ignore' });
    child.unref();
    assert.ok(child.pid !== undefined);
    return child.pid;
  };
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

  for (const flag of ['--session-id', '--resume']) {
    it(`ends a process whose command line carries ${flag} <uuid>, with its group, and counts it`, async () => {
      const sessionId = randomUUID();
      const pid = sleeper(flag, sessionId);
      await settle();
      assert.ok(alive(pid), 'the survivor is running');
      const reaped = await reapBySessionId(sessionId, 200);
      assert.deepEqual(reaped, { ok: true, value: { terminated: 1 } });
      assert.equal(alive(pid), false);
    });
  }

  it('leaves a process that carries the UUID under another flag, or another UUID under --resume, alone', async () => {
    const mine = randomUUID();
    const other = randomUUID();
    const wrongFlag = sleeper('--note', mine);
    const wrongId = sleeper('--resume', other);
    await settle();
    try {
      assert.deepEqual(await reapBySessionId(mine, 200), { ok: true, value: { terminated: 0 } });
      assert.ok(alive(wrongFlag) && alive(wrongId), 'neither process was touched');
    } finally {
      for (const pid of [wrongFlag, wrongId]) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  });
});
