// Discriminating tests added by the 01-20 mutation campaign for the scope, validation and narrowing rules. Expected values
// come from docs/repository-onboarding.md ("Validation", "Onboarding contract") and docs/containment.md ("Generated host
// settings"), not from reading the code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { narrowProposals } from '../../src/domain/policy-narrowing.ts';
import type { PolicyPaths } from '../../src/domain/policy-narrowing.ts';
import { scopeViolationsOf } from '../../src/domain/validation.ts';

describe('FC-6: the clone git metadata is always denied to a shell', () => {
  it('lists <staging>/.git in denyWrite even when the workspace description does not name it', () => {
    const compiled = compileOnboardingContract({ onboardingId: 'onb-1', runId: 'run-1', projectId: 'prj-1', pin: 'c'.repeat(40), preflight: {}, request: {}, nowIso: '2026-11-02T00:00:00.000Z' });
    assert.ok(compiled.ok);
    const scope = computeInvocationScope({
      purpose: 'map',
      contract: compiled.value,
      stagingPath: '/work/staging',
      repoPath: '/work/repo',
      dataRoot: '/work/data',
      home: '/home/u',
      workspace: { topLevelEntries: ['src'], planningEntries: ['PROJECT.md'], gitPaths: [], repoReadAllow: [] },
      readRoots: [],
    });
    assert.ok(scope.denyWrite.includes('/work/staging/.git'));
    assert.ok(scope.denyWrite.includes('/work/staging/.planning/config.json'));
    assert.ok(scope.denyWrite.includes('/work/staging/src'));
    assert.ok(scope.denyWrite.includes('/work/staging/.planning/PROJECT.md'));
    assert.ok(!scope.denyWrite.includes('/work/staging/.planning/codebase'));
  });
});

describe('FC-11: the staging diff is judged against the write sets', () => {
  const allowedWrite = ['.planning/codebase/**', '.avarice-knowledge/**', '.planning/config.json'];
  const trackedWritable = ['.planning/config.json', '.planning/codebase/**'];

  it('flags an added path that is a tracked file in a place where tracked files may not change (delete and recreate)', () => {
    const violations = scopeViolationsOf({ modified: [], added: ['.avarice-knowledge/notes.md', '.avarice-knowledge/new.md'], deleted: [] }, ['.avarice-knowledge/notes.md', 'src/a.ts'], allowedWrite, trackedWritable);
    assert.deepEqual(violations, ['.avarice-knowledge/notes.md']);
  });

  it('accepts a tracked file re-created where tracked files may change, and an untracked addition in the write set', () => {
    const violations = scopeViolationsOf({ modified: [], added: ['.planning/codebase/STACK.md', '.avarice-knowledge/new.md'], deleted: [] }, ['.planning/codebase/STACK.md'], allowedWrite, trackedWritable);
    assert.deepEqual(violations, []);
  });
});

describe('FC-12: a proposal can only narrow, on a directory boundary', () => {
  const policy: PolicyPaths = { paths: { read: ['src/**', 'docs'], write: [], protected: [], generated: [], artifacts: [] } };

  it('rejects a read path that merely shares a prefix with a granted directory', () => {
    const narrowed = narrowProposals(policy, { paths: { read: ['src/lib/a.ts', 'src-evil/secrets.txt', 'srcx', 'docs'] } });
    assert.deepEqual(narrowed.accepted.paths.read, ['src/lib/a.ts', 'docs']);
    assert.deepEqual(
      narrowed.rejected.map((r) => [r.field, r.value, r.reason]),
      [
        ['paths.read', 'src-evil/secrets.txt', 'widens'],
        ['paths.read', 'srcx', 'widens'],
      ],
    );
  });
});
