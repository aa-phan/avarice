// The portability proof (plan 04-33; NFR-4, AC-7, SC5; docs/operations-and-testing.md "Portability proof"). The domain code is claimed to depend only on ports.
// This suite runs the same workflows twice from the same source tree: once with the local adapters and once with fake-remote adapters for CommandExecutor and
// ArtifactStore that serialize every call through JSON, add latency, drop 5% of responses and duplicate 2% from a seeded random source. Only configuration
// differs: the test CLI (test/helpers/test-cli.ts) hands both fakes to main() through the DepsOverrides seam when AVARICE_TEST_REMOTE=1. A failure reproduces from
// its seed (AVARICE_TEST_REMOTE_SEED). No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { REPO_FILES, TEST_CLI, normalizeRecord, normalizeText } from '../helpers/fault-run.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import type { FaultCounts, FaultEvent } from '../helpers/seeded-faults.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
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
    const keys = remote.events.filter((e) => e.kind === 'inner-call').map((e) => e.key);
    assert.equal(new Set(keys).size, keys.length, 'the inner executor call log holds unique invocation keys');
    assert.equal(countOf(local).innerCall, 0, 'the local run has no fake and logs nothing');
  });
});
