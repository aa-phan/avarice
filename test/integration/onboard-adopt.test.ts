// Plan 04-10 (ONB-6, D-10): what onboarding does with a map the repository already has. A stamped, drift-free GSD map is adopted with no mapper
// invocation; the other classes are refreshed or regenerated in staging; the user's checkout is never written. Real gsd-core (its own
// `verify codebase-drift` runs in staging), scratch repositories, the fake host.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { EXPIRY_WAIT_MS, onboardingIdOf, resumeCli, runWithFault, sleepSync } from '../helpers/fault-run.ts';
import { checkoutSnapshot, treeDigest } from '../helpers/scratch-repo.ts';
import { makeStampedMapRepo } from '../helpers/stamped-map-fixture.ts';
import type { StampedMapOptions, StampedMapRepo } from '../helpers/stamped-map-fixture.ts';

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

function step<T>(roots: CliRoots, name: string): T | null {
  const [row] = rows<{ result_json: string }>(roots, 'SELECT result_json FROM onboarding_steps WHERE step = ? ORDER BY attempt DESC', name);
  return row === undefined ? null : (JSON.parse(row.result_json) as T);
}

interface PlanStep {
  mode: string;
  outcome: string;
  existingMap: string;
  completeness: string;
  paths?: string[];
  drift: { verdict: string | null; affectedPaths: string[] } | null;
}

// In-process onboarding through the production composition and the real gsd-core, with a fake host that keeps every request it was given.
async function onboard(roots: CliRoots, repo: StampedMapRepo, hostOptions: FakeHostOptions = {}) {
  const host = new FakeAgentHost(hostOptions);
  const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return { outcome: outcome.value, host, mapCalls: host.calls.filter((call) => call.purpose === 'map'), onboardingId: started.value.onboardingId };
  } finally {
    composed.value.close();
  }
}

describe('tracer: a committed, stamped, drift-free GSD map is adopted (ONB-6, D-10)', () => {
  it('reaches active with mode adopt, provenance adopted and no mapper invocation, and leaves the checkout byte-identical', async () => {
    const { roots, repo } = fixture();
    const before = treeDigest(repo.path);

    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 0, 'no mapper invocation');
    assert.equal(step(roots, 'launch:map'), null, 'no map invocation was reserved or recorded');

    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.mode, 'adopt');
    assert.equal(plan?.outcome, 'adopt');
    assert.equal(plan?.existingMap, 'stamped-complete');
    assert.equal(plan?.completeness, 'complete');
    assert.equal(plan?.drift?.verdict, 'pass', 'GSD itself reported no drift in staging');

    const [record] = rows<{ mapping_mode: string; completeness: string; body_json: string }>(roots, 'SELECT mapping_mode, completeness, body_json FROM project_records');
    assert.equal(record?.mapping_mode, 'adopt');
    assert.equal(record?.completeness, 'complete', 'completeness comes from the files present');
    const body = JSON.parse(record?.body_json as string) as { mapping: { provenance?: string }; existingState: Record<string, unknown> };
    assert.equal(body.mapping.provenance, 'adopted');
    assert.equal(body.existingState['codebaseMap'], 'stamped-complete');
    assert.equal(body.existingState['outcome'], 'adopt');
    assert.equal(body.existingState['drift'], 'pass');
    assert.equal('adoptionDeferred' in body.existingState, false);

    assert.equal(treeDigest(repo.path), before, 'the checkout is byte-identical');
  });
});

const NEW_DIRS = { 'alpha/a.ts': 'export const a = 1;\n', 'beta/b.ts': 'export const b = 1;\n', 'gamma/c.ts': 'export const c = 1;\n' };

// Three files in one new directory make GSD block (three drifting elements) while the repository gained one top-level directory.
const ONE_DIR = { 'alpha/a.ts': 'export const a = 1;\n', 'alpha/b.ts': 'export const b = 1;\n', 'alpha/c.ts': 'export const c = 1;\n' };

describe('a stamped map whose drift check blocks is refreshed in staging', () => {
  it('maps only the affected paths, with --paths, when GSD names directories inside the mapped territory (D-10)', async () => {
    const { roots, repo } = fixture({ after: [ONE_DIR] });
    const before = treeDigest(repo.path);

    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1, 'one mapper invocation');
    assert.match(mapCalls[0]?.prompt ?? '', /^\/gsd-map-codebase --paths alpha\n/);

    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.mode, 'paths');
    assert.equal(plan?.outcome, 'refresh');
    assert.equal(plan?.existingMap, 'stamped-complete');
    assert.equal(plan?.completeness, 'partial');
    assert.deepEqual(plan?.paths, ['alpha']);
    assert.equal(plan?.drift?.verdict, 'block');
    assert.deepEqual(plan?.drift?.affectedPaths, ['alpha'], 'what GSD itself reported');

    const [record] = rows<{ mapping_mode: string; completeness: string; mapping_scope_json: string; body_json: string }>(roots, 'SELECT mapping_mode, completeness, mapping_scope_json, body_json FROM project_records');
    assert.equal(record?.mapping_mode, 'paths');
    assert.equal(record?.completeness, 'partial');
    assert.deepEqual(JSON.parse(record?.mapping_scope_json as string), ['alpha']);
    const body = JSON.parse(record?.body_json as string) as { mapping: { provenance?: string }; existingState: Record<string, unknown> };
    assert.equal(body.mapping.provenance, undefined, 'a regenerated map is not adopted');
    assert.equal(body.existingState['outcome'], 'refresh');
    assert.equal(body.existingState['drift'], 'block');
    assert.equal(treeDigest(repo.path), before, 'the checkout is byte-identical');
  });

  it('maps in full at exactly three new top-level directories, the threshold of the refresh planner (ONB-11)', async () => {
    const { roots, repo } = fixture({ after: [NEW_DIRS] });
    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1);
    assert.match(mapCalls[0]?.prompt ?? '', /^\/gsd-map-codebase\n/, 'no --paths');
    const plan = step<PlanStep & { refresh?: { mode: string; newTopLevelDirs: string[]; threshold: number } }>(roots, 'mapping:plan');
    assert.equal(plan?.mode, 'full');
    assert.equal(plan?.outcome, 'refresh');
    assert.equal(plan?.drift?.verdict, 'block');
    assert.equal(plan?.refresh?.mode, 'full');
    assert.equal(plan?.refresh?.threshold, 3);
    assert.deepEqual(plan?.refresh?.newTopLevelDirs, ['alpha', 'beta', 'gamma']);
  });

  it('maps in full when the drift touches a manifest', async () => {
    const { roots, repo } = fixture({ after: [{ ...NEW_DIRS, 'package.json': '{"name":"stamped-fixture","version":"2"}\n' }] });
    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1);
    assert.match(mapCalls[0]?.prompt ?? '', /^\/gsd-map-codebase\n/, 'no --paths');
    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.mode, 'full');
    assert.equal(plan?.outcome, 'refresh');
    assert.equal(plan?.completeness, 'complete');
    assert.equal(plan?.paths, undefined);
    assert.equal(plan?.drift?.verdict, 'block');
    assert.ok(plan?.drift?.affectedPaths.includes('package.json'));
  });
});

describe('the GSD adapter descriptor', () => {
  it('declares map-paths and adopt-map, and still not ingest-docs', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const composed = createDeps(env, { host: new FakeAgentHost({}) });
    assert.ok(composed.ok);
    try {
      const capabilities = composed.value.deps.gsd?.descriptor.capabilities;
      assert.equal(capabilities?.['map-paths'], true);
      assert.equal(capabilities?.['adopt-map'], true);
      assert.equal(capabilities?.['ingest-docs'], false);
    } finally {
      composed.value.close();
    }
  });
});

describe('user-owned map files are never overwritten (S-28, ONB-6)', () => {
  it('treats a map edited in a commit after its stamp commit as user-edited: regenerated in staging, edited files listed under userOwned, checkout byte-identical', async () => {
    const { roots, repo } = fixture({ editedAfterStamp: ['STACK.md', 'TESTING.md'] });
    const before = treeDigest(repo.path);

    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1, 'the map is regenerated, in staging');
    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.existingMap, 'user-edited');
    assert.equal(plan?.outcome, 'isolated-regeneration');
    assert.equal(plan?.mode, 'full');
    assert.equal(plan?.drift, null, 'no drift question for a class that is regenerated whatever the drift is');

    const [onboarding] = rows<{ preflight_json: string }>(roots, 'SELECT preflight_json FROM onboardings');
    const existing = (JSON.parse(onboarding?.preflight_json as string) as { existingState: { codebaseMap: string; userOwned: string[] } }).existingState;
    assert.equal(existing.codebaseMap, 'user-edited');
    assert.deepEqual(existing.userOwned, ['.planning/codebase/STACK.md', '.planning/codebase/TESTING.md']);
    const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
    const state = (JSON.parse(record?.body_json as string) as { existingState: { userOwned: string[]; outcome: string } }).existingState;
    assert.deepEqual(state.userOwned, ['.planning/codebase/STACK.md', '.planning/codebase/TESTING.md']);
    assert.equal(state.outcome, 'isolated-regeneration');

    assert.equal(treeDigest(repo.path), before, 'the edited files, and everything else, are byte-identical in the checkout');
  });

  it('treats uncommitted changes under .planning/ as user-owned too, and leaves them as they are', async () => {
    const { roots, repo } = fixture({ modified: { '.planning/codebase/STACK.md': '# Stack\n\nuncommitted notes\n' }, untracked: { '.planning/notes.md': 'my notes\n' } });
    const before = treeDigest(repo.path);
    const { outcome } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    const [onboarding] = rows<{ preflight_json: string }>(roots, 'SELECT preflight_json FROM onboardings');
    const existing = (JSON.parse(onboarding?.preflight_json as string) as { existingState: { codebaseMap: string; userOwned: string[] } }).existingState;
    assert.equal(existing.codebaseMap, 'user-edited');
    assert.deepEqual(existing.userOwned, ['.planning/codebase/STACK.md', '.planning/notes.md']);
    assert.equal(treeDigest(repo.path), before);
  });

  it('leaves a map of another format untouched and regenerates in isolation in staging, recording the outcome', async () => {
    const { roots, repo } = fixture({ extraMapFiles: { '.planning/codebase/NOTES.md': '# Notes from another tool\n' } });
    const before = treeDigest(repo.path);

    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1);
    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.existingMap, 'unknown-format');
    assert.equal(plan?.outcome, 'isolated-regeneration');
    assert.equal(plan?.mode, 'full');
    const [onboarding] = rows<{ preflight_json: string }>(roots, 'SELECT preflight_json FROM onboardings');
    const existing = (JSON.parse(onboarding?.preflight_json as string) as { existingState: { userOwned: string[] } }).existingState;
    assert.equal(existing.userOwned.length, 8, 'every file of the other format is the owner\'s');
    assert.ok(existing.userOwned.includes('.planning/codebase/NOTES.md'));
    assert.equal(treeDigest(repo.path), before);
  });

  it('maps in full in staging, labelled by its class, for a partial and for an unstamped map', async () => {
    for (const options of [{ files: ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'] }, { unstamped: true }] as const) {
      const { roots, repo } = fixture(options);
      const before = treeDigest(repo.path);
      const { outcome, mapCalls } = await onboard(roots, repo);
      assert.equal(outcome.state, 'active', outcome.message ?? '');
      assert.equal(mapCalls.length, 1);
      const plan = step<PlanStep>(roots, 'mapping:plan');
      assert.equal(plan?.existingMap, 'files' in options ? 'stamped-partial' : 'unstamped');
      assert.equal(plan?.outcome, 'full-in-staging');
      assert.equal(plan?.mode, 'full');
      assert.equal(treeDigest(repo.path), before);
    }
  });
});

describe('a stamp alone never makes a map adoptable (T-04-26)', () => {
  it('maps in full in staging when the stamp names a commit the repository does not have, because GSD cannot give a drift verdict', async () => {
    const { roots, repo } = fixture({ stamp: 'deadbeef'.repeat(5) });
    const before = treeDigest(repo.path);
    const { outcome, mapCalls } = await onboard(roots, repo);
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(mapCalls.length, 1, 'the mapper ran');
    const plan = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(plan?.existingMap, 'stamped-complete', 'the class is read from the stamp');
    assert.equal(plan?.drift?.verdict, 'unreadable');
    assert.equal(plan?.outcome, 'full-in-staging');
    assert.equal(plan?.mode, 'full');
    const [record] = rows<{ mapping_mode: string; body_json: string }>(roots, 'SELECT mapping_mode, body_json FROM project_records');
    assert.equal(record?.mapping_mode, 'full');
    assert.equal((JSON.parse(record?.body_json as string) as { mapping: { provenance?: string } }).mapping.provenance, undefined);
    assert.equal(treeDigest(repo.path), before);
  });
});

describe('an onboarding killed after classification and resumed reaches the same outcome (S-29, ONB-6)', () => {
  const dirty = { modified: { 'src/index.ts': 'export const answer = 43; // uncommitted\n' }, untracked: { 'scratch/todo.txt': 'local only\n' } };

  it('a drift-blocked map killed during the mapper invocation: same plan after the resume, checkout byte-identical, both files recorded as not mapped', () => {
    const repo = makeStampedMapRepo({ after: [NEW_DIRS], ...dirty });
    const roots = makeRoots();
    cleanup.push(roots.base, repo.base);
    const before = checkoutSnapshot(repo.path);

    runWithFault(roots, repo, 'mid-invocation');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the kill');
    const planBefore = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(planBefore?.outcome, 'refresh');

    sleepSync(EXPIRY_WAIT_MS);
    const resumed = resumeCli(roots, onboardingIdOf(roots));
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, /: active/);
    assert.deepEqual(step<PlanStep>(roots, 'mapping:plan'), planBefore, 'the outcome after the resume equals the outcome before the kill');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the resume');
    const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
    assert.deepEqual((JSON.parse(record?.body_json as string) as { notMapped: string[] }).notMapped, ['scratch/todo.txt', 'src/index.ts']);
  });

  it('an adopted map killed right after the classification: adopted again after the resume, no mapper invocation, checkout byte-identical', () => {
    const repo = makeStampedMapRepo(dirty);
    const roots = makeRoots();
    cleanup.push(roots.base, repo.base);
    const before = checkoutSnapshot(repo.path);

    runWithFault(roots, repo, 'after-checkpoint:verify-enforcement');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the kill');
    const planBefore = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(planBefore?.outcome, 'adopt');

    sleepSync(EXPIRY_WAIT_MS);
    const resumed = resumeCli(roots, onboardingIdOf(roots));
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, /: active/);
    const planAfter = step<PlanStep>(roots, 'mapping:plan');
    assert.equal(planAfter?.outcome, 'adopt');
    assert.equal(planAfter?.mode, 'adopt');
    assert.equal(planAfter?.drift?.verdict, 'pass');
    assert.equal(step(roots, 'launch:map'), null, 'no mapper invocation on either side of the kill');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'unchanged after the resume');
    const [record] = rows<{ mapping_mode: string; body_json: string }>(roots, 'SELECT mapping_mode, body_json FROM project_records');
    assert.equal(record?.mapping_mode, 'adopt');
    assert.deepEqual((JSON.parse(record?.body_json as string) as { notMapped: string[] }).notMapped, ['scratch/todo.txt', 'src/index.ts']);
  });
});
