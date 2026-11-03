// Plan 01-17 Task 1: the intel index step end to end. The intel documents come from FakeIntelHost (a decorator over
// the fake map host); the GSD verbs that judge them (`intel validate`, `intel diff`) are the real ones, run through the
// sandboxed executor. Scratch repositories and temp directories only; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { OnboardingOutcome } from '../../src/app/onboarding-service.ts';
import { runIntelStep } from '../../src/app/stages/index-intel.ts';
import type { IndexStepContext } from '../../src/app/stages/index-steps.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import type { PortError } from '../../src/domain/result.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import type { FakeIntelOptions } from '../helpers/fake-intel-host.ts';
import { INTEL_FILE_NAMES, intelDocuments, serializeIntel } from '../fixtures/index-fixtures.ts';

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export function answer(): number {\n  return helper();\n}\nexport function helper(): number {\n  return 42;\n}\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface RecordBody {
  revisions: { onboardedAt: string };
  indexes: {
    intel?: { path: string; digest: string; refreshedAtCommit: string; freshness: string; files: number };
    absent?: Array<{ index: string; reason: string }>;
  };
}

interface Run {
  roots: CliRoots;
  repo: ScratchRepo;
  host: FakeIntelHost;
  outcome: OnboardingOutcome;
  onboardingId: string;
  staging: string;
  record: RecordBody;
}

async function onboard(intel: FakeIntelOptions = {}): Promise<Run> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  const env = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    // Hermetic and quick: the code graph is not what this file tests, so graphify is absent.
    AVARICE_GRAPHIFY_BIN: '/nonexistent/avarice-test-graphify',
  };
  const host = new FakeIntelHost(new FakeAgentHost(), intel);
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, 'the run itself does not fail');
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    assert.ok(onboarding);
    const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version DESC LIMIT 1');
    return {
      roots,
      repo,
      host,
      outcome: outcome.value,
      onboardingId: started.value.onboardingId,
      staging: onboarding.staging_worktree,
      record: JSON.parse(record?.body_json ?? '{"indexes":{}}') as RecordBody,
    };
  } finally {
    composed.value.close();
  }
}

const stateOf = (run: Run): string => run.outcome.state;

function absentReasons(run: Run): Array<{ index: string; reason: string }> {
  return run.record.indexes.absent ?? [];
}

describe('the intel step with a contained intel invocation (ONB-13, S-39 intel part)', () => {
  it('records indexes.intel with the staging HEAD, a digest of the files, and a fresh status', async () => {
    const run = await onboard();
    assert.equal(stateOf(run), 'active');
    const intel = run.record.indexes.intel;
    assert.ok(intel, 'the record lists the intel index');
    assert.equal(intel.path, '.planning/intel/');
    assert.equal(intel.freshness, 'fresh');
    assert.equal(intel.files, 5);
    assert.equal(intel.refreshedAtCommit, `git:${run.repo.head}`);
    assert.equal(intel.refreshedAtCommit, run.record.revisions.onboardedAt);
    assert.match(intel.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(absentReasons(run).some((a) => a.index === 'intel'), false);

    // The digest is over the sorted digests of the five files and the snapshot, as they are in staging.
    const names = [...INTEL_FILE_NAMES, '.last-refresh.json'].sort();
    const lines = names.map((name) => `${name} sha256:${sha256Hex(readFileSync(join(run.staging, '.planning', 'intel', name)))}`);
    assert.equal(intel.digest, `sha256:${sha256Hex(`${lines.join('\n')}\n`)}`);
  });

  it('asks for one contained invocation of the intel purpose in the form spike S0-D proved', async () => {
    const run = await onboard();
    assert.equal(run.host.calls.length, 1, 'one intel invocation');
    const call = run.host.calls[0];
    assert.ok(call);
    assert.equal(call.purpose, 'intel');
    assert.equal(call.agentName, 'gsd-intel-updater');
    assert.equal(call.prompt, 'focus: full; project root: .');
    assert.deepEqual([...call.expectedFiles].sort(), INTEL_FILE_NAMES.map((n) => `.planning/intel/${n}`).sort());
    assert.deepEqual(call.extensions, { skills: [], agents: ['gsd-intel-updater'] });
    assert.deepEqual(call.scope.writeRoots.map((root) => root.replace(/^.*\.planning/, '.planning')), ['.planning/intel']);
    assert.equal(call.cwd, run.staging);
    const [step] = rows<{ status: string; result_json: string }>(run.roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'launch:intel'");
    assert.equal(step?.status, 'completed');
  });

  it('records the intel index absent when a file is missing, and still activates (validate-failed)', async () => {
    const run = await onboard({ omit: ['api-map.json'] });
    assert.equal(stateOf(run), 'active');
    assert.equal(run.record.indexes.intel, undefined);
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'validate-failed' }]);
    const events = rows<{ data_json: string }>(run.roots, "SELECT data_json FROM events WHERE type = 'index.absent'");
    assert.ok(events.some((e) => (JSON.parse(e.data_json) as { index: string; reason: string }).index === 'intel' && (JSON.parse(e.data_json) as { reason: string }).reason === 'validate-failed'));
  });

  it('records the index absent when a file is not valid JSON (validate-failed)', async () => {
    const run = await onboard({ raw: { 'stack.json': '{ not json' } });
    assert.equal(stateOf(run), 'active');
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'validate-failed' }]);
  });

  it('records the index absent when the invocation exhausts its budget (budget_exhausted)', async () => {
    const run = await onboard({ outcomeKind: 'budget_exhausted' });
    assert.equal(stateOf(run), 'active');
    assert.equal(run.record.indexes.intel, undefined);
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'budget_exhausted' }]);
  });

  it('records the index absent when the host fails (invocation-failed)', async () => {
    const hostError: PortError = { kind: 'unavailable', cause: 'the host broke' };
    const run = await onboard({ hostError });
    assert.equal(stateOf(run), 'active');
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'invocation-failed' }]);
    const [step] = rows<{ status: string }>(run.roots, "SELECT status FROM onboarding_steps WHERE step = 'launch:intel'");
    assert.equal(step?.status, 'failed', 'the invocation that ran is recorded');
  });

  it('records the index absent when a failed or denied invocation left files that would validate (invocation-failed)', async () => {
    const run = await onboard({ outcomeKind: 'failed' });
    assert.equal(stateOf(run), 'active');
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'invocation-failed' }]);
  });

  it('records the index absent when `intel diff` reports a file changed since the refresh (diff-changed)', async () => {
    const run = await onboard({ changeAfterSnapshot: 'file-roles.json' });
    assert.equal(stateOf(run), 'active');
    assert.equal(run.record.indexes.intel, undefined);
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'diff-changed' }]);
  });

  it('records the index absent when the refresh left no snapshot to compare with (diff-changed)', async () => {
    const run = await onboard({ noSnapshot: true });
    assert.equal(stateOf(run), 'active');
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'diff-changed' }]);
  });

  it('never writes intel itself: with a host that wrote nothing, staging holds no intel document', async () => {
    const run = await onboard({ writeNothing: true });
    assert.equal(stateOf(run), 'active');
    assert.deepEqual(absentReasons(run).filter((a) => a.index === 'intel'), [{ index: 'intel', reason: 'validate-failed' }]);
    for (const name of INTEL_FILE_NAMES) assert.equal(existsSync(join(run.staging, '.planning', 'intel', name)), false, `${name} was not written by AVARICE`);
  });

  it('a write outside the intel write set by the invocation blocks activation (T-01-48)', async () => {
    const run = await onboard({ extraWrites: { 'src/injected.ts': 'export {};\n' } });
    assert.equal(stateOf(run), 'blocked');
    const findings = rows<{ data_json: string }>(run.roots, "SELECT data_json FROM events WHERE type = 'containment.finding'");
    assert.ok(findings.some((f) => (JSON.parse(f.data_json) as { check?: string }).check === 'activation-scope'));
  });

  it('says nothing about intel when the contract turns the index off (disabled, no invocation)', async () => {
    // The step needs nothing from the dependencies or the stage to answer `disabled`.
    const ctx = { contract: { body: { indexes: { codeGraph: true, intel: false, knowledge: true } } } } as unknown as IndexStepContext;
    const result = await runIntelStep({} as AppDeps, ctx);
    assert.deepEqual(result, { ok: true, value: { index: 'intel', status: 'disabled' } });
  });

  it('the fixtures are the documents gsd-intel-updater writes (five files, `_meta` and entries)', () => {
    const files = serializeIntel(intelDocuments('2026-01-01T00:00:00.000Z'));
    assert.deepEqual(Object.keys(files), [...INTEL_FILE_NAMES]);
    for (const name of INTEL_FILE_NAMES) assert.ok((JSON.parse(files[name]) as { _meta: { version: number } })._meta.version >= 1);
  });
});
