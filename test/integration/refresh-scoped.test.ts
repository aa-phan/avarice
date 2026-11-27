// Plan 04-14 (ONB-11): `onboard` on a project that already has an active record plans a refresh instead of refusing. The plan is chosen from the
// active record's revision, the new HEAD, GSD's drift result and the changed paths: incremental (indexes only), paths (the affected area) or full.
// Real gsd-core, scratch repositories, the fake host; where the drift GSD reports is the fact under test, a gsd-core double prints it.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { prepareInvocation } from '../../src/app/invocation.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { writeDriftOverrideGsdCore } from '../helpers/fake-gsd-core.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import { makeStampedMapRepo } from '../helpers/stamped-map-fixture.ts';
import type { StampedMapOptions, StampedMapRepo } from '../helpers/stamped-map-fixture.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(options: StampedMapOptions = {}): { roots: CliRoots; repo: StampedMapRepo } {
  const roots = makeRoots();
  const repo = makeStampedMapRepo(options);
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function stepOf<T>(roots: CliRoots, onboardingId: string, name: string): T | null {
  const [row] = rows<{ result_json: string }>(roots, 'SELECT result_json FROM onboarding_steps WHERE onboarding_id = ? AND step = ? ORDER BY attempt DESC', onboardingId, name);
  return row === undefined ? null : (JSON.parse(row.result_json) as T);
}

function realTools(): string {
  const located = locateGsdCore({ HOME: process.env['HOME'] ?? homedir() });
  assert.ok(located.ok, 'the installed gsd-core is admitted');
  return join(located.value.gsdCoreDir, 'bin', 'gsd-tools.cjs');
}

// A gsd-core that runs every verb for real except `verify codebase-drift`, which answers `drift`.
function driftDouble(drift: Readonly<Record<string, unknown>>): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-driftdouble-'));
  cleanup.push(dir);
  return { GSD_HOME: writeDriftOverrideGsdCore(join(dir, 'gsd-core'), realTools(), drift) };
}

interface RefreshStep {
  mode: string;
  outcome: string;
  completeness: string;
  paths?: string[];
  refresh?: { mode: string; scope?: string[]; reason: string; fromRecordVersion: number; fromRevision: string; toRevision: string; newTopLevelDirs: string[]; changedPaths: string[] };
}

// In-process onboarding through the production composition. `gsdEnv` points GSD_HOME at a double when a case needs one.
async function onboard(roots: CliRoots, repo: StampedMapRepo, gsdEnv: Record<string, string> = {}) {
  const host = new FakeAgentHost({});
  const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT, ...gsdEnv };
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok, `onboard on this project was refused: ${JSON.stringify(started)}`);
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return { outcome: outcome.value, host, mapCalls: host.calls.filter((call) => call.purpose === 'map'), onboardingId: started.value.onboardingId };
  } finally {
    composed.value.close();
  }
}

// A commit on top of the repository's HEAD that writes `files`.
function commitFiles(repo: StampedMapRepo, files: Readonly<Record<string, string>>, message: string): string {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
  return git(repo.path, ['rev-parse', 'HEAD']).trim();
}

describe('tracer: onboarding an active project with commits only under apps/api runs a paths refresh scoped to apps/api (S-34, ONB-11)', () => {
  it('records a paths plan over apps/api, confines the mapper to apps/api and .planning, keeps record version 1 and leaves the checkout alone', async () => {
    const { roots, repo } = fixture();
    const first = await onboard(roots, repo);
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    commitFiles(repo, { 'apps/api/handler.ts': 'export const handler = (): number => 1;\n' }, 'add the api handler');
    const before = checkoutSnapshot(repo.path);

    const second = await onboard(roots, repo, driftDouble({ block: true, skipped: false, reason: 'drift', last_mapped_commit: repo.sourceCommit, threshold: 3, action: 'warn', affected_paths: ['apps/api'] }));
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');

    const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.mode, 'paths');
    assert.deepEqual(plan?.paths, ['apps/api']);
    assert.equal(plan?.refresh?.mode, 'paths');
    assert.deepEqual(plan?.refresh?.scope, ['apps/api']);
    assert.equal(plan?.refresh?.fromRecordVersion, 1);
    assert.deepEqual(plan?.refresh?.changedPaths, ['apps/api/handler.ts']);

    assert.equal(second.mapCalls.length, 1, 'one mapper invocation');
    const call = second.mapCalls[0];
    assert.match(call?.prompt ?? '', /^\/gsd-map-codebase --paths apps\/api\n/);
    const staging = call?.scope.stagingPath as string;
    const insideStaging = (call?.scope.readConfine ?? []).filter((path) => path.startsWith(`${staging}/`)).map((path) => path.slice(staging.length + 1)).sort();
    assert.deepEqual(insideStaging, ['.planning', 'apps/api'], 'the mapper reads apps/api and .planning of the staging tree and nothing else in it');

    const records = rows<{ version: number; mapping_mode: string; mapping_scope_json: string; body_json: string; superseded_at: string | null }>(roots, 'SELECT version, mapping_mode, mapping_scope_json, body_json, superseded_at FROM project_records ORDER BY version');
    assert.deepEqual(records.map((r) => r.version), [1, 2], 'a refresh adds a record version');
    assert.equal(records[0]?.mapping_mode, 'adopt', 'version 1 is kept as it was');
    assert.notEqual(records[0]?.superseded_at, null, 'version 1 is superseded, not removed');
    assert.ok(JSON.parse(records[0]?.body_json as string), 'version 1 is still readable');
    assert.equal(records[1]?.mapping_mode, 'paths');
    assert.deepEqual(JSON.parse(records[1]?.mapping_scope_json as string), ['apps/api']);
    assert.equal(records[1]?.superseded_at, null, 'version 2 is the active one');

    assert.deepEqual(checkoutSnapshot(repo.path), before, 'the checkout is byte-identical');
  });
});

const BLOCK = (affected: string[], stamp: string): Record<string, unknown> => ({
  block: true,
  skipped: false,
  reason: 'drift',
  last_mapped_commit: stamp,
  threshold: 3,
  action: 'warn',
  affected_paths: affected,
});

function contractOf(roots: CliRoots, onboardingId: string): { files: { delete: string[]; read: string[] } } {
  const [row] = rows<{ body_json: string }>(roots, 'SELECT c.body_json FROM contracts c JOIN onboardings o ON o.contract_run_id = c.run_id WHERE o.onboarding_id = ?', onboardingId);
  return JSON.parse(row?.body_json as string) as { files: { delete: string[]; read: string[] } };
}

function latestRecord(roots: CliRoots): { version: number; mapping_mode: string; completeness: string } {
  const [row] = rows<{ version: number; mapping_mode: string; completeness: string }>(roots, 'SELECT version, mapping_mode, completeness FROM project_records ORDER BY version DESC LIMIT 1');
  return row as { version: number; mapping_mode: string; completeness: string };
}

describe('a full refresh (ONB-11)', () => {
  it('a commit that changes package.json plans and runs a full map, which replaces the map in staging', async () => {
    const { roots, repo } = fixture();
    assert.equal((await onboard(roots, repo)).outcome.state, 'active');
    commitFiles(repo, { 'package.json': '{"name":"stamped-fixture","version":"2"}\n' }, 'bump the manifest');
    const before = checkoutSnapshot(repo.path);

    const second = await onboard(roots, repo);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    assert.equal(second.mapCalls.length, 1, 'the mapper ran once');
    assert.match(second.mapCalls[0]?.prompt ?? '', /^\/gsd-map-codebase\n/, 'no --paths');
    const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.mode, 'full');
    assert.equal(plan?.completeness, 'complete');
    assert.equal(plan?.refresh?.mode, 'full');
    assert.match(plan?.refresh?.reason ?? '', /^manifest-change/);
    assert.deepEqual(plan?.refresh?.changedPaths, ['package.json']);
    assert.deepEqual(contractOf(roots, second.onboardingId).files.delete, ['.planning/codebase/**'], 'the old map may be deleted in staging');
    const record = latestRecord(roots);
    assert.deepEqual([record.version, record.mapping_mode, record.completeness], [2, 'full', 'complete']);
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'the checkout is byte-identical');
  });

  it('three new top-level directories plan a full map, two plan a paths map (the threshold of 3, ONB-11)', async () => {
    for (const [dirs, mode] of [[['alpha', 'beta'], 'paths'], [['alpha', 'beta', 'gamma'], 'full']] as const) {
      const { roots, repo } = fixture();
      assert.equal((await onboard(roots, repo)).outcome.state, 'active');
      commitFiles(repo, Object.fromEntries(dirs.map((dir) => [`${dir}/x.ts`, `export const ${dir} = 1;\n`])), 'new directories');
      const second = await onboard(roots, repo, driftDouble(BLOCK([...dirs], repo.sourceCommit)));
      assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
      const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
      assert.equal(plan?.mode, mode, `${dirs.length} new directories`);
      assert.deepEqual(plan?.refresh?.newTopLevelDirs, [...dirs]);
      if (mode === 'paths') assert.deepEqual(plan?.paths, [...dirs]);
      else assert.equal(plan?.paths, undefined);
    }
  });
});

describe('an incremental refresh (ONB-11)', () => {
  it('a commit that touches one source file with no drift runs no mapper, keeps the map and rebuilds the indexes', async () => {
    const { roots, repo } = fixture();
    assert.equal((await onboard(roots, repo)).outcome.state, 'active');
    commitFiles(repo, { 'src/index.ts': 'export const answer = 43;\n' }, 'touch one source file');
    const before = checkoutSnapshot(repo.path);

    const second = await onboard(roots, repo);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    assert.equal(second.mapCalls.length, 0, 'no mapper invocation');
    assert.equal(stepOf(roots, second.onboardingId, 'launch:map'), null, 'no map invocation was reserved or recorded');
    const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.mode, 'adopt');
    assert.equal(plan?.outcome, 'adopt');
    assert.equal(plan?.refresh?.mode, 'incremental');
    assert.deepEqual(plan?.refresh?.changedPaths, ['src/index.ts']);
    const indexSteps = rows<{ step: string }>(roots, "SELECT step FROM onboarding_steps WHERE onboarding_id = ? AND step LIKE 'index:%'", second.onboardingId);
    assert.ok(indexSteps.length > 0, 'the index steps ran (until plan 04-17 they rebuild the indexes whole)');
    const record = latestRecord(roots);
    assert.deepEqual([record.version, record.mapping_mode, record.completeness], [2, 'adopt', 'complete']);
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'the checkout is byte-identical');
  });

  it('a commit that changes nothing outside .planning plans an incremental refresh with reason no-change', async () => {
    const { roots, repo } = fixture();
    assert.equal((await onboard(roots, repo)).outcome.state, 'active');
    commitFiles(repo, {}, 'empty commit');
    const second = await onboard(roots, repo);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    assert.equal(second.mapCalls.length, 0);
    const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.refresh?.mode, 'incremental');
    assert.match(plan?.refresh?.reason ?? '', /^no-change/);
  });
});

describe('a refresh with nothing to measure from plans a full map (ONB-11)', () => {
  it('maps in full when the active record\'s map is not committed in the repository, because GSD has no stamp to read in staging', async () => {
    const { roots, repo } = fixture({ files: [] });
    const first = await onboard(roots, repo);
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    assert.equal(first.mapCalls.length, 1, 'the first onboarding mapped in full');
    commitFiles(repo, { 'src/index.ts': 'export const answer = 43;\n' }, 'touch one source file');

    const second = await onboard(roots, repo);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    assert.equal(second.mapCalls.length, 1);
    const plan = stepOf<RefreshStep>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.mode, 'full');
    assert.equal(plan?.refresh?.mode, 'full');
    assert.match(plan?.refresh?.reason ?? '', /^no-stamp/);
    assert.equal(latestRecord(roots).version, 2);
  });
});

// A stored plan in `paths` mode that names no usable scope must never widen the mapper to the whole read scope (WR-10, T-04-35). The refusal is tested where
// the invocation is prepared, with the plan damaged in the ledger the way a bad record or a later change of the planner could leave it.
describe('a damaged path-scoped mapping plan is refused instead of reading the whole repository (WR-10, ONB-11)', () => {
  async function prepared(damage: { paths: unknown }): Promise<{ result: ReturnType<typeof prepareInvocation>; launchRowsBefore: number; launchRowsAfter: number; staging: string }> {
    const { roots, repo } = fixture();
    const first = await onboard(roots, repo);
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const composed = createDeps(env, { host: new FakeAgentHost({}) });
    assert.ok(composed.ok, 'composition');
    try {
      const { deps } = composed.value;
      const row = deps.ledger.getOnboarding(first.onboardingId);
      assert.ok(row.ok);
      const recorded = deps.ledger.recordStepResult(first.onboardingId, { step: 'mapping:plan', attempt: 9, status: 'completed', result: { mode: 'paths', ...damage }, nowMs: Date.now(), completedAtMs: Date.now() });
      assert.ok(recorded.ok, 'the plan is recorded');
      const count = (): number => {
        const steps = deps.ledger.getStepResults(first.onboardingId);
        assert.ok(steps.ok);
        return steps.value.filter((s) => s.step === 'launch:map').length;
      };
      const launchRowsBefore = count();
      const result = prepareInvocation(deps, row.value, 'map', '/gsd-map-codebase', { expectedFiles: [] });
      return { result, launchRowsBefore, launchRowsAfter: count(), staging: row.value.stagingWorktree ?? '' };
    } finally {
      composed.value.close();
    }
  }

  const cases: Array<[string, unknown[]]> = [
    ['an empty list', []],
    ['a list holding a number', ['apps/api', 7]],
    ["a list holding '../outside'", ['apps/api', '../outside']],
  ];
  for (const [name, paths] of cases) {
    it(`${name}: the map is not launched and the error is invalid with field mapping:plan`, async () => {
      const outcome = await prepared({ paths });
      assert.ok(!outcome.result.ok, 'prepareInvocation refuses the plan');
      assert.equal(outcome.result.error.kind, 'invalid');
      assert.ok(outcome.result.error.kind === 'invalid' && outcome.result.error.field === 'mapping:plan', JSON.stringify(outcome.result.error));
      assert.equal(outcome.launchRowsAfter, outcome.launchRowsBefore, 'no launch step was recorded');
    });
  }

  it('a plan with no paths field at all is refused the same way', async () => {
    const outcome = await prepared({ paths: undefined });
    assert.ok(!outcome.result.ok);
    assert.ok(outcome.result.error.kind === 'invalid' && outcome.result.error.field === 'mapping:plan', JSON.stringify(outcome.result.error));
    assert.equal(outcome.launchRowsAfter, outcome.launchRowsBefore);
  });

  it('a valid paths plan still narrows the read scope to the paths plus .planning', async () => {
    const outcome = await prepared({ paths: ['apps/api'] });
    assert.ok(outcome.result.ok, JSON.stringify(outcome.result));
    assert.ok(outcome.result.value.granted);
    const confined = outcome.result.value.prepared.request.scope.readConfine?.filter((path) => path.startsWith(`${outcome.staging}/`)).map((path) => path.slice(outcome.staging.length + 1)).sort();
    assert.deepEqual(confined, ['.planning', 'apps/api']);
  });
});
