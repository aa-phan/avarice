// Kill-point suite (SKELETON.md "Kill points"; research "Kill-point catalog for the fault suite"; success
// criterion 4: killing onboarding part-way and running `avarice resume` reaches the same active record).
// For every catalog point: onboard a scratch repository in profile A with the point armed (the child dies by
// SIGKILL, no cleanup runs), check that `status` shows the onboarding as interrupted and never active, resume
// it, and compare the result with an uninterrupted run of the same repository in a second profile. The fake
// host is the only host; no model is called.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { CHUNK_PLAN_FILE } from '../../src/domain/knowledge-extraction.ts';
import { findGraphifyBinary } from '../../src/adapters/graph/graphify.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo, treeDigest } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import {
  EXPIRY_WAIT_MS,
  KILL_POINTS,
  REPO_FILES,
  freshProfile,
  normalizeRecord,
  normalizeText,
  onboardingIdOf,
  openRaw,
  resumeCli,
  rows,
  runToCompletion,
  runWithFault,
  sleepSync,
  statusCli,
  survivorPidFile,
  transitionsOf,
} from '../helpers/fault-run.ts';
import type { KillPoint } from '../helpers/fault-run.ts';

const cleanup: string[] = [];
// Processes the kill cases leave running on purpose (a host that outlived its supervisor, a decoy): ended in `after`.
const survivors: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// A detached process that carries `--session-id {sessionId}` in its command line, as a host would.
function spawnKeepAlive(sessionId: string): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', '--', '--session-id', sessionId], { detached: true, stdio: 'ignore' });
  child.unref();
  assert.ok(child.pid !== undefined);
  return child.pid;
}

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

// The state and the next action `status` must report right after the kill. A transition writes the
// checkpoint of the action that follows it, so `after-checkpoint:validate` and the first
// `after-checkpoint:index:code-graph` fire in the same instant as the transition that produced them.
// `after-checkpoint:index:code-graph#2` is the stage's own checkpoint of the same name, taken before the step runs.
const EXPECTED_AT_KILL: Readonly<Record<KillPoint, { state: string; nextAction: string }>> = {
  'after-transition:discovered': { state: 'discovered', nextAction: 'compile-contract' },
  'after-transition:contract_proposed': { state: 'contract_proposed', nextAction: 'prepare-workspace' },
  'after-checkpoint:prepare-workspace': { state: 'contract_proposed', nextAction: 'prepare-workspace' },
  'after-checkpoint:configure-gsd': { state: 'contract_proposed', nextAction: 'configure-gsd' },
  'after-checkpoint:verify-enforcement': { state: 'contract_proposed', nextAction: 'verify-enforcement' },
  'after-transition:mapping': { state: 'mapping', nextAction: 'launch:map' },
  'mid-invocation': { state: 'mapping', nextAction: 'launch:map' },
  'after-transition:validating': { state: 'validating', nextAction: 'validate' },
  'after-checkpoint:validate': { state: 'validating', nextAction: 'validate' },
  'after-transition:planning_ready': { state: 'planning_ready', nextAction: 'index:code-graph' },
  'after-checkpoint:index:code-graph': { state: 'planning_ready', nextAction: 'index:code-graph' },
  'after-checkpoint:index:code-graph#2': { state: 'planning_ready', nextAction: 'index:code-graph' },
  'after-checkpoint:index:intel': { state: 'planning_ready', nextAction: 'index:intel' },
  'mid-invocation:intel': { state: 'planning_ready', nextAction: 'index:intel' },
  'after-checkpoint:index:knowledge': { state: 'planning_ready', nextAction: 'index:knowledge' },
  'mid-invocation:knowledge': { state: 'planning_ready', nextAction: 'index:knowledge' },
  'after-checkpoint:activate': { state: 'planning_ready', nextAction: 'activate' },
};

interface StatusEntry {
  state: string;
  recordVersion: number | null;
  interrupted?: { state: string; nextAction: string; resumeCommand: string };
}

// GSD's graph snapshot carries the time it was written, so the staging tree is compared without it and the snapshot
// is compared on its own without that field.
const VOLATILE_STAGING_FILE = '.planning/graphs/.last-build-snapshot.json';

// The knowledge chunk plan holds the absolute readPath and writePath of the run (plan 01-25), so its text differs between profiles by
// design. The staging tree is compared without it, and the plan is compared on its own with the ULIDs and the temp root normalized.
// WR-03: a missing or unparseable plan throws, and a plan that is not an object fails here, so the equality assertions never compare
// null with null (every outcome is read from a finished onboarding, which wrote the plan).
function chunkPlanNormalized(staging: string): unknown {
  const plan = JSON.parse(normalizeText(readFileSync(join(staging, CHUNK_PLAN_FILE), 'utf8'))) as unknown;
  assert.ok(typeof plan === 'object' && plan !== null, 'the knowledge chunk plan is a JSON object');
  return plan;
}

function snapshotWithoutTimestamp(staging: string): unknown {
  try {
    const { timestamp, ...rest } = JSON.parse(readFileSync(join(staging, VOLATILE_STAGING_FILE), 'utf8')) as Record<string, unknown>;
    void timestamp;
    return rest;
  } catch {
    return null;
  }
}

interface Outcome {
  record: unknown;
  rawRecord: { artifacts: { snapshot: string; codebase: Array<{ digest: string }>; stagingPath: string } };
  manifest: unknown;
  codebaseDigests: string[];
  stagingDigest: string;
  chunkPlan: unknown;
  graphSnapshot: unknown;
  recordCount: number;
}

function outcomeOf(roots: CliRoots): Outcome {
  const records = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version');
  assert.equal(records.length, 1, 'exactly one project record version');
  const body = JSON.parse((records[0] as { body_json: string }).body_json) as Outcome['rawRecord'];
  const store = new LocalArtifactStore(roots.AVARICE_DATA_ROOT);
  const manifestBytes = store.get(body.artifacts.snapshot);
  assert.ok(manifestBytes.ok, 'the snapshot manifest is in the artifact store');
  const codebaseDigests = rows<{ digest: string }>(roots, "SELECT digest FROM artifacts WHERE kind = 'map-document' ORDER BY digest").map((r) => r.digest);
  return {
    record: normalizeRecord(body),
    rawRecord: body,
    manifest: JSON.parse(normalizeText(Buffer.from(manifestBytes.value).toString('utf8'))),
    codebaseDigests,
    stagingDigest: treeDigest(body.artifacts.stagingPath, (rel) => rel === VOLATILE_STAGING_FILE || rel === CHUNK_PLAN_FILE),
    chunkPlan: chunkPlanNormalized(body.artifacts.stagingPath),
    graphSnapshot: snapshotWithoutTimestamp(body.artifacts.stagingPath),
    recordCount: records.length,
  };
}

let repo: ScratchRepo;
let pristine: ReturnType<typeof checkoutSnapshot>;
let reference: Outcome;

before(() => {
  repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(repo.base);
  pristine = checkoutSnapshot(repo.path);
  const roots = freshProfile();
  cleanup.push(roots.base);
  const run = runToCompletion(roots, repo);
  assert.equal(run.code, 0, run.stdout + run.stderr);
  reference = outcomeOf(roots);
});

describe('the uninterrupted reference run', () => {
  it('is reproducible: a second profile onboarding the same repository gives an equal normalized record', () => {
    const roots = freshProfile();
    cleanup.push(roots.base);
    const run = runToCompletion(roots, repo);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    const second = outcomeOf(roots);
    assert.deepEqual(second.record, reference.record);
    assert.deepEqual(second.manifest, reference.manifest);
    assert.deepEqual(second.codebaseDigests, reference.codebaseDigests);
    assert.equal(second.stagingDigest, reference.stagingDigest);
    assert.deepEqual(second.chunkPlan, reference.chunkPlan);
    assert.deepEqual(second.graphSnapshot, reference.graphSnapshot);
    assert.notEqual(second.rawRecord.artifacts.stagingPath, reference.rawRecord.artifacts.stagingPath, 'the profiles are separate, so the raw records differ before normalization');
  });

  it('leaves the user checkout as it found it', () => {
    assert.deepEqual(checkoutSnapshot(repo.path), pristine);
  });

  it('has 7 codebase map documents and a manifest naming them', () => {
    assert.equal(reference.rawRecord.artifacts.codebase.length, 7);
    assert.equal(reference.codebaseDigests.length, 7);
  });
});

describe('kill, then resume, reaches the record of an uninterrupted run', () => {
  // The purpose whose invocation the supervisor dies in, for the points that leave a surviving host.
  const purposeOf = (point: KillPoint): 'intel' | 'knowledge' | undefined => (point === 'mid-invocation:intel' ? 'intel' : point === 'mid-invocation:knowledge' ? 'knowledge' : undefined);
  for (const point of KILL_POINTS) {
    // The knowledge invocation runs only when the code graph step left a graph, which needs graphify.
    const skip = point === 'mid-invocation:knowledge' && findGraphifyBinary(process.env) === undefined ? 'graphify not installed: the knowledge invocation needs a code graph' : false;
    it(point, { skip }, () => {
      const roots = freshProfile();
      cleanup.push(roots.base);
      const killed = runWithFault(roots, repo, point);
      assert.equal(killed.signal, 'SIGKILL');
      const id = onboardingIdOf(roots);

      // Crash consistency: the store opens, is intact, and holds no activated record.
      const db = openRaw(roots);
      try {
        assert.deepEqual({ ...(db.prepare('PRAGMA integrity_check').get() as object) }, { integrity_check: 'ok' });
        assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
      } finally {
        db.close();
      }
      assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0, 'no activated record after the kill');
      if (point === 'mid-invocation') {
        const staged = readdirSync(join(rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings')[0]?.staging_worktree as string, '.planning', 'codebase'));
        assert.equal(staged.length, 3, 'the invocation was killed after writing three of the seven map files');
        const launch = rows<{ status: string }>(roots, "SELECT status FROM onboarding_steps WHERE step = 'launch:map'");
        assert.deepEqual(launch, [{ status: 'started' }], 'the killed invocation is visible as a started launch');
      }

      // A kill inside the intel or knowledge invocation leaves its host running, carrying the session ID in its command line.
      const purpose = purposeOf(point);
      let survivor: number | undefined;
      let decoy: number | undefined;
      if (purpose !== undefined) {
        survivor = Number(readFileSync(survivorPidFile(roots), 'utf8').trim());
        assert.ok(Number.isInteger(survivor) && survivor > 1, 'the fake host recorded the survivor PID');
        survivors.push(survivor);
        assert.ok(isAlive(survivor), 'the host that carries the session ID outlived its supervisor');
        const started = rows<{ status: string }>(roots, 'SELECT status FROM onboarding_steps WHERE step = ?', `launch:${purpose}`);
        assert.deepEqual(started, [{ status: 'started' }], `the killed ${purpose} invocation is visible as a started launch`);
      }
      if (point === 'mid-invocation:intel') {
        // A process that carries another session ID must not be touched by the reap.
        decoy = spawnKeepAlive(randomUUID());
        survivors.push(decoy);
        sleepSync(500);
        assert.ok(isAlive(decoy));
      }

      // status: interrupted in its last state with the exact command, never active.
      sleepSync(EXPIRY_WAIT_MS);
      const text = statusCli(roots);
      assert.equal(text.code, 0, text.stderr);
      assert.ok(text.stdout.includes(`avarice resume ${id}`), text.stdout);
      assert.ok(text.stdout.includes(`${EXPECTED_AT_KILL[point].state} (interrupted)`), text.stdout);
      assert.ok(text.stdout.includes(EXPECTED_AT_KILL[point].nextAction), text.stdout);
      assert.ok(!/: active/.test(text.stdout), `an interrupted onboarding is never shown as active:\n${text.stdout}`);
      const [entry] = JSON.parse(statusCli(roots, '--json').stdout) as StatusEntry[];
      assert.ok(entry);
      assert.equal(entry.recordVersion, null);
      assert.deepEqual(entry.interrupted, { ...EXPECTED_AT_KILL[point], resumeCommand: `avarice resume ${id}` });
      assert.equal(entry.state, EXPECTED_AT_KILL[point].state);

      // resume reaches active.
      const resumed = resumeCli(roots, id);
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      assert.match(resumed.stdout, new RegExp(`onboarding ${id}: active`));
      const [after] = JSON.parse(statusCli(roots, '--json').stdout) as StatusEntry[];
      assert.equal(after?.state, 'active');
      assert.equal(after?.interrupted, undefined);

      // The record, the map documents, the snapshot manifest, the staging tree and the user checkout equal an uninterrupted run.
      const outcome = outcomeOf(roots);
      assert.deepEqual(outcome.record, reference.record, 'normalized project record body');
      assert.deepEqual(outcome.codebaseDigests, reference.codebaseDigests, 'map document digests');
      assert.deepEqual(outcome.manifest, reference.manifest, 'snapshot manifest');
      assert.equal(outcome.stagingDigest, reference.stagingDigest, 'staging tree');
      assert.deepEqual(outcome.chunkPlan, reference.chunkPlan, 'the knowledge chunk plan, normalized');
      assert.deepEqual(outcome.graphSnapshot, reference.graphSnapshot, 'the GSD graph snapshot, without its timestamp');
      assert.deepEqual(checkoutSnapshot(repo.path), pristine, 'the user checkout is byte-identical');

      // The survivor was ended by its session ID (and only it), once, and its launch is marked interrupted.
      if (purpose !== undefined && survivor !== undefined) {
        assert.equal(isAlive(survivor), false, 'the resume ended the host that carried the interrupted session ID');
        const reaped = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'invocation.reaped'");
        assert.equal(reaped.length, 1, 'exactly one invocation.reaped event');
        assert.equal((JSON.parse((reaped[0] as { data_json: string }).data_json) as { terminated: number }).terminated, 1);
        const launched = rows<{ attempt: number; status: string }>(roots, 'SELECT attempt, status FROM onboarding_steps WHERE step = ? ORDER BY attempt', `launch:${purpose}`);
        assert.deepEqual(launched, [
          { attempt: 1, status: 'interrupted' },
          { attempt: 2, status: 'failed' },
        ]);
      }
      if (decoy !== undefined) assert.ok(isAlive(decoy), 'a process that carries another session ID is alive after the resume');
      assert.deepEqual(
        rows<{ step: string }>(roots, "SELECT step FROM onboarding_steps WHERE step LIKE 'launch:%' AND status = 'started'"),
        [],
        'no launch of any purpose is left in flight',
      );

      // Every launch is recorded, and none is left in flight.
      const launches = rows<{ attempt: number; status: string }>(roots, "SELECT attempt, status FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt");
      assert.ok(launches.length >= 1, 'a launch row exists per invocation');
      assert.ok(launches.every((l) => l.status !== 'started'), `no launch left in flight: ${JSON.stringify(launches)}`);
      if (point === 'mid-invocation') {
        assert.deepEqual(launches, [
          { attempt: 1, status: 'interrupted' },
          { attempt: 2, status: 'completed' },
        ]);
      } else {
        assert.equal(launches.filter((l) => l.status === 'completed').length, 1, 'one completed invocation');
      }

      // The lifecycle ends active exactly once.
      const transitions = transitionsOf(roots);
      assert.equal(transitions.filter((t) => t.to === 'active').length, 1);
      assert.equal(transitions.at(-1)?.to, 'active');
    });
  }
});

describe('index steps resume from their stored results (plan 01-14)', () => {
  it('the counted point #2 is the stage checkpoint, a second row after the transition checkpoint that the plain point stops at', () => {
    const checkpointsOf = (point: 'after-checkpoint:index:code-graph' | 'after-checkpoint:index:code-graph#2'): number => {
      const roots = freshProfile();
      cleanup.push(roots.base);
      runWithFault(roots, repo, point);
      return rows<{ n: number }>(roots, "SELECT count(*) AS n FROM checkpoints WHERE next_action = 'index:code-graph'")[0]?.n ?? -1;
    };
    assert.equal(checkpointsOf('after-checkpoint:index:code-graph'), 1, 'killed in the same instant as the transition');
    assert.equal(checkpointsOf('after-checkpoint:index:code-graph#2'), 2, 'killed after the stage committed its own checkpoint, before the step ran');
  });

  it('killed after the checkpoint of index:knowledge, resume skips the two steps that have a stored result and runs the last', () => {
    const roots = freshProfile();
    cleanup.push(roots.base);
    runWithFault(roots, repo, 'after-checkpoint:index:knowledge');
    const id = onboardingIdOf(roots);

    const stored = rows<{ step: string; status: string }>(roots, "SELECT step, status FROM onboarding_steps WHERE step LIKE 'index:%' ORDER BY rowid");
    assert.deepEqual(stored, [
      { step: 'index:code-graph', status: 'completed' },
      { step: 'index:intel', status: 'completed' },
    ]);
    const absentBefore = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'index.absent' ORDER BY seq").map((e) => (JSON.parse(e.data_json) as { index: string }).index);
    assert.ok(absentBefore.includes('intel'), 'the intel step ran once before the kill');

    sleepSync(EXPIRY_WAIT_MS);
    const resumed = resumeCli(roots, id);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);

    const after = rows<{ step: string; status: string }>(roots, "SELECT step, status FROM onboarding_steps WHERE step LIKE 'index:%' ORDER BY rowid");
    assert.deepEqual(after.map((s) => s.step), ['index:code-graph', 'index:intel', 'index:knowledge']);
    const absentAfter = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'index.absent' ORDER BY seq").map((e) => (JSON.parse(e.data_json) as { index: string }).index);
    assert.equal(absentAfter.filter((i) => i === 'intel').length, 1, 'the intel step did not run again');
    assert.equal(absentAfter.filter((i) => i === 'knowledge').length, 1, 'the knowledge step ran once, after the resume');
    assert.equal(absentAfter.filter((i) => i === 'code-graph').length, absentBefore.filter((i) => i === 'code-graph').length, 'the code-graph step did not run again');
  });
});
