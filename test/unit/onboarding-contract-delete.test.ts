// files.delete of the onboarding contract (docs/repository-onboarding.md "Onboarding contract"; finding onboarding-contract.ts:128): the map
// directory is deletable, in staging, only when the existing-map answer is Refresh and a map exists to replace; every other answer, and a
// repository with no map, deletes nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileOnboardingContract, filesDeleteFor } from '../../src/domain/onboarding-contract.ts';

function compile(preflight: Record<string, unknown>) {
  const compiled = compileOnboardingContract({
    onboardingId: 'onb_01TEST',
    runId: 'run_01TEST',
    projectId: 'proj_test',
    pin: 'git:4f2c9e1',
    preflight,
    request: {},
    nowIso: '2026-11-02T00:00:00.000Z',
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  return compiled.value;
}

describe('filesDeleteFor', () => {
  it('holds the map directory exactly when the answer is refresh and a map exists', () => {
    for (const existing of ['stamped-complete', 'stamped-partial', 'unstamped', 'unknown-format', 'user-edited']) {
      assert.deepEqual(filesDeleteFor('refresh', existing), ['.planning/codebase/**'], existing);
    }
  });

  it('is empty for the skip and update answers, whatever exists', () => {
    for (const answer of ['skip', 'update', 'update:docs', 'Refresh', '']) {
      assert.deepEqual(filesDeleteFor(answer, 'stamped-complete'), [], JSON.stringify(answer));
    }
  });

  it('is empty when there is no existing map to refresh', () => {
    assert.deepEqual(filesDeleteFor('refresh', 'none'), []);
  });
});

describe('compileOnboardingContract files.delete', () => {
  it('carries the map directory for a repository with an existing map, because the contract answers Refresh', () => {
    const contract = compile({ existingState: { codebaseMap: 'stamped-complete' } });
    assert.equal(contract.decisions.defaults.find((d) => d.class === 'existing-map')?.default, 'refresh');
    assert.deepEqual(contract.files.delete, ['.planning/codebase/**']);
  });

  it('is empty for a repository with no map, with no preflight state, and with an unreadable classification', () => {
    assert.deepEqual(compile({ existingState: { codebaseMap: 'none' } }).files.delete, []);
    assert.deepEqual(compile({}).files.delete, []);
    assert.deepEqual(compile({ existingState: { codebaseMap: 7 } }).files.delete, []);
    assert.deepEqual(compile({ existingState: 'stamped-complete' }).files.delete, []);
  });
});
