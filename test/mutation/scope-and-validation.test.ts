// Discriminating tests added by the 01-20 mutation campaign for the scope, validation and narrowing rules. Expected values
// come from docs/repository-onboarding.md ("Validation", "Onboarding contract") and docs/containment.md ("Generated host
// settings"), not from reading the code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { narrowProposals } from '../../src/domain/policy-narrowing.ts';
import type { PolicyPaths } from '../../src/domain/policy-narrowing.ts';
import { AVARICE_WRITE_SET, scopeViolationsOf, validateMapArtifacts, writeSetsFor } from '../../src/domain/validation.ts';
import type { MapArtifactFacts } from '../../src/domain/validation.ts';
import { FULL_MAP_FILES } from '../../src/domain/mapping.ts';

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
      workRoot: '/work',
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

  it('rejects a path field that is not an array instead of reading it character by character', () => {
    const narrowed = narrowProposals(policy, { paths: { read: 'src' } });
    assert.deepEqual(narrowed.accepted.paths, {});
    assert.deepEqual(narrowed.rejected.map((r) => [r.field, r.value, r.reason]), [['paths.read', 'src', 'invalid']]);
  });

  it('accepts at most 50 proposed commands and rejects the 51st as invalid, never as accepted', () => {
    const commands = Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, argv: ['ls'] }));
    const narrowed = narrowProposals(policy, { commands });
    assert.equal(narrowed.accepted.commands.length, 50);
    assert.deepEqual(narrowed.rejected.map((r) => [r.field, r.reason]), [['commands[50]', 'invalid']]);
    assert.ok(narrowed.accepted.commands.every((c) => c.status === 'inactive'));
  });
});

describe('FC-11: size and structure of a map document', () => {
  const HEAD = 'a'.repeat(40);
  const TEMPLATE = ['Languages', 'Runtime', 'Frameworks', 'Key Dependencies', 'Configuration', 'Platform Requirements'];
  function documentsWith(stack: string, oversize = false): MapArtifactFacts {
    return {
      stagingHead: HEAD,
      files: FULL_MAP_FILES.map((path) => {
        const text = path.endsWith('/STACK.md') ? stack : path.endsWith('/ARCHITECTURE.md') ? ['# A', ...['Pattern Overview', 'Layers', 'Data Flow', 'Key Abstractions', 'Entry Points', 'Error Handling', 'Cross-Cutting Concerns'].map((h) => `## ${h}`)].join('\n') : '# Doc\n';
        return { path, lastMappedCommit: HEAD, text, bytes: Buffer.byteLength(text), ...(path.endsWith('/STACK.md') && oversize ? { oversize: true } : {}) };
      }),
      changes: { modified: [], added: [], deleted: [] },
      allowedWrite: ['.planning/codebase/**'],
      trackedWritable: ['.planning/codebase/**'],
      knownPaths: [],
    };
  }
  const structure = (facts: MapArtifactFacts) => validateMapArtifacts(facts, { mode: 'full' }).checks.find((c) => c.name === 'size-and-structure');
  const stackWith = (headings: string[], fenced = false): string => ['# Stack', ...(fenced ? ['```'] : []), ...headings.map((h) => `## ${h}`), ...(fenced ? ['```'] : [])].join('\n');

  it('requires the template headings outside a fenced code block', () => {
    assert.equal(structure(documentsWith(stackWith(TEMPLATE)))?.passed, true);
    const fenced = structure(documentsWith(stackWith(TEMPLATE, true)));
    assert.equal(fenced?.passed, false);
    assert.match(fenced?.detail ?? '', /missing template heading/);
  });

  it('fails a document that the reader marked oversize even when its byte count is small', () => {
    const marked = structure(documentsWith(stackWith(TEMPLATE), true));
    assert.equal(marked?.passed, false);
    assert.match(marked?.detail ?? '', /above the 262144 byte cap/);
  });
});

describe('FC-11: the AVARICE write set is writable but never a place where a tracked file may change', () => {
  it('keeps .planning/graphs/** and the other AVARICE-only globs out of trackedWritable', () => {
    const files = { write: { map: ['.planning/codebase/**'], intel: [], knowledge: [] }, create: { map: [], intel: [], knowledge: [] }, avariceWrite: [] } as unknown as Parameters<typeof writeSetsFor>[0];
    const sets = writeSetsFor(files, ['map']);
    for (const glob of AVARICE_WRITE_SET) assert.ok(sets.allowedWrite.includes(glob), glob);
    assert.deepEqual(sets.trackedWritable.sort(), ['.planning/codebase/**', '.planning/config.json']);
  });
});
