// Test inventory markers and comparison (AUT-9): a removed test ID, a new skip or focus marker and a lowered test
// file count are failures, measured by AVARICE after the invocation has ended.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SKIP_FOCUS_MARKERS, compareInventories, scanMarkers } from '../../src/domain/test-inventory.ts';
import type { InventorySnapshot } from '../../src/domain/test-inventory.ts';

function snapshot(over: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return { ids: ['a works', 'b works'], markers: {}, fileCount: 2, ...over };
}

describe('scanMarkers', () => {
  const cases: Array<[string, string]> = [
    ['.skip(', "it.skip('x', () => {});"],
    ['.only(', "it.only('x', () => {});"],
    ['xit(', "xit('x', () => {});"],
    ['xdescribe(', "xdescribe('x', () => {});"],
    ['xtest(', "xtest('x', () => {});"],
    ['it.todo(', "it.todo('x');"],
    ['test.todo(', "test.todo('x');"],
    ['describe.skip(', "describe.skip('x', () => {});"],
    ['{ skip: true }', "it('x', { skip: true }, () => {});"],
    ['{ only: true }', "it('x', { only: true }, () => {});"],
    ['@pytest.mark.skip', '@pytest.mark.skip(reason="x")\ndef test_x(): pass'],
    ['@unittest.skip', '@unittest.skip("x")\ndef test_x(self): pass'],
  ];
  for (const [name, text] of cases) {
    it(`finds ${name}`, () => {
      const hits = scanMarkers('t.test.ts', text);
      assert.ok(hits.length >= 1, `${name} not found`);
      assert.equal(hits[0]?.path, 't.test.ts');
    });
  }

  it('reports 1-based line numbers', () => {
    const hits = scanMarkers('t.test.ts', "import x from 'y';\n\nit('a', () => {});\nit.skip('b', () => {});\n");
    assert.deepEqual(hits.map((h) => h.line), [4]);
  });

  it('reports a marker inside a line comment (conservative)', () => {
    assert.equal(scanMarkers('t.test.ts', "// it.skip('x', () => {});").length, 1);
  });

  it('finds nothing in a clean file, or in an identifier that merely contains a marker word', () => {
    assert.deepEqual(scanMarkers('t.test.ts', "it('a', () => {});\nconst fixit = 1;\nconst xitems = [];\ntest('b', () => {});\n"), []);
  });

  it('finds nothing in empty text', () => {
    assert.deepEqual(scanMarkers('t.test.ts', ''), []);
  });

  it('exposes the marker list', () => {
    assert.ok(SKIP_FOCUS_MARKERS.length >= 10);
  });
});

describe('compareInventories', () => {
  it('reports a test ID present at base and missing after as removed-test', () => {
    const failures = compareInventories(snapshot(), snapshot({ ids: ['a works'] }));
    assert.deepEqual(failures.map((f) => f.rule), ['removed-test']);
    assert.match(failures[0]?.detail ?? '', /b works/);
  });

  it('reports a file whose marker count grew as new-skip-marker', () => {
    const failures = compareInventories(snapshot({ markers: { 'a.test.ts': 1 } }), snapshot({ markers: { 'a.test.ts': 2 } }));
    assert.deepEqual(failures.map((f) => f.rule), ['new-skip-marker']);
    assert.match(failures[0]?.detail ?? '', /a\.test\.ts/);
  });

  it('reports a marker in a file that had none as new-skip-marker', () => {
    assert.deepEqual(compareInventories(snapshot(), snapshot({ markers: { 'c.test.ts': 1 } })).map((f) => f.rule), ['new-skip-marker']);
  });

  it('reports fewer test files after as lowered-test-count', () => {
    assert.deepEqual(compareInventories(snapshot(), snapshot({ fileCount: 1 })).map((f) => f.rule), ['lowered-test-count']);
  });

  it('reports nothing for an added ID with an unchanged marker count', () => {
    const base = snapshot({ markers: { 'a.test.ts': 1 } });
    const after = snapshot({ ids: ['a works', 'b works', 'c works'], markers: { 'a.test.ts': 1 }, fileCount: 3 });
    assert.deepEqual(compareInventories(base, after), []);
  });

  it('allows a marker count to fall', () => {
    assert.deepEqual(compareInventories(snapshot({ markers: { 'a.test.ts': 2 } }), snapshot({ markers: { 'a.test.ts': 1 } })), []);
  });

  it('reports all three failure kinds together in a fixed order, whatever order the lists arrive in', () => {
    const base = snapshot({ ids: ['z', 'a'], markers: { 'b.test.ts': 0, 'a.test.ts': 0 }, fileCount: 3 });
    const after = snapshot({ ids: [], markers: { 'b.test.ts': 1, 'a.test.ts': 1 }, fileCount: 1 });
    const failures = compareInventories(base, after);
    assert.deepEqual(failures.map((f) => f.rule), ['removed-test', 'new-skip-marker', 'lowered-test-count']);
    const reversed = compareInventories({ ...base, ids: [...base.ids].reverse() }, after);
    assert.deepEqual(failures, reversed);
  });

  it('treats an empty base inventory as nothing to lose', () => {
    assert.deepEqual(compareInventories(snapshot({ ids: [], fileCount: 0 }), snapshot({ ids: [], fileCount: 0 })), []);
  });
});
