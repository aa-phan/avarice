// G-02-10 (plan 02-24; CON-16, FR-7): a supervisor that another holder superseded cannot commit the `discard-attempt` checkpoint, and so never
// restores the run's clone. The takeover is staged just before the checkpoint (a second composition acquires the run lease, bumping its fence),
// and the test compares the clone, every table of the store and the other holder's lease row before and after the refused supervisor returns.
// The supervisor is driven through `runSupervisor` with the `reconcileRun` prelude, the composition the detached `supervise` process uses. The
// interception (a Proxy over the ledger and one over the workspace) lives here and nowhere in src. No test in this file calls a real model.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDeps } from '../../src/app/deps.ts';
import { leaseTtlMs } from '../../src/app/onboarding-service.ts';
import { reconcileRun } from '../../src/app/run-resume.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import type { RunOutcome } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunWorkspace } from '../../src/ports/run-workspace.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { openRaw } from '../helpers/fault-run.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, RUN_REPO_FILES, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const OTHER_HOLDER = 'another-supervisor';
const TWO_FILES = ['src/slug.ts', 'src/extra.ts'] as const;
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
// The unit of attempt 1 writes two files and dies; the retry fixes the file.
const CRASH_THEN_FIX: FakeRunOptions = { perAttempt: [{ crash: { afterFiles: TWO_FILES } }, FIX] };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

interface Composed {
  deps: AppDeps;
  close: () => void;
}

function compose(roots: CliRoots, run: FakeRunOptions): Composed {
  const composed = createDeps(profileEnv(roots), { host: new FakeRunHost(run) });
  assert.ok(composed.ok, 'composition');
  return { deps: composed.value.deps, close: composed.value.close };
}

// Every table of the store, every row in rowid order, through a read-only connection: what "the ledger is unchanged" means here.
type StoreDump = Record<string, unknown[]>;

function storeDump(roots: CliRoots): StoreDump {
  const db = openRaw(roots, true);
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
    const dump: StoreDump = {};
    for (const name of tables) dump[name] = (db.prepare(`SELECT rowid AS "__rowid", * FROM "${name}" ORDER BY rowid`).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));
    return dump;
  } finally {
    db.close();
  }
}

interface RunDb {
  state: string;
  version: number;
  workspace_path: string;
  lease_holder: string | null;
  lease_expires_at: string | null;
  lease_fence: number;
}
const runRow = (roots: CliRoots, runId: string): RunDb =>
  ledgerRows<RunDb>(roots, 'SELECT state, version, workspace_path, lease_holder, lease_expires_at, lease_fence FROM runs WHERE run_id = ?', runId)[0] as RunDb;
const leaseOf = (row: RunDb): { holder: string | null; expiresAt: string | null; fence: number } => ({ holder: row.lease_holder, expiresAt: row.lease_expires_at, fence: row.lease_fence });

// The state of the world at the instant of the takeover, taken after the other holder acquired the lease and before the supervisor's call went on.
interface Capture {
  clone: ReturnType<typeof checkoutSnapshot>;
  dump: StoreDump;
  run: RunDb;
}

// `checkpoint`: the other holder acts inside the supervisor's `discard-attempt` checkpoint call, before it reaches the ledger.
type Hook = 'take' | 'none';

interface Scenario {
  hook: Hook;
  // Where the hook fires on the supervisor's way to the discard.
  at: 'checkpoint';
}

interface World {
  f: Fixture;
  runId: string;
  outcome: Result<RunOutcome>;
  fired: number;
  discardCalls: number;
  grantFence: number | null;
  atTakeover: Capture | null;
  close: () => void;
}

function conflictOf(result: Result<unknown>): { expected: string; actual: string } {
  assert.ok(!result.ok, 'the supervisor was refused');
  assert.equal(result.error.kind, 'conflict');
  if (result.error.kind !== 'conflict') throw new Error('unreachable');
  return { expected: result.error.expected, actual: result.error.actual };
}

// Wraps the supervisor's ledger and workspace in this process. Both are replaced on the AppDeps object the supervisor reads at call time.
function instrument(f: Fixture, runId: string, supervisor: Composed, other: Composed, scenario: Scenario, state: Pick<World, 'fired' | 'discardCalls' | 'grantFence' | 'atTakeover'>): void {
  const takeover = (): void => {
    if (scenario.hook === 'none' || state.fired > 0) return;
    state.fired += 1;
    const ttl = leaseTtlMs();
    const grant = other.deps.ledger.acquireRunLease(runId, OTHER_HOLDER, ttl, Date.now() + ttl + 1000);
    assert.ok(grant.ok, `the other holder takes the lease: ${JSON.stringify(grant)}`);
    state.grantFence = grant.value.fence;
    const run = runRow(f.roots, runId);
    state.atTakeover = { clone: checkoutSnapshot(run.workspace_path), dump: storeDump(f.roots), run };
  };

  const realLedger = supervisor.deps.ledger;
  supervisor.deps.ledger = new Proxy(realLedger, {
    get(target, prop) {
      if (prop === 'recordRunCheckpoint') {
        return (...args: Parameters<typeof target.recordRunCheckpoint>) => {
          if (args[2].nextAction === 'discard-attempt') takeover();
          return target.recordRunCheckpoint(...args);
        };
      }
      const member = Reflect.get(target, prop) as unknown;
      return typeof member === 'function' ? (member as (...a: unknown[]) => unknown).bind(target) : member;
    },
  });

  const realWorkspace = supervisor.deps.runWorkspace as RunWorkspace;
  supervisor.deps.runWorkspace = new Proxy(realWorkspace, {
    get(target, prop) {
      if (prop === 'discard') {
        return (...args: Parameters<typeof target.discard>) => {
          state.discardCalls += 1;
          return target.discard(...args);
        };
      }
      const member = Reflect.get(target, prop) as unknown;
      return typeof member === 'function' ? (member as (...a: unknown[]) => unknown).bind(target) : member;
    },
  });
}

// The crash-and-retry path: attempt 1 crashes after writing two files, and the running stage's crash route reaches the discard.
async function crashPath(scenario: Scenario): Promise<World> {
  const f = fixture();
  const supervisor = compose(f.roots, CRASH_THEN_FIX);
  const other = compose(f.roots, {});
  const close = (): void => {
    supervisor.close();
    other.close();
  };
  const started = startRun(supervisor.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
  assert.ok(started.ok, JSON.stringify(started));
  const runId = started.value.runId;
  const state = { fired: 0, discardCalls: 0, grantFence: null as number | null, atTakeover: null as Capture | null };
  instrument(f, runId, supervisor, other, scenario, state);
  const outcome = await runSupervisor(supervisor.deps, runId, { prelude: reconcileRun });
  return { f, runId, outcome, ...state, close };
}

const checkpointsOf = (f: Fixture, runId: string): string[] => ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
const attemptOutcomes = (f: Fixture, runId: string): Array<string | null> => ledgerRows<{ outcome: string | null }>(f.roots, 'SELECT outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId).map((a) => a.outcome);

describe('stale fence on the crash path', () => {
  let w: World;
  let afterRun: { clone: ReturnType<typeof checkoutSnapshot>; dump: StoreDump; run: RunDb };
  before(async () => {
    w = await crashPath({ hook: 'take', at: 'checkpoint' });
    const run = runRow(w.f.roots, w.runId);
    afterRun = { clone: checkoutSnapshot(run.workspace_path), dump: storeDump(w.f.roots), run };
  });
  after(() => w.close());

  it('refuses the supervisor at the checkpoint with a conflict naming both fences', () => {
    assert.equal(w.fired, 1, 'the takeover happened once');
    assert.equal(w.grantFence, 2, 'the other holder holds fence 2');
    assert.deepEqual(conflictOf(w.outcome), { expected: 'lease fence 1', actual: 'lease fence 2' });
  });

  it('commits no `discard-attempt` checkpoint and never calls the workspace restore', () => {
    assert.equal(checkpointsOf(w.f, w.runId).includes('discard-attempt'), false);
    assert.equal(w.discardCalls, 0);
  });

  it('leaves the clone as it was at the takeover: HEAD, index, the crashed unit\'s edits and its extra file', () => {
    const taken = w.atTakeover as Capture;
    assert.deepEqual(afterRun.clone, taken.clone);
    const clone = afterRun.run.workspace_path;
    assert.equal(existsSync(join(clone, 'src', 'extra.ts')), true, 'the file the crashed unit created is still there');
    assert.notEqual(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8'), RUN_REPO_FILES['src/slug.ts'], 'the crashed unit\'s partial write is still there');
  });

  it('leaves every table of the store row for row as it was at the takeover', () => {
    assert.deepEqual(afterRun.dump, (w.atTakeover as Capture).dump);
  });

  it('leaves the other holder\'s lease row untouched, and the source checkout unchanged', () => {
    const taken = w.atTakeover as Capture;
    assert.deepEqual(leaseOf(afterRun.run), leaseOf(taken.run));
    assert.equal(afterRun.run.lease_holder, OTHER_HOLDER);
    assert.equal(afterRun.run.lease_fence, 2);
    assert.notEqual(afterRun.run.lease_expires_at, null, 'it keeps the expiry it acquired');
    assert.deepEqual(checkoutSnapshot(w.f.repo.path), w.f.before);
  });
});

describe('no takeover (control)', () => {
  let w: World;
  before(async () => {
    w = await crashPath({ hook: 'none', at: 'checkpoint' });
  });
  after(() => w.close());

  it('reaches ready_for_review: the checkpoint is committed once, the restore runs once, attempt 1 is `discarded` and attempt 2 is handed off', () => {
    assert.ok(w.outcome.ok, JSON.stringify(w.outcome));
    assert.equal(w.outcome.value.state, 'ready_for_review');
    assert.equal(checkpointsOf(w.f, w.runId).filter((m) => m === 'discard-attempt').length, 1);
    assert.equal(w.discardCalls, 1);
    assert.deepEqual(attemptOutcomes(w.f, w.runId), ['discarded', 'handed-off']);
    assert.equal(w.fired, 0);
  });
});
