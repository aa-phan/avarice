// The run's process model (plan 02-12; D-18, FR-2, FR-7, CON-3, SC 6): `start` records the run and spawns a detached
// `avarice supervise <runId>`; the supervisor takes the run lease and runs the checkpointed stages. Without an admitted host
// the run blocks with enforcement_failure; with the fake host (descriptor `enforced`) it goes on to the `running` stage of plan 02-13.
// This host is the onboarding fake, which cannot run a unit (its run purpose is `unsupported`), so the run ends in
// `blocked_on_decision (decision)`; the full path to `ready_for_review` is run-baseline-workflow.test.ts. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSupervisor } from '../../src/app/run-service.ts';
import { contractReadyStage } from '../../src/app/run-stages/prepare.ts';
import type { RunStageContext } from '../../src/app/run-stages/stage.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { startRun } from '../../src/app/run-start.ts';
import { ok } from '../../src/domain/result.ts';
import { spawnSupervisor } from '../../src/cli/spawn-supervisor.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { canonicalJson } from '../../src/domain/digest.ts';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { EXPIRY_WAIT_MS, TEST_CLI, sleepSync, spawnCli } from '../helpers/fault-run.ts';
import { commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const PROBE_ENTRY = join(REPO_ROOT, 'test', 'helpers', 'probe-supervisor-entry.ts');
const FAKE_ENFORCED = JSON.stringify({});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

// An onboarded repository with committed conventions, ready for `start`.
function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo);
  const brief = writeBrief(join(roots.base, 'briefs'));
  return { roots, repo, pin, brief };
}

function db(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = db(roots);
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

const startArgs = (f: Fixture, ...extra: string[]): string[] => ['start', '--brief', f.brief, '--policy', 'routine', ...extra];

// `start` through the production entry: no admitted claude, so the host reports enforcement `none`.
function startNoHost(f: Fixture, ...extra: string[]): CliResult {
  return runCli(startArgs(f, ...extra), { roots: f.roots, cwd: f.repo.path, timeoutMs: 120_000 });
}

// `start` through the test entry: the fake host reports enforcement `enforced`.
function startFakeHost(f: Fixture, env: Record<string, string | undefined> = {}, ...extra: string[]): CliResult {
  return runCli(startArgs(f, ...extra), { roots: f.roots, cwd: f.repo.path, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: FAKE_ENFORCED, ...env }, timeoutMs: 120_000 });
}

function superviseCli(f: Fixture, runId: string, env: Record<string, string | undefined> = {}, useFakeHost = true): CliResult {
  return runCli(['supervise', runId], {
    roots: f.roots,
    ...(useFakeHost ? { entry: TEST_CLI } : {}),
    env: { AVARICE_FAKE_HOST: FAKE_ENFORCED, ...env },
    timeoutMs: 120_000,
  });
}

function envFor(roots: CliRoots): NodeJS.ProcessEnv {
  return { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT, AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude' };
}

// Creates the run in this process (no supervisor is spawned), so a test can start supervisors itself.
function createRun(f: Fixture): string {
  const composed = createDeps(envFor(f.roots));
  assert.ok(composed.ok, 'composition');
  try {
    const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    return started.value.runId;
  } finally {
    composed.value.close();
  }
}

interface RunDbRow {
  run_id: string;
  state: string;
  reason: string | null;
  workspace_path: string | null;
  branch: string | null;
  base_revision: string | null;
  lease_holder: string | null;
  lease_fence: number;
}

const runOf = (roots: CliRoots, runId: string): RunDbRow => rows<RunDbRow>(roots, 'SELECT * FROM runs WHERE run_id = ?', runId)[0] as RunDbRow;
const checkpointsOf = (roots: CliRoots, runId: string): string[] => rows<{ next_action: string }>(roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);

function only<T>(items: readonly T[], what: string): T {
  assert.equal(items.length, 1, what);
  return items[0] as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(what: string, read: () => T | undefined, maxMs = 30_000): Promise<T> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

function runIdOf(stdout: string): string {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
}

describe('start --wait: a detached supervisor clones the workspace and blocks without an enforced host (tracer)', () => {
  it('exits 3 with the contract_ready line first and blocked_on_decision (enforcement_failure) last; G0 failed, clone at the pin', () => {
    const f = fixture();
    const r = startNoHost(f, '--wait');
    assert.equal(r.code, 3, r.stderr + r.stdout);
    const runId = runIdOf(r.stdout);
    assert.match(r.stdout.split('\n')[0] ?? '', /^run run_[0-9A-Z]{26}: contract_ready$/);
    const lines = r.stdout.split('\n').filter((l) => l !== '');
    assert.equal(lines.at(-1), `run ${runId}: blocked_on_decision (enforcement_failure)`);

    const run = runOf(f.roots, runId);
    assert.equal(run.state, 'blocked_on_decision');
    assert.equal(run.reason, 'enforcement_failure');
    const clone = join(f.roots.AVARICE_WORK_ROOT, runId, 'clone');
    assert.equal(run.workspace_path, clone, 'runs.workspace_path is the clone');
    assert.equal(run.branch, `avarice/${runId}`);
    assert.ok(existsSync(join(clone, '.git')), 'the clone exists');
    assert.equal(git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), `avarice/${runId}`);
    assert.equal(git(clone, ['rev-parse', 'HEAD']).trim(), f.pin, 'the clone is at the pin');

    const gates = rows<{ gate: string; passed: number; failures_json: string }>(f.roots, 'SELECT gate, passed, failures_json FROM gate_results WHERE run_id = ?', runId);
    const g0 = only(gates, 'one gate result');
    assert.equal(g0.gate, 'G0');
    assert.equal(g0.passed, 0);
    const failures = JSON.parse(g0.failures_json) as Array<{ rule: string }>;
    assert.deepEqual(failures.map((x) => x.rule), ['host-enforcement']);

    assert.deepEqual(checkpointsOf(f.roots, runId), ['prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement', 'none'], 'a checkpoint before each side effect, then the blocked transition');
    const steps = rows<{ step: string; status: string; result_json: string }>(f.roots, "SELECT step, status, result_json FROM run_steps WHERE run_id = ? AND step IN ('workspace:prepare', 'supervisor:spawn') ORDER BY rowid", runId);
    assert.deepEqual(steps.map((s) => s.step), ['supervisor:spawn', 'workspace:prepare']);
    assert.ok(steps.every((s) => s.status === 'completed'));
    const prepared = JSON.parse((steps[1] as { result_json: string }).result_json) as { path: string; branch: string };
    assert.equal(prepared.path, clone);
    assert.equal(prepared.branch, `avarice/${runId}`);
    assert.equal(run.lease_holder, null, 'the supervisor released the lease');
  });

  it('without --wait: exits 0 right after the spawn, records the supervisor PID, and the run reaches the same blocked state', async () => {
    const f = fixture();
    const r = startNoHost(f);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const runId = runIdOf(r.stdout);
    assert.doesNotMatch(r.stdout, /blocked_on_decision/, 'start did not wait');

    const spawned = only(rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'supervisor:spawn'", runId), 'a supervisor:spawn step');
    const pid = (JSON.parse(spawned.result_json) as { pid: number }).pid;
    assert.ok(Number.isInteger(pid) && pid > 1 && pid !== process.pid);

    const blocked = await waitFor('the detached supervisor to block the run', () => {
      const run = runOf(f.roots, runId);
      return run.state === 'blocked_on_decision' ? run : undefined;
    });
    assert.equal(blocked.reason, 'enforcement_failure');
  });

  it('the supervisor is not the start process: a different PID that outlives the command', async () => {
    const f = fixture();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', TEST_CLI, ...startArgs(f)], {
      cwd: f.repo.path,
      env: { ...envFor(f.roots), AVARICE_FAKE_HOST: FAKE_ENFORCED, NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const runId = runIdOf(stdout);
    const spawned = only(rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'supervisor:spawn'", runId), 'a supervisor:spawn step');
    const pid = (JSON.parse(spawned.result_json) as { pid: number }).pid;
    assert.notEqual(pid, child.pid, 'the supervisor PID differs from the start PID');
    // The fake host is enforced; its run purpose is unsupported, so the unit ends in a decision and the supervisor lets go of the lease.
    await waitFor('the run to stop and the lease to be released', () => {
      const run = runOf(f.roots, runId);
      return run.state === 'blocked_on_decision' && run.lease_holder === null ? true : undefined;
    });
  });
});

describe('spawnSupervisor: its own process group, stdio ignored, cwd the data root', () => {
  it('starts the entry detached: a different PID and process group, /dev/null for the three streams, cwd the given directory', async () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const probe = join(roots.base, 'probe.json');
    const env = { ...process.env, AVARICE_PROBE_OUT: probe, AVARICE_PROBE_LIVE_MS: '6000' } as NodeJS.ProcessEnv;
    delete env['NODE_TEST_CONTEXT'];
    const spawned = spawnSupervisor({ entry: PROBE_ENTRY, runId: 'run_01TESTTESTTESTTESTTESTTEST', env, cwd: roots.base });
    assert.ok(spawned.ok, JSON.stringify(spawned));
    const pid = spawned.pid;
    try {
      assert.notEqual(pid, process.pid);
      const seen = await waitFor('the probe file', () => (existsSync(probe) ? (JSON.parse(readFileSync(probe, 'utf8')) as { pid: number; cwd: string; argv: string[]; stdio: boolean[] }) : undefined));
      assert.equal(seen.pid, pid);
      assert.equal(statSync(seen.cwd).ino, statSync(roots.base).ino, 'cwd is the data root');
      assert.deepEqual(seen.argv, ['supervise', 'run_01TESTTESTTESTTESTTESTTEST']);
      assert.deepEqual(seen.stdio, [true, true, true], 'stdio is ignored (/dev/null)');
      const pgidOf = (p: number): string => execFileSync('ps', ['-o', 'pgid=', '-p', String(p)], { encoding: 'utf8' }).trim();
      assert.notEqual(pgidOf(pid), pgidOf(process.pid), 'the supervisor has its own process group');
      assert.equal(pgidOf(pid), String(pid), 'it leads that group');
    } finally {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });

  it('refuses a missing or a relative entry (the caller exits 70)', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const env = { ...process.env } as NodeJS.ProcessEnv;
    const missing = spawnSupervisor({ entry: join(roots.base, 'nope.ts'), runId: 'run_X', env, cwd: roots.base });
    assert.equal(missing.ok, false);
    const relative = spawnSupervisor({ entry: 'bin/avarice.ts', runId: 'run_X', env, cwd: roots.base });
    assert.equal(relative.ok, false);
    assert.match(relative.ok ? '' : relative.message, /absolute/);
  });
});

describe('supervise: the stage loop under the run lease', () => {
  it('with an enforced host the run passes G0, enters running, and ends in a decision when the host cannot run the unit', () => {
    const f = fixture();
    const runId = createRun(f);
    const r = superviseCli(f, runId);
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.match(r.stdout, new RegExp(`^run ${runId}: blocked_on_decision \\(decision\\)\\n`));
    assert.match(r.stdout, /the host could not run the unit \(unsupported\)/);
    const run = runOf(f.roots, runId);
    assert.equal(run.state, 'blocked_on_decision');
    assert.equal(run.lease_holder, null, 'the lease is released');
    assert.equal(run.lease_fence, 1);
    assert.equal(run.workspace_path, join(f.roots.AVARICE_WORK_ROOT, runId, 'clone'));
    assert.equal(run.branch, `avarice/${runId}`);
    assert.deepEqual(checkpointsOf(f.roots, runId), ['prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement', 'context-pack', 'context-pack', 'launch:run', 'classify', 'none']);
    const g0 = only(rows<{ passed: number }>(f.roots, "SELECT passed FROM gate_results WHERE run_id = ? AND gate = 'G0'", runId), 'one G0 row');
    assert.equal(g0.passed, 1);
  });

  it('verify-enforcement is idempotent: evaluating G0 again for the same contract, policy and revision adds no second row (02-12 carry-over)', async () => {
    const f = fixture();
    const runId = createRun(f);
    const composed = createDeps(envFor(f.roots), { host: new FakeAgentHost() });
    assert.ok(composed.ok, 'composition');
    try {
      const { deps } = composed.value;
      const lease = deps.ledger.acquireRunLease(runId, 'test-holder', 60_000, Date.now());
      assert.ok(lease.ok);
      const fence = lease.value.fence;
      const ctx: RunStageContext = {
        deps,
        runId,
        fence,
        checkpoint: (nextAction, extra) => deps.ledger.recordRunCheckpoint(runId, { fence }, { nextAction, nowMs: Date.now(), ...(extra ?? {}) }),
        transition: (row, to, nextAction, options = {}) => deps.ledger.transitionRun(runId, { version: row.version, fence }, { to, nextAction, nowMs: Date.now(), ...options }),
        note: () => undefined,
      };
      const before = deps.ledger.getRun(runId);
      assert.ok(before.ok);
      assert.equal((await contractReadyStage(ctx, before.value)).ok, true, 'the first pass prepares, configures, passes G0 and moves to running');
      assert.equal(deps.ledger.getRun(runId).ok && (deps.ledger.getRun(runId) as { value: { state: string } }).value.state, 'running');
      // A kill between the G0 insert and the transition repeats the action with the row as it was: the transition is refused (the row moved on),
      // but the gate is evaluated again.
      const again = await contractReadyStage(ctx, before.value);
      assert.equal(again.ok, false, 'the stale row cannot transition a second time');
      const g0 = deps.ledger.listGateResults(runId);
      assert.ok(g0.ok);
      assert.equal(g0.value.filter((g) => g.gate === 'G0').length, 1, 'one G0 row, not two');
    } finally {
      composed.value.close();
    }
  });

  it('a kill at after-checkpoint:prepare-workspace leaves the run in contract_ready with the lease held until it expires', () => {
    const f = fixture();
    const runId = createRun(f);
    const r = superviseCli(f, runId, { AVARICE_FAULT: 'after-checkpoint:prepare-workspace', AVARICE_LEASE_TTL_MS: '200' });
    assert.equal(r.signal, 'SIGKILL');
    const run = runOf(f.roots, runId);
    assert.equal(run.state, 'contract_ready');
    assert.ok(run.lease_holder !== null, 'nothing released the lease');
    assert.equal(run.lease_fence, 1);
    assert.deepEqual(checkpointsOf(f.roots, runId), ['prepare-workspace']);
    assert.equal(existsSync(join(f.roots.AVARICE_WORK_ROOT, runId, 'clone')), false, 'the side effect had not run yet');
  });

  it('rewrites a missing contract file from the ledger before launching anything (02-10 carry-over)', () => {
    const f = fixture();
    const runId = createRun(f);
    const file = join(f.roots.AVARICE_DATA_ROOT, 'runs', runId, 'contract-v1.json');
    assert.ok(existsSync(file));
    const original = readFileSync(file, 'utf8');
    unlinkSync(file);
    const r = superviseCli(f, runId, {}, false);
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.ok(existsSync(file), 'the supervisor rewrote the contract file');
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const stored = rows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ?', runId)[0];
    assert.equal(canonicalJson(JSON.parse((stored as { body_json: string }).body_json)), original);
  });

  it('`avarice supervise` with no run ID exits 64 with usage; an unknown ID exits 64 naming it', () => {
    const none = runCli(['supervise']);
    assert.equal(none.code, 64);
    assert.match(none.stderr, /usage: avarice supervise <runId>/);
    const f = fixture();
    const unknown = superviseCli(f, 'run_01ZZZZZZZZZZZZZZZZZZZZZZZZ');
    assert.equal(unknown.code, 64, unknown.stderr + unknown.stdout);
    assert.match(unknown.stderr, /run_01ZZZZZZZZZZZZZZZZZZZZZZZZ/);
  });
});

describe('supervise leaves a finished run alone', () => {
  it('a run already in a stop state runs no stage and takes no checkpoint', () => {
    const f = fixture();
    const runId = createRun(f);
    const first = superviseCli(f, runId, {}, false);
    assert.equal(first.code, 3);
    const before = checkpointsOf(f.roots, runId);
    const second = superviseCli(f, runId, {}, false);
    assert.equal(second.code, 3, second.stderr + second.stdout);
    assert.match(second.stdout, new RegExp(`^run ${runId}: blocked_on_decision \\(enforcement_failure\\)\\n`));
    assert.deepEqual(checkpointsOf(f.roots, runId), before);
  });
});

// Process and lease guarantees (D-18, FR-4, T-02-38, T-02-40): one supervisor drives a run, the run outlives the command that started
// it, and a supervisor that died is reported and replaced only after its lease has lapsed.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function spawnedPid(roots: CliRoots, runId: string): number | undefined {
  const found = rows<{ result_json: string }>(roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'supervisor:spawn'", runId)[0];
  return found === undefined ? undefined : (JSON.parse(found.result_json) as { pid: number }).pid;
}

describe('one supervisor per run', () => {
  it('a second supervise for a run whose lease is live exits 3 with `lease must expire first` and records no checkpoint', async () => {
    const f = fixture();
    const runId = createRun(f);
    const composed = createDeps(envFor(f.roots));
    assert.ok(composed.ok, 'composition');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inStage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    // The first supervisor holds the lease and is kept inside its prelude, as a supervisor waiting on the host would be.
    const holder = runSupervisor(composed.value.deps, runId, {
      prelude: async () => {
        entered();
        await gate;
        return ok(undefined);
      },
    });
    try {
      await inStage;
      const held = runOf(f.roots, runId);
      assert.ok(held.lease_holder !== null);
      assert.equal(held.lease_fence, 1);
      const before = checkpointsOf(f.roots, runId);

      const second = await spawnCli(['supervise', runId], f.roots, {}, { AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude', AVARICE_LEASE_TTL_MS: '180000' });
      assert.equal(second.code, 3, second.stderr + second.stdout);
      assert.match(second.stderr, /lease must expire first/);
      assert.equal(second.stdout, '', 'no result line: nothing ran');
      assert.deepEqual(checkpointsOf(f.roots, runId), before, 'no checkpoint was recorded');
      assert.equal(runOf(f.roots, runId).lease_fence, 1, 'the lease was not taken');
      assert.equal(runOf(f.roots, runId).state, 'contract_ready');
    } finally {
      release();
      const outcome = await holder;
      composed.value.close();
      assert.ok(outcome.ok, JSON.stringify(outcome));
    }
  });

  it('with AVARICE_LEASE_TTL_MS=200 a supervise started after the first one died takes the expired lease (fence 2) and continues', () => {
    const f = fixture();
    const runId = createRun(f);
    const first = superviseCli(f, runId, { AVARICE_FAULT: 'after-checkpoint:prepare-workspace', AVARICE_LEASE_TTL_MS: '200' });
    assert.equal(first.signal, 'SIGKILL');
    assert.equal(runOf(f.roots, runId).lease_fence, 1);
    sleepSync(EXPIRY_WAIT_MS);

    const second = superviseCli(f, runId, { AVARICE_LEASE_TTL_MS: '200' });
    assert.equal(second.code, 3, second.stderr + second.stdout);
    assert.match(second.stdout, new RegExp(`^run ${runId}: blocked_on_decision \\(decision\\)\\n`));
    const run = runOf(f.roots, runId);
    assert.equal(run.lease_fence, 2, 'the takeover bumped the fence');
    assert.equal(run.lease_holder, null, 'and the new holder released it');
    assert.equal(run.state, 'blocked_on_decision');
    assert.deepEqual(
      checkpointsOf(f.roots, runId),
      ['prepare-workspace', 'prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement', 'context-pack', 'context-pack', 'launch:run', 'classify', 'none'],
      'the killed side effect was repeated once, nothing else',
    );
    assert.ok(existsSync(join(f.roots.AVARICE_WORK_ROOT, runId, 'clone', '.git')));
  });
});

describe('the run outlives the command that started it, and a dead supervisor is reported', () => {
  it('SIGKILL to `start --wait` leaves the supervisor alive and the run still reaches its stop state', async () => {
    const f = fixture();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', PRODUCTION_ENTRY, ...startArgs(f, '--wait')], {
      cwd: f.repo.path,
      env: { ...envFor(f.roots), NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv,
      stdio: 'ignore',
    });
    const runIdAndPid = await waitFor('the supervisor:spawn step', () => {
      const run = rows<{ run_id: string }>(f.roots, "SELECT run_id FROM runs WHERE state <> 'onboarding'")[0];
      if (run === undefined) return undefined;
      const pid = spawnedPid(f.roots, run.run_id);
      return pid === undefined ? undefined : { runId: run.run_id, pid };
    });
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
    child.kill('SIGKILL');
    await closed;
    assert.ok(alive(runIdAndPid.pid), 'the supervisor survived the death of the command that started it');

    const blocked = await waitFor('the supervisor to finish the run', () => {
      const run = runOf(f.roots, runIdAndPid.runId);
      return run.state === 'blocked_on_decision' ? run : undefined;
    });
    assert.equal(blocked.reason, 'enforcement_failure');
    await waitFor('the supervisor to exit', () => (alive(runIdAndPid.pid) ? undefined : true));
  });

  it('a supervisor killed at after-checkpoint:verify-enforcement is reported: start --wait exits 3 with the interrupted line and how to continue', () => {
    const g = fixture();
    const killed = runCli(startArgs(g, '--wait'), { roots: g.roots, cwd: g.repo.path, env: { AVARICE_FAULT: 'after-checkpoint:verify-enforcement', AVARICE_LEASE_TTL_MS: '200' }, timeoutMs: 120_000 });
    assert.equal(killed.code, 3, killed.stderr + killed.stdout);
    const runId = runIdOf(killed.stdout);
    const lines = killed.stdout.split('\n').filter((l) => l !== '');
    assert.equal(lines.at(-2), `run ${runId}: interrupted in contract_ready (next: verify-enforcement)`);
    assert.equal(lines.at(-1), `continue with: avarice resume ${runId}`);
    const run = runOf(g.roots, runId);
    assert.equal(run.state, 'contract_ready');
    assert.deepEqual(checkpointsOf(g.roots, runId), ['prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement']);
    const pid = spawnedPid(g.roots, runId);
    assert.ok(pid !== undefined && !alive(pid), 'the supervisor is gone');
  });
});
