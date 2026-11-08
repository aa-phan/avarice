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
import { RUN_EXPIRY_WAIT_MS, normalizeRunResult, openRaw, runRunWithFault, sleepSync } from '../helpers/fault-run.ts';
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

// What happens to the run lease inside the supervisor's `discard-attempt` checkpoint call, before the call reaches the ledger:
// `take` another holder acquires it; `take-release` another holder acquires it and releases it; `expire` its expiry is moved into the past and
// nobody acquires it; `none` nothing.
type Hook = 'take' | 'take-release' | 'expire' | 'none';

interface Scenario {
  hook: Hook;
  // Where the hook fires on the supervisor's way to the discard: inside the `discard-attempt` checkpoint call (before it commits), or inside the
  // workspace restore call (after the checkpoint committed, before the restore runs).
  at: 'checkpoint' | 'restore';
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
    if (scenario.hook === 'expire') {
      // The expiry column holds an ISO instant; write an instant before now in the form the row has.
      const db = openRaw(f.roots, false);
      try {
        const stored = (db.prepare('SELECT lease_expires_at AS at FROM runs WHERE run_id = ?').get(runId) as { at: unknown }).at;
        assert.match(String(stored), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the stored expiry is an ISO instant');
        db.prepare('UPDATE runs SET lease_expires_at = ? WHERE run_id = ?').run(new Date(Date.now() - 1000).toISOString(), runId);
      } finally {
        db.close();
      }
    } else {
      const ttl = leaseTtlMs();
      const grant = other.deps.ledger.acquireRunLease(runId, OTHER_HOLDER, ttl, Date.now() + ttl + 1000);
      assert.ok(grant.ok, `the other holder takes the lease: ${JSON.stringify(grant)}`);
      state.grantFence = grant.value.fence;
      if (scenario.hook === 'take-release') {
        const released = other.deps.ledger.releaseRunLease(runId, OTHER_HOLDER, grant.value.fence);
        assert.ok(released.ok, `the other holder releases it: ${JSON.stringify(released)}`);
      }
    }
    const run = runRow(f.roots, runId);
    state.atTakeover = { clone: checkoutSnapshot(run.workspace_path), dump: storeDump(f.roots), run };
  };

  const realLedger = supervisor.deps.ledger;
  supervisor.deps.ledger = new Proxy(realLedger, {
    get(target, prop) {
      if (prop === 'recordRunCheckpoint') {
        return (...args: Parameters<typeof target.recordRunCheckpoint>) => {
          if (scenario.at === 'checkpoint' && args[2].nextAction === 'discard-attempt') takeover();
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
          if (scenario.at === 'restore') takeover();
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

// The resume path: the supervisor was killed after `classify` with the item delegated; a later supervisor's reconcile prelude reaches the discard.
async function resumePath(scenario: Scenario): Promise<World> {
  const f = fixture();
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:classify', { crash: { afterFiles: TWO_FILES } });
  sleepSync(RUN_EXPIRY_WAIT_MS);
  const supervisor = compose(f.roots, FIX);
  const other = compose(f.roots, {});
  const close = (): void => {
    supervisor.close();
    other.close();
  };
  const state = { fired: 0, discardCalls: 0, grantFence: null as number | null, atTakeover: null as Capture | null };
  instrument(f, killed.runId, supervisor, other, scenario, state);
  const outcome = await runSupervisor(supervisor.deps, killed.runId, { prelude: reconcileRun });
  return { f, runId: killed.runId, outcome, ...state, close };
}

const checkpointsOf = (f: Fixture, runId: string): string[] => ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
const attemptOutcomes = (f: Fixture, runId: string): Array<string | null> => ledgerRows<{ outcome: string | null }>(f.roots, 'SELECT outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId).map((a) => a.outcome);

interface AfterRun {
  clone: ReturnType<typeof checkoutSnapshot>;
  dump: StoreDump;
  run: RunDb;
}

// A superseded supervisor is refused at the checkpoint and changes nothing: the same properties on every path that reaches the discard.
// `held` is the fence the supervisor holds, `taken` the fence of the holder that took the lease (or released it).
function refusedSuite(name: string, make: () => Promise<World>, fences: { held: number; taken: number }, options: { released?: boolean } = {}): void {
  describe(name, () => {
    let w: World;
    let afterRun: AfterRun;
    before(async () => {
      w = await make();
      const run = runRow(w.f.roots, w.runId);
      afterRun = { clone: checkoutSnapshot(run.workspace_path), dump: storeDump(w.f.roots), run };
    });
    after(() => w.close());

    it('refuses the supervisor at the checkpoint with a conflict naming both fences', () => {
      assert.equal(w.fired, 1, 'the takeover happened once');
      assert.equal(w.grantFence, fences.taken, 'the other holder holds the next fence');
      assert.deepEqual(conflictOf(w.outcome), { expected: `lease fence ${fences.held}`, actual: `lease fence ${fences.taken}` });
    });

    it('commits no `discard-attempt` checkpoint and never calls the workspace restore', () => {
      assert.equal(checkpointsOf(w.f, w.runId).includes('discard-attempt'), false);
      assert.equal(w.discardCalls, 0);
    });

    it('leaves the clone as it was at the takeover: HEAD, index, the crashed unit\'s edits and its extra file', () => {
      assert.deepEqual(afterRun.clone, (w.atTakeover as Capture).clone);
      const clone = afterRun.run.workspace_path;
      assert.equal(existsSync(join(clone, 'src', 'extra.ts')), true, 'the file the crashed unit created is still there');
      assert.notEqual(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8'), RUN_REPO_FILES['src/slug.ts'], 'the crashed unit\'s partial write is still there');
    });

    it('leaves every table of the store row for row as it was at the takeover', () => {
      assert.deepEqual(afterRun.dump, (w.atTakeover as Capture).dump);
      const failed = ledgerRows<{ step: string }>(w.f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND step = 'resume:reconcile'", w.runId);
      assert.deepEqual(failed, [], 'no failed reconcile record');
    });

    it('leaves the other holder\'s lease row untouched, and the source checkout unchanged', () => {
      assert.deepEqual(leaseOf(afterRun.run), leaseOf((w.atTakeover as Capture).run));
      assert.equal(afterRun.run.lease_fence, fences.taken);
      if (options.released === true) {
        assert.equal(afterRun.run.lease_holder, null, 'the other holder released it');
        assert.equal(afterRun.run.lease_expires_at, null);
      } else {
        assert.equal(afterRun.run.lease_holder, OTHER_HOLDER);
        assert.notEqual(afterRun.run.lease_expires_at, null, 'it keeps the expiry it acquired');
      }
      assert.deepEqual(checkoutSnapshot(w.f.repo.path), w.f.before);
    });
  });
}

refusedSuite('stale fence on the crash path', () => crashPath({ hook: 'take', at: 'checkpoint' }), { held: 1, taken: 2 });
refusedSuite('stale fence on the resume path', () => resumePath({ hook: 'take', at: 'checkpoint' }), { held: 2, taken: 3 });
refusedSuite('taken and released on the crash path (the fence stays bumped)', () => crashPath({ hook: 'take-release', at: 'checkpoint' }), { held: 1, taken: 2 }, { released: true });

describe('expired, not taken (the fence, not the expiry, decides)', () => {
  let w: World;
  before(async () => {
    w = await crashPath({ hook: 'expire', at: 'checkpoint' });
  });
  after(() => w.close());

  it('accepts the checkpoint, discards once and reaches ready_for_review with attempts `discarded`, `handed-off`', () => {
    assert.equal(w.fired, 1, 'the expiry was moved once');
    assert.equal(w.grantFence, null, 'nobody took the lease');
    assert.ok(w.outcome.ok, JSON.stringify(w.outcome));
    assert.equal(w.outcome.value.state, 'ready_for_review');
    assert.equal(checkpointsOf(w.f, w.runId).filter((m) => m === 'discard-attempt').length, 1);
    assert.equal(w.discardCalls, 1);
    assert.deepEqual(attemptOutcomes(w.f, w.runId), ['discarded', 'handed-off']);
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

// What changed between two dumps, table by table: rows added (by rowid) and rows whose columns changed, with the columns named.
interface DumpDiff {
  added: Array<Record<string, unknown>>;
  changed: Array<{ rowid: unknown; columns: string[] }>;
}

function dumpDiff(before: StoreDump, after: StoreDump): Record<string, DumpDiff> {
  const diff: Record<string, DumpDiff> = {};
  for (const table of Object.keys(after)) {
    const was = new Map((before[table] ?? []).map((r) => [(r as Record<string, unknown>)['__rowid'], r as Record<string, unknown>]));
    const entry: DumpDiff = { added: [], changed: [] };
    for (const row of after[table] as Array<Record<string, unknown>>) {
      const prior = was.get(row['__rowid']);
      if (prior === undefined) entry.added.push(row);
      else {
        const columns = Object.keys(row).filter((c) => JSON.stringify(row[c]) !== JSON.stringify(prior[c]));
        if (columns.length > 0) entry.changed.push({ rowid: row['__rowid'], columns });
      }
    }
    assert.ok((before[table] ?? []).length <= (after[table] as unknown[]).length, `${table}: no row was deleted`);
    if (entry.added.length > 0 || entry.changed.length > 0) diff[table] = entry;
  }
  return diff;
}

const itemStates = (f: Fixture, runId: string): string[] => ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM work_items WHERE run_id = ? ORDER BY item_id', runId).map((r) => r.state);

describe('superseded after the checkpoint, then resumed (the window the fence cannot cover)', () => {
  let w: World;
  let afterRun: AfterRun;
  before(async () => {
    w = await crashPath({ hook: 'take', at: 'restore' });
    const run = runRow(w.f.roots, w.runId);
    afterRun = { clone: checkoutSnapshot(run.workspace_path), dump: storeDump(w.f.roots), run };
  });
  after(() => w.close());

  it('commits the checkpoint and restores the clone: the pin bytes are back and the crashed unit\'s extra file is gone', () => {
    assert.equal(w.fired, 1);
    assert.equal(w.discardCalls, 1);
    assert.equal(checkpointsOf(w.f, w.runId).filter((m) => m === 'discard-attempt').length, 1);
    const clone = afterRun.run.workspace_path;
    assert.equal(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8'), RUN_REPO_FILES['src/slug.ts']);
    assert.equal(existsSync(join(clone, 'src', 'extra.ts')), false);
  });

  it('refuses the work item transition on the fence, and leaves the run, the item and the other holder\'s lease as they were', () => {
    const taken = w.atTakeover as Capture;
    assert.deepEqual(conflictOf(w.outcome), { expected: 'lease fence 1', actual: 'lease fence 2' });
    assert.equal(afterRun.run.state, taken.run.state);
    assert.equal(afterRun.run.version, taken.run.version);
    assert.deepEqual(itemStates(w.f, w.runId), ['delegated']);
    assert.deepEqual(leaseOf(afterRun.run), leaseOf(taken.run));
    assert.equal(afterRun.run.lease_holder, OTHER_HOLDER);
  });

  it('writes, after the takeover, only the unfenced rows the documented rule allows: the `discard` step, the attempt\'s end and its event', () => {
    const diff = dumpDiff((w.atTakeover as Capture).dump, afterRun.dump);
    assert.deepEqual(Object.keys(diff).sort(), ['attempts', 'events', 'run_steps']);
    const steps = (diff['run_steps'] as DumpDiff).added;
    assert.equal(steps.length, 1);
    assert.deepEqual([steps[0]?.['step'], steps[0]?.['attempt'], steps[0]?.['status']], ['discard', 1, 'completed']);
    assert.deepEqual((diff['run_steps'] as DumpDiff).changed, []);
    const attempts = diff['attempts'] as DumpDiff;
    assert.deepEqual(attempts.added, []);
    assert.equal(attempts.changed.length, 1);
    assert.deepEqual(attempts.changed[0]?.columns.sort(), ['ended_at', 'outcome']);
    const events = diff['events'] as DumpDiff;
    assert.deepEqual(events.changed, []);
    assert.deepEqual(events.added.map((e) => e['type']), ['attempt.ended']);
    assert.equal((afterRun.dump['attempts'] as Array<Record<string, unknown>>)[0]?.['outcome'], 'discarded');
  });

  it('converges: once the other holder lets go, a resume reaches ready_for_review as an uninterrupted crash-and-retry run does (final discard lists are reported)', async (t) => {
    const resumer = compose(w.f.roots, FIX);
    try {
      const released = resumer.deps.ledger.releaseRunLease(w.runId, OTHER_HOLDER, w.grantFence as number);
      assert.ok(released.ok, JSON.stringify(released));
      const resumed = await runSupervisor(resumer.deps, w.runId, { prelude: reconcileRun });
      assert.ok(resumed.ok, JSON.stringify(resumed));
      assert.equal(resumed.value.state, 'ready_for_review');
      assert.deepEqual(attemptOutcomes(w.f, w.runId), ['discarded', 'handed-off'], 'no third attempt');

      const reference = await crashPath({ hook: 'none', at: 'checkpoint' });
      try {
        assert.ok(reference.outcome.ok, JSON.stringify(reference.outcome));
        assert.deepEqual(normalizeRunResult(w.f.roots, w.runId), normalizeRunResult(reference.f.roots, reference.runId));
      } finally {
        reference.close();
      }

      const discards = ledgerRows<{ attempt: number; result_json: string }>(w.f.roots, "SELECT attempt, result_json FROM run_steps WHERE run_id = ? AND step = 'discard' ORDER BY attempt", w.runId);
      for (const step of discards) {
        const lists = JSON.parse(step.result_json) as { restored: string[]; removed: string[]; ignoredLeft: string[] };
        t.diagnostic(`discard step, attempt ${step.attempt}: restored ${JSON.stringify(lists.restored)}, removed ${JSON.stringify(lists.removed)}, ignoredLeft ${JSON.stringify(lists.ignoredLeft)}`);
      }
    } finally {
      resumer.close();
    }
  });
});
