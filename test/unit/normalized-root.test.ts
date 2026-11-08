// normalizedAbsoluteRoot: the one root check shared by the invocation scope (work root) and the extraction plan (corpus root) (IN-02).
// Pure: string in, string out or a RootRefusedError.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RootRefusedError, lexicalAbsolute, normalizedAbsoluteRoot, trimTrailingSlashes } from '../../src/domain/normalized-root.ts';
import { computeInvocationScope } from '../../src/domain/invocation-scope.ts';
import { planExtractionChunks } from '../../src/domain/knowledge-extraction.ts';

const LABEL = 'someCaller: someRoot';

describe('normalizedAbsoluteRoot', () => {
  it('returns a normalized absolute root with its trailing slashes trimmed', () => {
    for (const [given, want] of [['/work', '/work'], ['/work/', '/work'], ['/work///', '/work'], ['/srv/a.b/..c', '/srv/a.b/..c']] as const) {
      assert.equal(normalizedAbsoluteRoot(given, LABEL), want, given);
    }
  });

  it('refuses everything else with a RootRefusedError that is a TypeError and names the label and the offending value', () => {
    for (const bad of ['', 'work', './work', '../work', '/', '//', '///', '/work//x', '/work/./x', '/work/../x', '/work/..', undefined, null, 42]) {
      assert.throws(
        () => normalizedAbsoluteRoot(bad, LABEL),
        (error: unknown) => {
          assert.ok(error instanceof RootRefusedError, String(bad));
          assert.ok(error instanceof TypeError, String(bad));
          assert.equal((error as Error).name, 'TypeError');
          assert.match((error as Error).message, /^someCaller: someRoot must be a normalized absolute path below '\/', got /);
          return true;
        },
        String(bad),
      );
    }
  });

  it('trims only trailing slashes, and leaves a lone `/` alone', () => {
    assert.equal(trimTrailingSlashes('/a/b//'), '/a/b');
    assert.equal(trimTrailingSlashes('/'), '/');
    assert.equal(trimTrailingSlashes(''), '');
  });

  it('is the check both callers run: each throws a RootRefusedError that keeps its own label', () => {
    const manifest = { entries: [] } as never;
    assert.throws(() => planExtractionChunks(manifest, {}, 'relative'), (e: unknown) => e instanceof RootRefusedError && /^planExtractionChunks: corpusRoot must be/.test((e as Error).message));
    assert.throws(() => computeInvocationScope({ workRoot: 'relative' } as never), (e: unknown) => e instanceof RootRefusedError && /^computeInvocationScope: workRoot must be/.test((e as Error).message));
  });
});

// lexicalAbsolute: the lexical normal form of an absolute path, with no file system consulted (G-02-H2).
describe('lexicalAbsolute', () => {
  it('removes `.` and empty segments and a trailing slash', () => {
    assert.equal(lexicalAbsolute('/a/./b//c/'), '/a/b/c');
    assert.equal(lexicalAbsolute('/'), '/');
  });

  it('applies `..` on the string, without following a symlink', () => {
    assert.equal(lexicalAbsolute('/a/b/../c'), '/a/c');
    assert.equal(lexicalAbsolute('/a/..'), '/');
    assert.equal(lexicalAbsolute('/a/b/../../c/d'), '/c/d');
  });

  it('gives null for a path that climbs above `/` and for a relative path', () => {
    assert.equal(lexicalAbsolute('/..'), null);
    assert.equal(lexicalAbsolute('/a/../..'), null);
    assert.equal(lexicalAbsolute('a/b'), null);
    assert.equal(lexicalAbsolute(''), null);
  });
});
