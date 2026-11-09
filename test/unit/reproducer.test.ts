// The smallest reproducer of a failing check (plan 03-06; D-11, AUT-10): bounded, and never holding the output text.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { digestOf, sha256Hex } from '../../src/domain/digest.ts';
import { buildReproducer, extractFailingTests } from '../../src/domain/reproducer.ts';

const ESC = String.fromCharCode(27);

describe('extractFailingTests', () => {
  it('reads a vitest FAIL line as the file and the test path', () => {
    const output = [' RUN  v1.6.0', '', ' FAIL  tests/unit/copy.test.ts > copyFallback > names the address', 'AssertionError: expected 1 to be 2', ' Test Files  1 failed (1)'].join('\n');
    assert.deepEqual(extractFailingTests(output), ['tests/unit/copy.test.ts > copyFallback > names the address']);
  });

  it('reads a node:test TAP not ok line as the test name, indented or not', () => {
    const output = ['TAP version 13', '# Subtest: copy', '    ok 1 - passes', '    not ok 3 - rejects an empty string', '      ---', '1..3'].join('\n');
    assert.deepEqual(extractFailingTests(output), ['rejects an empty string']);
  });

  it('skips a TAP not ok line that carries a skip or todo directive, and a vitest FAIL line that names only a file', () => {
    assert.deepEqual(extractFailingTests('not ok 1 - later # TODO not yet\nnot ok 2 - skipped # SKIP why\n FAIL  tests/unit/broken.test.ts\n'), []);
  });

  it('removes terminal colour codes before it reads a line', () => {
    assert.deepEqual(extractFailingTests(` ${ESC}[41m FAIL ${ESC}[49m  tests/a.test.ts > a > b${ESC}[39m`), ['tests/a.test.ts > a > b']);
  });

  it('gives [] for output it does not recognize, and for an empty string', () => {
    assert.deepEqual(extractFailingTests('everything fine\nTests: 3 passed'), []);
    assert.deepEqual(extractFailingTests(''), []);
  });

  it('lists a test once, in order of first appearance, at most 20 of them, each cut to 200 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => `not ok ${i + 1} - test ${i}`).join('\n');
    const ids = extractFailingTests(`${many}\nnot ok 31 - test 0`);
    assert.equal(ids.length, 20);
    assert.deepEqual(ids.slice(0, 3), ['test 0', 'test 1', 'test 2']);
    const long = extractFailingTests(`not ok 1 - ${'x'.repeat(500)}`);
    assert.equal(long[0]?.length, 200);
  });

  it('removes control characters from an ID', () => {
    assert.deepEqual(extractFailingTests(`not ok 1 - a${String.fromCharCode(7)}b`), ['ab']);
  });
});

describe('buildReproducer', () => {
  const base = { check: 'test', argv: ['node', '--test', 'test/unit/copy.test.ts'], exitCode: 1, output: 'not ok 1 - names the address\nsecret-looking output', changedSinceLastPass: ['src/b.ts', 'src/a.ts'] };

  it('gives the check, the joined command, the exit code, the output digest, the failing tests and the diff', () => {
    assert.deepEqual(buildReproducer(base), {
      check: 'test',
      command: 'node --test test/unit/copy.test.ts',
      exitCode: 1,
      outputDigest: `sha256:${sha256Hex(base.output)}`,
      failingTests: ['names the address'],
      diff: { paths: ['src/a.ts', 'src/b.ts'], digest: digestOf(['src/a.ts', 'src/b.ts']) },
    });
  });

  it('is valid without any test ID', () => {
    const reproducer = buildReproducer({ ...base, output: 'Error: cannot find module' });
    assert.deepEqual(reproducer.failingTests, []);
    assert.equal(reproducer.exitCode, 1);
  });

  it('never carries the output text: no field holds it, whole or in part', () => {
    const reproducer = buildReproducer(base);
    assert.deepEqual(Object.keys(reproducer).sort(), ['check', 'command', 'diff', 'exitCode', 'failingTests', 'outputDigest']);
    assert.ok(!JSON.stringify(reproducer).includes('secret-looking output'));
    assert.ok(!('output' in reproducer));
  });

  it('caps the diff paths at 20 but digests the whole sorted list, so a change past the cap changes the digest', () => {
    const paths = Array.from({ length: 25 }, (_, i) => `src/f${String(i).padStart(2, '0')}.ts`);
    const a = buildReproducer({ ...base, changedSinceLastPass: paths });
    const b = buildReproducer({ ...base, changedSinceLastPass: [...paths.slice(0, 24), 'src/z-last.ts'] });
    assert.equal(a.diff.paths.length, 20);
    assert.deepEqual(a.diff.paths, paths.slice(0, 20));
    assert.notEqual(a.diff.digest, b.diff.digest);
  });

  it('gives a deep-equal reproducer whatever order the changed paths arrive in, and counts a repeated path once', () => {
    const a = buildReproducer({ ...base, changedSinceLastPass: ['src/b.ts', 'src/a.ts', 'src/b.ts'] });
    const b = buildReproducer({ ...base, changedSinceLastPass: ['src/a.ts', 'src/b.ts'] });
    assert.deepEqual(a, b);
  });

  it('gives an empty diff a digest of the empty list, and a different output a different digest', () => {
    const empty = buildReproducer({ ...base, changedSinceLastPass: [] });
    assert.deepEqual(empty.diff, { paths: [], digest: digestOf([]) });
    assert.notEqual(buildReproducer({ ...base, output: 'other' }).outputDigest, buildReproducer(base).outputDigest);
  });

  it('cuts a very long command to a bounded length', () => {
    const reproducer = buildReproducer({ ...base, argv: ['node', 'x'.repeat(5000)] });
    assert.ok(reproducer.command.length <= 1000);
  });
});
