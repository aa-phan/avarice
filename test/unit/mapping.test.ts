// chooseMappingMode: the decision table of docs/repository-onboarding.md "Mapping-mode decision table".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRIFT_THRESHOLD, chooseMappingMode, isScopePath, readScopePaths, refreshScope } from '../../src/domain/mapping.ts';
import type { ExistingMapClass } from '../../src/domain/preflight.ts';

const EXISTING: readonly ExistingMapClass[] = ['none', 'stamped-complete', 'stamped-partial', 'unstamped', 'unknown-format', 'user-edited'];

describe('chooseMappingMode', () => {
  it('skips mapping, with completeness none, when the repository is not brownfield', () => {
    for (const requested of [undefined, 'full', 'fast']) {
      const decision = chooseMappingMode({ isBrownfield: false, ...(requested !== undefined ? { requested } : {}) });
      assert.ok(decision.ok, JSON.stringify(decision));
      assert.equal(decision.value.mode, 'skip');
      assert.equal(decision.value.completeness, 'none');
    }
  });

  it('maps fast, with completeness partial, when fast is requested', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'fast' });
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.equal(decision.value.mode, 'fast');
    assert.equal(decision.value.completeness, 'partial');
  });

  it('maps full, with completeness complete, by default and when full is requested', () => {
    for (const requested of [undefined, 'full']) {
      const decision = chooseMappingMode({ isBrownfield: true, ...(requested !== undefined ? { requested } : {}) });
      assert.ok(decision.ok, JSON.stringify(decision));
      assert.equal(decision.value.mode, 'full');
      assert.equal(decision.value.completeness, 'complete');
    }
  });

  it('refuses a path-scoped request as invalid when the contract read scope is the whole repository', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'paths', readScope: ['**'] });
    assert.ok(!decision.ok);
    assert.equal(decision.error.kind, 'invalid');
  });

  it('regenerates in staging (full) for every existing-map classification, and keeps the classification', () => {
    for (const existingMap of EXISTING) {
      const decision = chooseMappingMode({ isBrownfield: true, existingMap });
      assert.ok(decision.ok, `${existingMap}: ${JSON.stringify(decision)}`);
      assert.equal(decision.value.mode, 'full', existingMap);
      assert.equal(decision.value.existingMap, existingMap);
    }
  });

  it('honours an explicit fast request even when a map already exists', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'fast', existingMap: 'stamped-complete' });
    assert.ok(decision.ok);
    assert.equal(decision.value.mode, 'fast');
  });

  it('refuses a mode name it does not know, and adoption of a map that is not adoptable', () => {
    const unknown = chooseMappingMode({ isBrownfield: true, requested: 'sideways' });
    assert.ok(!unknown.ok);
    assert.equal(unknown.error.kind, 'invalid');
    const adopt = chooseMappingMode({ isBrownfield: true, requested: 'adopt' });
    assert.ok(!adopt.ok);
    assert.equal(adopt.error.kind, 'unsupported');
  });
});

describe('chooseMappingMode: adopt and path-scoped maps (ONB-6, D-10)', () => {
  it('adopts a complete stamped map whose drift passed: no remap, completeness complete, never unsupported', () => {
    for (const requested of [undefined, 'full', 'adopt']) {
      const decision = chooseMappingMode({ isBrownfield: true, existingMap: 'stamped-complete', outcome: 'adopt', ...(requested !== undefined ? { requested } : {}) });
      assert.ok(decision.ok, `${String(requested)}: ${JSON.stringify(decision)}`);
      assert.equal(decision.value.mode, 'adopt');
      assert.equal(decision.value.completeness, 'complete');
      assert.equal(decision.value.outcome, 'adopt');
    }
  });

  it('refuses a requested adoption of a map that is not adoptable, naming the outcome', () => {
    for (const outcome of ['refresh', 'full-in-staging', 'isolated-regeneration', 'map'] as const) {
      const decision = chooseMappingMode({ isBrownfield: true, requested: 'adopt', existingMap: 'user-edited', outcome });
      assert.ok(!decision.ok, outcome);
      assert.ok(decision.error.kind === 'unsupported');
      assert.equal(decision.error.reducedMode, 'full');
      assert.match(decision.error.detail ?? '', new RegExp(outcome));
    }
  });

  it('does not adopt on a brownfield-less repository: skip comes first', () => {
    const decision = chooseMappingMode({ isBrownfield: false, existingMap: 'stamped-complete', outcome: 'adopt' });
    assert.ok(decision.ok);
    assert.equal(decision.value.mode, 'skip');
  });

  it('maps the directories of a contract read scope narrower than the repository as paths, completeness partial', () => {
    const decision = chooseMappingMode({ isBrownfield: true, readScope: ['apps/web/**', 'packages/ui/src/**/*.ts'] });
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.equal(decision.value.mode, 'paths');
    assert.equal(decision.value.completeness, 'partial');
    assert.deepEqual(decision.value.paths, ['apps/web', 'packages/ui/src']);
  });

  it('honours a requested paths mode over the same scope, and refuses it over the whole repository', () => {
    const scoped = chooseMappingMode({ isBrownfield: true, requested: 'paths', readScope: ['apps/web/**'] });
    assert.ok(scoped.ok);
    assert.deepEqual(scoped.value.paths, ['apps/web']);
    for (const readScope of [['**'], ['**/*.ts'], ['apps/web/**', '**'], []]) {
      const whole = chooseMappingMode({ isBrownfield: true, requested: 'paths', readScope });
      assert.ok(!whole.ok, JSON.stringify(readScope));
      assert.equal(whole.error.kind, 'invalid');
    }
  });

  it('keeps full for the whole-repository read scope the onboarding contract carries today', () => {
    const decision = chooseMappingMode({ isBrownfield: true, readScope: ['**'] });
    assert.ok(decision.ok);
    assert.equal(decision.value.mode, 'full');
    assert.equal(decision.value.paths, undefined);
  });

  it('refreshes a drift block over paths inside mapped directories as a path-scoped map, over a manifest as a full map', () => {
    const inside = chooseMappingMode({ isBrownfield: true, existingMap: 'stamped-complete', outcome: 'refresh', driftAffectedPaths: ['src/util', 'src/core/a.ts'] });
    assert.ok(inside.ok);
    assert.equal(inside.value.mode, 'paths');
    assert.deepEqual(inside.value.paths, ['src/core/a.ts', 'src/util']);
    const manifest = chooseMappingMode({ isBrownfield: true, existingMap: 'stamped-complete', outcome: 'refresh', driftAffectedPaths: ['src/util', 'package.json'] });
    assert.ok(manifest.ok);
    assert.equal(manifest.value.mode, 'full');
    assert.equal(manifest.value.completeness, 'complete');
  });
});

describe('refreshScope', () => {
  it('scopes plain affected paths, sorted and without duplicates', () => {
    assert.deepEqual(refreshScope(['gamma', 'alpha', 'alpha', 'beta']), ['alpha', 'beta', 'gamma']);
  });

  it('is a full remap (null) with no affected path, a manifest at any depth, or more top-level entries than the threshold', () => {
    assert.equal(refreshScope([]), null);
    for (const manifest of ['package.json', 'apps/web/package.json', 'pnpm-workspace.yaml', 'Cargo.toml', 'services/api/go.mod']) {
      assert.equal(refreshScope(['src/a.ts', manifest]), null, manifest);
    }
    assert.equal(refreshScope(['a', 'b', 'c', 'd']), null, `four top-level entries exceed the default threshold of ${DEFAULT_DRIFT_THRESHOLD}`);
    assert.deepEqual(refreshScope(['a', 'b', 'c']), ['a', 'b', 'c'], 'exactly the threshold still scopes');
    assert.deepEqual(refreshScope(['a', 'b', 'c', 'd'], 4), ['a', 'b', 'c', 'd'], 'the threshold is a parameter');
    assert.equal(refreshScope(['a/1', 'a/2', 'a/3', 'a/4', 'a/5']) !== null, true, 'many paths under one top-level entry are one area');
  });

  it('is a full remap when any path could change the meaning of the --paths value (T-04-27)', () => {
    for (const bad of ['a,b', '--paths', '-x', '../outside', '/abs', 'a b', 'a/../b', 'a//b', 'a\nb', '', 'a;rm', '$(x)']) {
      assert.equal(refreshScope(['ok/dir', bad]), null, JSON.stringify(bad));
    }
    assert.equal(refreshScope(Array.from({ length: 51 }, (_, i) => `d${i}/x`), 99), null, 'more than 50 paths is no scoped refresh');
  });
});

describe('readScopePaths and isScopePath', () => {
  it('reads the leading literal directories of each pattern, dropping a directory another already covers', () => {
    assert.deepEqual(readScopePaths(['apps/web/**']), ['apps/web']);
    assert.deepEqual(readScopePaths(['./apps/web/**', 'apps/web/src/**', 'libs/*/src/**']), ['apps/web', 'libs']);
    assert.deepEqual(readScopePaths(['docs']), ['docs']);
  });

  it('is the whole repository (null) for a pattern with no literal directory, an empty scope or a path it cannot pass on', () => {
    for (const read of [['**'], ['*'], ['**/*.ts'], ['{a,b}/**'], [], ['apps/web/**', '**'], ['has space/**'], ['../up/**']]) {
      assert.equal(readScopePaths(read), null, JSON.stringify(read));
    }
  });

  it('accepts plain relative paths only', () => {
    for (const ok of ['src', 'src/util/strings.ts', 'apps/web-app', 'a_b.c', '@scope/pkg', 'a+b']) assert.equal(isScopePath(ok), true, ok);
    for (const bad of ['', '.', '..', '-a', '/a', 'a/', 'a//b', 'a/./b', 'a b', 'a,b', 'a\tb', 'é', 'a*']) assert.equal(isScopePath(bad), false, JSON.stringify(bad));
  });
});
