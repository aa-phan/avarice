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
