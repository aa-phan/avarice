// planRefresh: the choice between an incremental, a path-scoped and a full refresh (ONB-11, docs/repository-onboarding.md "Mapping-mode decision table").
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_REMAP_DRIFT_THRESHOLD, REFRESH_MANIFEST_NAMES, newTopLevelDirsOf, planRefresh, touchesManifest } from '../../src/domain/refresh-plan.ts';
import type { RefreshFacts } from '../../src/domain/refresh-plan.ts';

const STAMP = 'a'.repeat(40);

function facts(over: Partial<RefreshFacts> = {}): RefreshFacts {
  return { stamp: STAMP, drift: 'pass', affectedPaths: [], changedPaths: ['src/a.ts'], newTopLevelDirs: [], manifestChanged: false, ...over };
}

const dirs = (count: number): string[] => Array.from({ length: count }, (_, i) => `dir${i + 1}`);

describe('planRefresh: drift pass', () => {
  it('is incremental with reason no-change when nothing changed', () => {
    const plan = planRefresh(facts({ changedPaths: [] }));
    assert.equal(plan.mode, 'incremental');
    assert.match(plan.reason, /^no-change/);
    assert.equal(plan.scope, undefined);
  });

  it('is incremental when only source paths changed and GSD reports no drift', () => {
    const plan = planRefresh(facts({ changedPaths: ['src/a.ts', 'src/b/c.ts'] }));
    assert.equal(plan.mode, 'incremental');
    assert.equal(plan.scope, undefined);
  });
});

describe('planRefresh: drift block', () => {
  it('is paths over the affected paths inside mapped territory, sorted and without duplicates, for 0, 1 and 2 new top-level directories', () => {
    for (const count of [0, 1, 2]) {
      const plan = planRefresh(facts({ drift: 'block', affectedPaths: ['src/util', 'apps/api', 'src/util'], newTopLevelDirs: dirs(count) }));
      assert.equal(plan.mode, 'paths', `${count} new directories`);
      assert.deepEqual(plan.scope, ['apps/api', 'src/util']);
    }
  });

  it('is full with no affected path, because there is nothing to scope to', () => {
    const plan = planRefresh(facts({ drift: 'block', affectedPaths: [] }));
    assert.equal(plan.mode, 'full');
    assert.equal(plan.scope, undefined);
  });

  it('is full when an affected path is a manifest at any depth', () => {
    for (const manifest of ['package.json', 'apps/web/package.json', 'pnpm-workspace.yaml', 'Cargo.toml', 'services/api/go.mod', 'tools/pyproject.toml']) {
      assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: ['src/a.ts', manifest] })).mode, 'full', manifest);
    }
  });

  it('is full when an affected path could change the meaning of the --paths value (T-04-27)', () => {
    for (const bad of ['a,b', '--paths', '-x', '../outside', '/abs', 'a b', 'a/../b', 'a//b', 'a\nb', '', 'a;rm', '$(x)']) {
      assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: ['ok/dir', bad] })).mode, 'full', JSON.stringify(bad));
    }
  });

  it('is full for more than 50 affected paths', () => {
    assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: Array.from({ length: 51 }, (_, i) => `d${i}/x`) })).mode, 'full');
    assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: Array.from({ length: 50 }, (_, i) => `d${i}/x`) })).mode, 'paths');
  });
});

describe('planRefresh: the full-remap threshold (boundary and precision, ONB-11)', () => {
  it('is 3 new top-level directories, GSD\'s own default', () => {
    assert.equal(FULL_REMAP_DRIFT_THRESHOLD, 3);
  });

  it('plans full at exactly 3 new top-level directories and paths at 2', () => {
    const block = { drift: 'block' as const, affectedPaths: ['alpha', 'beta'] };
    assert.equal(planRefresh(facts({ ...block, newTopLevelDirs: dirs(2) })).mode, 'paths');
    const three = planRefresh(facts({ ...block, newTopLevelDirs: dirs(3) }));
    assert.equal(three.mode, 'full');
    assert.match(three.reason, /^new-top-level-dirs: 3 new top-level directories, threshold 3/);
    assert.equal(planRefresh(facts({ ...block, newTopLevelDirs: dirs(4) })).mode, 'full');
  });

  it('plans full at the threshold even when GSD reports no drift', () => {
    assert.equal(planRefresh(facts({ drift: 'pass', newTopLevelDirs: dirs(3) })).mode, 'full');
    assert.equal(planRefresh(facts({ drift: 'pass', newTopLevelDirs: dirs(2) })).mode, 'incremental');
  });

  it('takes the threshold as an option: 5 with 4 new directories is paths, with 5 it is full', () => {
    const block = { drift: 'block' as const, affectedPaths: ['alpha'] };
    assert.equal(planRefresh(facts({ ...block, newTopLevelDirs: dirs(4) }), { threshold: 5 }).mode, 'paths');
    assert.equal(planRefresh(facts({ ...block, newTopLevelDirs: dirs(5) }), { threshold: 5 }).mode, 'full');
    assert.equal(planRefresh(facts({ ...block, newTopLevelDirs: dirs(1) }), { threshold: 1 }).mode, 'full');
  });

  it('counts whole directories: a name listed twice is one directory, and there is no ratio of the repository size', () => {
    assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: ['alpha'], newTopLevelDirs: ['alpha', 'alpha', 'beta', 'beta'] })).mode, 'paths', 'two distinct directories');
    // One new directory out of one: every top-level directory is new, and a ratio rule would say full. A count says paths.
    assert.equal(planRefresh(facts({ drift: 'block', affectedPaths: ['alpha'], newTopLevelDirs: ['alpha'] })).mode, 'paths');
  });

  it('refuses a threshold that is not a positive integer rather than rounding it', () => {
    for (const threshold of [2.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => planRefresh(facts(), { threshold }), TypeError, String(threshold));
    }
  });
});

describe('planRefresh: what forces a full map whatever GSD said', () => {
  it('is full when a manifest or workspace file changed, with drift pass or block', () => {
    for (const drift of ['pass', 'block'] as const) {
      const plan = planRefresh(facts({ drift, affectedPaths: ['src'], manifestChanged: true }));
      assert.equal(plan.mode, 'full', drift);
      assert.match(plan.reason, /^manifest-change/);
    }
  });

  it('is full when GSD could not read the drift', () => {
    const plan = planRefresh(facts({ drift: 'unreadable' }));
    assert.equal(plan.mode, 'full');
    assert.match(plan.reason, /^drift-unreadable/);
  });

  it('is full when the existing map carries no stamp', () => {
    const plan = planRefresh(facts({ stamp: null }));
    assert.equal(plan.mode, 'full');
    assert.match(plan.reason, /^no-stamp/);
  });
});

describe('REFRESH_MANIFEST_NAMES and touchesManifest', () => {
  it('lists the workspace and dependency manifests by basename', () => {
    for (const name of ['package.json', 'pnpm-workspace.yaml', 'go.mod', 'Cargo.toml', 'pyproject.toml']) {
      assert.ok(REFRESH_MANIFEST_NAMES.includes(name), name);
    }
  });

  it('matches by basename at any depth and never by a part of a name', () => {
    assert.equal(touchesManifest(['src/a.ts', 'apps/web/package.json']), true);
    assert.equal(touchesManifest(['go.mod']), true);
    assert.equal(touchesManifest(['src/package.json.bak', 'my-package.json', 'package.json/readme.md', 'docs/Cargo.toml.md']), false);
    assert.equal(touchesManifest([]), false);
  });
});

describe('newTopLevelDirsOf', () => {
  it('is the top-level directories of the changed paths that the earlier revision did not have, sorted and unique', () => {
    assert.deepEqual(newTopLevelDirsOf(['apps/api/a.ts', 'apps/web/b.ts', 'src/c.ts', 'tools/d.ts'], ['src', 'README.md']), ['apps', 'tools']);
  });

  it('does not count a file at the repository root, or a directory the earlier revision had', () => {
    assert.deepEqual(newTopLevelDirsOf(['CHANGELOG.md', 'src/a.ts'], ['src']), []);
    assert.deepEqual(newTopLevelDirsOf([], ['src']), []);
  });
});
