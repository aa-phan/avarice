// The portability proof (plan 04-33; NFR-4, AC-7, SC5; docs/operations-and-testing.md "Portability proof"). The domain code is claimed to depend only on ports.
// This suite runs the same workflows twice from the same source tree: once with the local adapters and once with fake-remote adapters for CommandExecutor and
// ArtifactStore that serialize every call through JSON, add latency, drop 5% of responses and duplicate 2% from a seeded random source. Only configuration
// differs: the test CLI (test/helpers/test-cli.ts) hands both fakes to main() through the DepsOverrides seam when AVARICE_TEST_REMOTE=1. A failure reproduces from
// its seed (AVARICE_TEST_REMOTE_SEED). No test calls a real model.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import { FakeRemoteArtifactStore } from '../helpers/fake-remote-artifact-store.ts';
import { FakeRemoteExecutor } from '../helpers/fake-remote-executor.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import {
  RUN_EXPIRY_WAIT_MS,
  REPO_FILES,
  TEST_CLI,
  normalizeRecord,
  normalizeText,
  resumeRunCli,
  runHostEnv,
  runIdFromOutput,
  runRunWithFault,
  sleepSync,
  startRunArgs,
} from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { SeededFaults } from '../helpers/seeded-faults.ts';
import type { FaultCounts, FaultEvent } from '../helpers/seeded-faults.ts';
import { git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// Seed 3 is the first seed that, for the onboarding of this fixture (11 commands and a handful of artifact calls), both drops and duplicates a response at least
// once. Seed 42 drops three and duplicates none there; it carries the longer workflows below, which make many more calls.
const TRACER_SEED = 3;

interface Remote {
  seed: number;
}

// The directory that plays the remote store: the test CLI puts it beside the profile's data root.
const remoteRootOf = (roots: CliRoots): string => `${roots.AVARICE_DATA_ROOT}-remote`;

function remoteEnv(roots: CliRoots, remote: Remote | undefined): Record<string, string | undefined> {
  if (remote === undefined) return {};
  return { AVARICE_TEST_REMOTE: '1', AVARICE_TEST_REMOTE_SEED: String(remote.seed), AVARICE_TEST_REMOTE_LOG: join(roots.base, `remote-${remote.seed}.log`) };
}

// Every drop, duplicate and run of the real executor the fakes of the processes of one profile logged.
function faultEvents(roots: CliRoots): FaultEvent[] {
  const events: FaultEvent[] = [];
  for (const name of existsSync(roots.base) ? readdirSync(roots.base) : []) {
    if (!/^remote-\d+\.log$/.test(name)) continue;
    for (const line of readFileSync(join(roots.base, name), 'utf8').split('\n')) if (line !== '') events.push(JSON.parse(line) as FaultEvent);
  }
  return events;
}

// T-04-90: a call whose response was dropped is answered by key and never run a second time, so each call of the client is one run of the real executor and no
// more. The call, not the invocation key, is the unit: the GSD adapter names every `graphify status` `gsd:graphify`, so a key can repeat across two separate
// requests that each rightly ran.
function assertEachCallRanOnce(events: readonly FaultEvent[], label: string): void {
  const ran = new Map<string, number>();
  for (const event of events) if (event.kind === 'inner-call') ran.set(event.call, (ran.get(event.call) ?? 0) + 1);
  assert.ok(ran.size > 0, `${label}: the real executor ran commands behind the fake`);
  for (const [call, times] of ran) assert.equal(times, 1, `${label}: call ${call} ran ${times} times`);
  for (const event of events) if (event.kind === 'drop' && event.port === 'executor') assert.equal(ran.get(event.call), 1, `${label}: the call ${event.call} whose response was dropped ran once`);
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

// ---- onboarding to active through the CLI -----------------------------------------------------------------------------------------------------

interface RecordBody {
  artifacts: { snapshot: string; codebase: Array<{ digest: string; path: string }> };
  indexes: unknown;
}

interface OnboardingOutcome {
  roots: CliRoots;
  cli: CliResult;
  // The project record as the ledger holds it, ids and times normalized: its `indexes` and the digests of its map documents are part of it.
  record: unknown;
  indexes: unknown;
  mapDigests: string[];
  // The snapshot manifest read back through the store that holds it, ids normalized; null when that store does not hold it.
  manifest: unknown;
  events: FaultEvent[];
}

function onboardOutcome(repo: ScratchRepo, remote: Remote | undefined): OnboardingOutcome {
  const roots = makeRoots();
  cleanup.push(roots.base, remoteRootOf(roots));
  const cli = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}', ...remoteEnv(roots, remote) }, timeoutMs: 300_000 });
  const records = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version');
  assert.equal(records.length, 1, `exactly one project record version after ${cli.stdout}${cli.stderr}`);
  const body = JSON.parse((records[0] as { body_json: string }).body_json) as RecordBody;
  // The snapshot manifest lives in whichever store the run was configured with.
  const store = new LocalArtifactStore(remote === undefined ? roots.AVARICE_DATA_ROOT : remoteRootOf(roots));
  const manifest = store.get(body.artifacts.snapshot);
  return {
    roots,
    cli,
    record: normalizeRecord(body),
    indexes: body.indexes,
    mapDigests: body.artifacts.codebase.map((doc) => `${doc.path} ${doc.digest}`),
    manifest: manifest.ok ? JSON.parse(normalizeText(Buffer.from(manifest.value).toString('utf8'))) : null,
    events: faultEvents(roots),
  };
}

function countOf(outcome: OnboardingOutcome): FaultCounts {
  const counts: FaultCounts = { drop: 0, duplicate: 0, innerCall: 0 };
  for (const event of outcome.events) {
    if (event.kind === 'drop') counts.drop += 1;
    else if (event.kind === 'duplicate') counts.duplicate += 1;
    else counts.innerCall += 1;
  }
  return counts;
}

describe('tracer: one onboarding to active runs through the fake-remote executor and artifact store with the same result as local (NFR-4, AC-7)', () => {
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(repo.base);
  const local = onboardOutcome(repo, undefined);
  const remote = onboardOutcome(repo, { seed: TRACER_SEED });

  it('both onboardings reach active', () => {
    for (const outcome of [local, remote]) {
      assert.equal(outcome.cli.code, 0, outcome.cli.stdout + outcome.cli.stderr);
      assert.match(outcome.cli.stdout, /onboarding onb_[0-9A-Z]{26}: active/);
    }
  });

  it('the record, its indexes, its map digests and its snapshot manifest equal those of the local run', () => {
    assert.deepEqual(remote.indexes, local.indexes);
    assert.deepEqual(remote.mapDigests, local.mapDigests);
    assert.ok(remote.mapDigests.length > 0, 'the map documents are recorded');
    assert.notEqual(remote.manifest, null, 'the snapshot manifest is in the configured artifact store');
    assert.deepEqual(remote.manifest, local.manifest);
    assert.deepEqual(remote.record, local.record);
  });

  it('the configuration took effect: the remote run recorded the fake adapters and wrote no blob into the profile\'s own artifact directory', () => {
    const adapters = rows<{ name: string; adapter: string }>(remote.roots, "SELECT name, adapter FROM adapter_configs WHERE name IN ('executor', 'artifacts') ORDER BY name");
    assert.deepEqual(adapters.map((a) => [a.name, a.adapter]), [['artifacts', 'fake-remote'], ['executor', 'fake-remote-executor']]);
    assert.equal(existsSync(join(remote.roots.AVARICE_DATA_ROOT, 'artifacts')), false, 'no blob reached the local store');
    assert.equal(existsSync(join(remoteRootOf(remote.roots), 'artifacts')), true, 'the blobs are in the remote store');
    const localAdapters = rows<{ name: string; adapter: string }>(local.roots, "SELECT name, adapter FROM adapter_configs WHERE name IN ('executor', 'artifacts') ORDER BY name");
    assert.deepEqual(localAdapters.map((a) => [a.name, a.adapter]), [['artifacts', 'local-fs'], ['executor', 'local-sandbox-exec']]);
  });

  it(`seed ${TRACER_SEED} dropped at least one response and duplicated at least one, and no command ran twice`, () => {
    const counts = countOf(remote);
    assert.ok(counts.drop >= 1, `drops ${counts.drop}`);
    assert.ok(counts.duplicate >= 1, `duplicates ${counts.duplicate}`);
    assert.ok(counts.innerCall >= 1, 'the real executor ran commands behind the fake');
    assertEachCallRanOnce(remote.events, `seed ${TRACER_SEED}`);
    assert.equal(countOf(local).innerCall, 0, 'the local run has no fake and logs nothing');
  });
});

// ---- the workflow suite twice (AC-7, SC5) -------------------------------------------------------------------------------------------------------

// The two seeds of the remote runs: the tracer's and 14, the next seed that gives an onboarding of this fixture a drop and a duplicate. A process draws from the start of
// its seed's sequence, so a short process sees few faults and a seed has to be chosen that shows both across the three scenarios; seed 42 shows no duplicate in them.
// A failure of a run names its seed.
const WORKFLOW_SEEDS = [TRACER_SEED, 14] as const;

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const TWO_FILES = ['src/slug.ts', 'src/extra.ts'] as const;

// An onboarded repository with committed conventions and a brief, set up through the CLI. With `remote` the onboarding itself goes through the fakes too.
interface RunFixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  remote: Remote | undefined;
}

function runFixture(remote: Remote | undefined): RunFixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, remoteRootOf(roots), repo.base);
  const onboarded = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}', ...remoteEnv(roots, remote) }, timeoutMs: 300_000 });
  assert.equal(onboarded.code, 0, onboarded.stdout + onboarded.stderr);
  assert.match(onboarded.stdout, /onboarding onb_[0-9A-Z]{26}: active/);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), remote };
}

// What a finished workflow left behind that must not depend on the adapters: the run and its items, every attempt, every piece of evidence, every gate, and the
// tree of the commit that was handed to the source repository.
interface EndState {
  run: { state: string; reason: string | null };
  items: Array<[string, number]>;
  attempts: Array<[number, string, string | null]>;
  evidence: Array<[string, string, string]>;
  gates: Array<[string, number]>;
  tree: string;
}

function endState(f: RunFixture, runId: string): EndState {
  const run = rows<{ state: string; reason: string | null }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0];
  assert.ok(run, 'the run is in the ledger');
  return {
    run: { state: run.state, reason: run.reason },
    items: rows<{ state: string; attempts: number }>(f.roots, 'SELECT state, attempts FROM work_items WHERE run_id = ? ORDER BY item_id', runId).map((r) => [r.state, r.attempts]),
    attempts: rows<{ ordinal: number; reason: string; outcome: string | null }>(f.roots, 'SELECT ordinal, reason, outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId).map((r) => [r.ordinal, r.reason, r.outcome]),
    evidence: rows<{ kind: string; name: string; status: string }>(
      f.roots,
      'SELECT e.kind, e.name, e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.kind, e.name, e.status',
      runId,
    ).map((r) => [r.kind, r.name, r.status]),
    gates: rows<{ gate: string; passed: number }>(f.roots, 'SELECT gate, passed FROM gate_results WHERE run_id = ? ORDER BY gate, rowid', runId).map((r) => [r.gate, r.passed]),
    tree: git(f.repo.path, ['rev-parse', `refs/heads/avarice/${runId}^{tree}`]).trim(),
  };
}

interface Finished {
  runId: string;
  cli: CliResult;
  end: EndState;
  events: FaultEvent[];
}

function startEnv(f: RunFixture, host: FakeRunOptions, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...runHostEnv(host), ...remoteEnv(f.roots, f.remote), ...extra };
}

// A run started with `--wait` and left to finish.
function runToReady(f: RunFixture, host: FakeRunOptions): Finished {
  const cli = runCli(startRunArgs(f.brief), { roots: f.roots, cwd: f.repo.path, entry: TEST_CLI, env: startEnv(f, host), timeoutMs: 300_000 });
  const runId = runIdFromOutput(cli.stdout);
  return { runId, cli, end: endState(f, runId), events: faultEvents(f.roots) };
}

// A run whose supervisor is killed after the verification checkpoint, then resumed by a fresh process.
function killAndResume(f: RunFixture, host: FakeRunOptions): Finished {
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:verify:checks', host, remoteEnv(f.roots, f.remote));
  sleepSync(RUN_EXPIRY_WAIT_MS);
  const cli = resumeRunCli(f.roots, killed.runId, host, remoteEnv(f.roots, f.remote));
  return { runId: killed.runId, cli, end: endState(f, killed.runId), events: faultEvents(f.roots) };
}

const lastLine = (stdout: string): string => stdout.trim().split('\n').at(-1) as string;

interface Scenario {
  name: string;
  run(f: RunFixture): Finished;
  // What the finished run must show, on the local run and therefore on every remote one.
  check(local: Finished): void;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a run to ready_for_review',
    run: (f) => runToReady(f, FIX),
    check(local) {
      assert.equal(local.end.run.state, 'ready_for_review');
      assert.deepEqual(local.end.attempts, [[1, 'initial', 'handed-off']]);
    },
  },
  {
    name: 'a discard and retry (CON-16): a crashed unit is discarded to its snapshot and retried once',
    run: (f) => runToReady(f, { perAttempt: [{ crash: { afterFiles: TWO_FILES } }, FIX] }),
    check(local) {
      assert.equal(local.end.run.state, 'ready_for_review');
      assert.deepEqual(local.end.attempts, [
        [1, 'initial', 'discarded'],
        [2, 'con16-retry', 'handed-off'],
      ]);
    },
  },
  {
    name: 'a kill and resume (FR-7): a supervisor killed during verification, resumed by a fresh process',
    run: (f) => killAndResume(f, FIX),
    check(local) {
      assert.equal(local.end.run.state, 'ready_for_review');
      assert.equal(lastLine(local.cli.stdout), `run ${local.runId}: ready_for_review`);
    },
  },
];

// Every remote finish of every scenario, by seed, for the check that the faults were really exercised.
const remoteFinishes = new Map<number, Finished[]>();

for (const scenario of SCENARIOS) {
  describe(`the workflow suite twice: ${scenario.name} (AC-7, SC5)`, () => {
    const local = scenario.run(runFixture(undefined));
    const remotes = WORKFLOW_SEEDS.map((seed) => {
      const finished = scenario.run(runFixture({ seed }));
      remoteFinishes.set(seed, [...(remoteFinishes.get(seed) ?? []), finished]);
      return { seed, finished };
    });

    it('the local run ends as the scenario says', () => {
      assert.equal(local.cli.code, 0, local.cli.stdout + local.cli.stderr);
      scenario.check(local);
    });

    for (const { seed, finished } of remotes) {
      it(`with fake-remote adapters (seed ${seed}) the run ends in the same state: run, items, attempts, evidence, gates and the handed-off commit tree`, () => {
        assert.equal(finished.cli.code, 0, `seed ${seed}: ${finished.cli.stdout}${finished.cli.stderr}`);
        assert.deepEqual(finished.end, local.end, `seed ${seed}`);
      });

      it(`no command ran twice under seed ${seed}: each call of the client is one run in the inner executor call log (T-04-90)`, () => {
        assertEachCallRanOnce(finished.events, `seed ${seed}`);
      });
    }
  });
}

describe('the faults were really exercised, and only on the remote runs (NFR-4)', () => {
  for (const seed of WORKFLOW_SEEDS) {
    it(`seed ${seed} dropped at least one response and duplicated at least one across the workflows`, () => {
      const finishes = remoteFinishes.get(seed) ?? [];
      assert.equal(finishes.length, SCENARIOS.length);
      // The log of one profile only grows, so each finish holds its own profile's events; the scenarios' profiles are separate.
      const counts = finishes.map((finish) => {
        let drop = 0;
        let duplicate = 0;
        for (const event of finish.events) {
          if (event.kind === 'drop') drop += 1;
          else if (event.kind === 'duplicate') duplicate += 1;
        }
        return { drop, duplicate };
      });
      const drops = counts.reduce((sum, c) => sum + c.drop, 0);
      const duplicates = counts.reduce((sum, c) => sum + c.duplicate, 0);
      assert.ok(drops >= 1, `seed ${seed}: drops ${drops}`);
      assert.ok(duplicates >= 1, `seed ${seed}: duplicates ${duplicates}`);
    });
  }
});

// ---- onboarding to active with indexes, in this process ------------------------------------------------------------------------------------------

// The intel index files carry the time they were written (`updated_at`), so their digest differs between two onboardings of one repository whatever the adapters.
// The digest is masked wherever the record holds it; everything else of the record, the graph digest included, is compared as it is.
function maskIntelDigest<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as { intel?: { digest?: string }; indexes?: { intel?: { digest?: string } } };
  if (copy.intel?.digest !== undefined) copy.intel.digest = '<intel-digest>';
  if (copy.indexes?.intel?.digest !== undefined) copy.indexes.intel.digest = '<intel-digest>';
  return copy as T;
}

// The onboarding the run fixtures use, with an intel index and a code graph (the fake intel host and the fake graphify), driven in this process so the fakes are
// handed over directly: the same objects the test CLI would build, over the same real onboarding stages and the real sandboxed GSD verbs.
async function onboardWithIndexes(repo: ScratchRepo, remote: Remote | undefined): Promise<{ record: unknown; indexes: unknown; manifest: unknown; events: FaultEvent[] }> {
  const roots = makeRoots();
  cleanup.push(roots.base, remoteRootOf(roots));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(mkdtempSync(join(tmpdir(), 'avarice-fake-graphify-')), 'ok'),
    AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
  };
  const executor = remote === undefined ? undefined : new FakeRemoteExecutor(new SandboxedExecutor(), new SeededFaults(remote.seed));
  const artifacts = remote === undefined ? undefined : new FakeRemoteArtifactStore(remoteRootOf(roots), new SeededFaults(remote.seed ^ 0x9e3779b9, { minLatencyMs: 1, maxLatencyMs: 5 }));
  const composed = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}), ...(executor === undefined || artifacts === undefined ? {} : { executor, artifacts }) });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok && outcome.value.state === 'active', `the repository is onboarded: ${JSON.stringify(outcome)}`);
  } finally {
    composed.value.close();
  }
  const body = JSON.parse((rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version')[0] as { body_json: string }).body_json) as RecordBody;
  const store = new LocalArtifactStore(remote === undefined ? roots.AVARICE_DATA_ROOT : remoteRootOf(roots));
  const manifest = store.get(body.artifacts.snapshot);
  assert.ok(manifest.ok, 'the snapshot manifest is in the configured artifact store');
  return {
    record: maskIntelDigest(normalizeRecord(body)),
    indexes: maskIntelDigest(body.indexes),
    manifest: JSON.parse(normalizeText(Buffer.from(manifest.value).toString('utf8'))),
    events: [...(executor?.faults.events ?? []), ...(artifacts?.faults.events ?? [])],
  };
}

describe('the workflow suite twice: an onboarding to active with indexes (AC-7, SC5)', () => {
  type Indexed = Awaited<ReturnType<typeof onboardWithIndexes>>;
  let local: Indexed;
  const remoteRuns = new Map<number, Indexed>();
  // One after another: each onboarding blocks this process's event loop in the fake store's latency, so running them together would only interleave them.
  // Every onboarding reads the same repository: the record holds the commit it was built at, so two repositories would differ by their commit ids alone.
  before(async () => {
    const repo = makeRunRepo();
    cleanup.push(repo.base);
    local = await onboardWithIndexes(repo, undefined);
    for (const seed of WORKFLOW_SEEDS) remoteRuns.set(seed, await onboardWithIndexes(repo, { seed }));
  });

  it('the local onboarding built the intel index and the code graph', () => {
    const indexes = local.indexes as { graph?: unknown; intel?: unknown };
    assert.ok(indexes.graph !== undefined, 'a code graph is recorded');
    assert.ok(indexes.intel !== undefined, 'an intel index is recorded');
  });

  for (const seed of WORKFLOW_SEEDS) {
    it(`with fake-remote adapters (seed ${seed}) the record, its indexes and its snapshot manifest equal the local ones`, () => {
      const remote = remoteRuns.get(seed) as Indexed;
      assert.deepEqual(remote.indexes, local.indexes, `seed ${seed}`);
      assert.deepEqual(remote.manifest, local.manifest, `seed ${seed}`);
      assert.deepEqual(remote.record, local.record, `seed ${seed}`);
      assertEachCallRanOnce(remote.events, `seed ${seed}`);
    });
  }
});

// ---- the swap is configuration: 0 lines of src (AC-7) and no way into production (T-04-91) ------------------------------------------------------

// The commit this plan started from. The measurement covers the commits of this plan (their subjects name `(04-33)`), not everything after the base: the plans
// that follow change src legitimately.
const PLAN_BASE = 'b1209b34a7f5747c29c81d506626877c3730a3cd';

function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

describe('AC-7: the swap is configuration, not a change to the source (T-04-91)', () => {
  const inHistory = spawnSync('git', ['merge-base', '--is-ancestor', PLAN_BASE, 'HEAD'], { cwd: REPO_ROOT }).status === 0;

  it('the commits of this plan change 0 lines under src/', { skip: inHistory ? false : `the plan base ${PLAN_BASE} is not in this checkout's history` }, () => {
    const planCommits = git(REPO_ROOT, ['log', '--format=%h %s', '-E', '--grep=^[a-z]+\\(04-33\\):', `${PLAN_BASE}..HEAD`]).trim().split('\n').filter((line) => line !== '');
    assert.ok(planCommits.length >= 3, `the plan's commits are found by their subject (${planCommits.length})`);
    const touched = git(REPO_ROOT, ['log', '--name-only', '--format=', '-E', '--grep=^[a-z]+\\(04-33\\):', `${PLAN_BASE}..HEAD`, '--', 'src']).trim();
    assert.equal(touched, '', 'git log --name-only over the plan commits, limited to src, lists nothing');
  });

  it('only the test entry reads AVARICE_TEST_REMOTE: no file under src, bin or scripts names it', () => {
    const named = ['src', 'bin', 'scripts'].flatMap((dir) => sourceFilesUnder(join(REPO_ROOT, dir))).filter((file) => readFileSync(file, 'utf8').includes('AVARICE_TEST_REMOTE'));
    assert.deepEqual(named, []);
  });

  it('the production entry ignores AVARICE_TEST_REMOTE: it composes the local executor and the local artifact store', () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, remoteRootOf(roots), repo.base);
    const added = runCli(['repo', 'add', repo.path], { roots, env: { AVARICE_TEST_REMOTE: '1', AVARICE_TEST_REMOTE_SEED: '42', AVARICE_TEST_REMOTE_LOG: join(roots.base, 'remote-42.log') } });
    assert.equal(added.code, 0, added.stdout + added.stderr);
    const adapters = rows<{ name: string; adapter: string }>(roots, "SELECT name, adapter FROM adapter_configs WHERE name IN ('executor', 'artifacts') ORDER BY name");
    assert.deepEqual(adapters.map((a) => [a.name, a.adapter]), [['artifacts', 'local-fs'], ['executor', 'local-sandbox-exec']]);
    assert.equal(existsSync(join(roots.base, 'remote-42.log')), false, 'no fake logged anything');
  });
});
