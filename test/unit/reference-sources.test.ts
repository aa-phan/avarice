// Deferred item 10, second owner decision: what the committed package.json and workflow files say a reference is.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actionRefsOf, dependencyNamesOf, packageJsonPathsFor, workflowPathsFor } from '../../src/domain/reference-sources.ts';

describe('dependencyNamesOf', () => {
  it('collects dependencies, devDependencies, peerDependencies and optionalDependencies, scoped names whole', () => {
    const text = JSON.stringify({
      name: 'self',
      dependencies: { react: '^19', '@scope/pkg': '1' },
      devDependencies: { vite: '^8' },
      peerDependencies: { motion: '*' },
      optionalDependencies: { fsevents: '*' },
      scripts: { build: 'vite build' },
      engines: { node: '22' },
    });
    assert.deepEqual([...dependencyNamesOf([text])].sort(), ['@scope/pkg', 'fsevents', 'motion', 'react', 'vite']);
  });

  it('unions several files, ignores text that is not JSON or not an object, and ignores non-string versions', () => {
    const names = dependencyNamesOf(['{"dependencies":{"a":"1"}}', 'not json', '[]', '{"dependencies":["x"]}', '{"devDependencies":{"b":"1","c":2}}']);
    assert.deepEqual([...names].sort(), ['a', 'b']);
  });

  it('does not read a name from scripts, workspaces or the package name', () => {
    assert.deepEqual(dependencyNamesOf(['{"name":"self","workspaces":["pkgs/*"],"scripts":{"x":"y"}}']), []);
  });
});

describe('actionRefsOf', () => {
  it('reads owner/name from `uses:` lines with or without a version, a quote and a trailing comment', () => {
    const yml = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@3d3c42e # v7',
      "      - uses: 'actions/setup-node@abc'",
      '        uses: owner/name',
      '      - name: x',
      '        uses: "owner/other@v1"',
    ].join('\n');
    assert.deepEqual([...actionRefsOf([yml])].sort(), ['actions/checkout', 'actions/setup-node', 'owner/name', 'owner/other']);
  });

  it('skips local actions, docker images and reusable workflows with a path, and ignores `run:` text', () => {
    const yml = ['- uses: ./local/action', '- uses: docker://alpine:3', '- run: echo uses: fake/thing', '- uses: org/repo/.github/workflows/x.yml@main'].join('\n');
    assert.deepEqual(actionRefsOf([yml]), []);
  });
});

describe('which files are read', () => {
  it('the root package.json when it is tracked, plus the workspaces the root declares (array or { packages })', () => {
    const tracked = ['package.json', 'packages/a/package.json', 'packages/b/package.json', 'tools/x/package.json', 'node_modules/p/package.json', 'src/index.ts'];
    assert.deepEqual(packageJsonPathsFor(tracked, '{"workspaces":["packages/*"]}'), ['package.json', 'packages/a/package.json', 'packages/b/package.json']);
    assert.deepEqual(packageJsonPathsFor(tracked, '{"workspaces":{"packages":["tools/*"]}}'), ['package.json', 'tools/x/package.json']);
    assert.deepEqual(packageJsonPathsFor(tracked, '{}'), ['package.json']);
    assert.deepEqual(packageJsonPathsFor(tracked, null), ['package.json']);
  });

  it('no package.json at all when the root one is not tracked (a nested one alone is not read)', () => {
    assert.deepEqual(packageJsonPathsFor(['sub/package.json'], null), []);
  });

  it('only top-level files under .github/workflows with a yml or yaml extension', () => {
    const tracked = ['.github/workflows/ci.yml', '.github/workflows/deploy.yaml', '.github/workflows/notes.md', '.github/workflows/sub/x.yml', 'docs/.github/workflows/y.yml', '.github/actions/z/action.yml'];
    assert.deepEqual(workflowPathsFor(tracked), ['.github/workflows/ci.yml', '.github/workflows/deploy.yaml']);
  });
});
