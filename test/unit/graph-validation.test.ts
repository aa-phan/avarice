// Plan 01-14 Task 2: validation of the code graph before it is installed or recorded (T-01-38). Pure functions
// over a parsed graph.json; every fixture is built inline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGraph, validateCodeGraph } from '../../src/domain/graph-validation.ts';

const HEAD = '4f2c9e1a8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e';

function graph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    directed: false,
    nodes: [
      { id: 'a', label: 'a', file_type: 'code', source_file: 'src/a.ts' },
      { id: 'b', label: 'b', file_type: 'code', source_file: 'src/b.ts' },
      { id: 'c', label: 'Config', file_type: 'concept' },
    ],
    links: [
      { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'b', target: 'c', relation: 'references', confidence: 'INFERRED' },
    ],
    built_at_commit: HEAD,
    ...overrides,
  };
}

function problems(value: unknown, head = HEAD): string[] {
  const v = validateCodeGraph(value, head);
  assert.equal(v.valid, false, 'expected the graph to be rejected');
  return v.valid ? [] : v.problems;
}

describe('validateCodeGraph', () => {
  it('accepts a code graph built at the staging HEAD and summarizes it', () => {
    const v = validateCodeGraph(graph(), HEAD);
    assert.equal(v.valid, true);
    if (!v.valid) return;
    assert.deepEqual(v.summary, {
      nodes: 3,
      edges: 2,
      nodesByFileType: { code: 2, concept: 1 },
      edgesByConfidence: { EXTRACTED: 1, INFERRED: 1 },
    });
  });

  it('accepts a staging HEAD written with the git: prefix, and a build commit in capitals', () => {
    assert.equal(validateCodeGraph(graph(), `git:${HEAD}`).valid, true);
    assert.equal(validateCodeGraph(graph({ built_at_commit: HEAD.toUpperCase() }), HEAD).valid, true);
  });

  it('accepts a graph whose edges are named edges rather than links, as the graph tool reads it', () => {
    const { links, ...rest } = graph();
    assert.equal(validateCodeGraph({ ...rest, edges: links }, HEAD).valid, true);
  });

  it('rejects anything that is not a JSON object', () => {
    for (const value of [null, undefined, 'text', 7, [], [graph()]]) {
      assert.match(problems(value).join(' '), /not a JSON object/);
    }
  });

  it('rejects a graph without a nodes array or without a links array', () => {
    const { nodes, ...noNodes } = graph();
    void nodes;
    assert.match(problems(noNodes).join(' '), /nodes/);
    const { links, ...noLinks } = graph();
    void links;
    assert.match(problems(noLinks).join(' '), /links/);
    assert.match(problems(graph({ nodes: { a: 1 } })).join(' '), /nodes/);
    assert.match(problems(graph({ links: 'none' })).join(' '), /links/);
  });

  it('rejects a build commit that is missing, short, not hexadecimal or not 40 characters', () => {
    const { built_at_commit: omitted, ...noCommit } = graph();
    void omitted;
    assert.match(problems(noCommit).join(' '), /built_at_commit/);
    for (const bad of ['4f2c9e1', 'g'.repeat(40), `${HEAD}0`, '', 42, null]) {
      assert.match(problems(graph({ built_at_commit: bad })).join(' '), /built_at_commit/, `value ${String(bad)}`);
    }
  });

  it('rejects a build commit that is not the staging HEAD, naming both', () => {
    const other = 'a'.repeat(40);
    const found = problems(graph({ built_at_commit: other })).join(' ');
    assert.ok(found.includes(other) && found.includes(HEAD), found);
  });

  it('rejects any document node: a code graph holds code and concept nodes only', () => {
    const withDocument = graph({ nodes: [...(graph()['nodes'] as unknown[]), { id: 'd1', file_type: 'document', source_file: 'docs/guide.md' }, { id: 'd2', file_type: 'document' }] });
    const found = problems(withDocument).join(' ');
    assert.match(found, /2 document node/);
    assert.ok(found.includes('d1'), 'it names a sample node');
  });

  it('rejects a node or an edge that is not an object', () => {
    assert.match(problems(graph({ nodes: [...(graph()['nodes'] as unknown[]), 'x'] })).join(' '), /node 3 is not an object/);
    assert.match(problems(graph({ links: [null] })).join(' '), /edge 0 is not an object/);
  });

  it('reports every problem at once', () => {
    const found = problems({ nodes: [{ id: 'd', file_type: 'document' }], links: [], built_at_commit: 'abc' });
    assert.ok(found.length >= 2, found.join(' | '));
  });
});

describe('summarizeGraph', () => {
  it('counts nodes by file_type and edges by confidence', () => {
    assert.deepEqual(summarizeGraph(graph()), { nodes: 3, edges: 2, nodesByFileType: { code: 2, concept: 1 }, edgesByConfidence: { EXTRACTED: 1, INFERRED: 1 } });
  });

  it('counts a node with no file_type and an edge with no confidence as unknown', () => {
    const summary = summarizeGraph({ nodes: [{ id: 'a' }, { id: 'b', file_type: 7 }], links: [{ source: 'a', target: 'b' }] });
    assert.deepEqual(summary.nodesByFileType, { unknown: 2 });
    assert.deepEqual(summary.edgesByConfidence, { unknown: 1 });
  });

  it('is empty for something that is not a graph', () => {
    assert.deepEqual(summarizeGraph(null), { nodes: 0, edges: 0, nodesByFileType: {}, edgesByConfidence: {} });
    assert.deepEqual(summarizeGraph({ nodes: 'x', links: 3 }), { nodes: 0, edges: 0, nodesByFileType: {}, edgesByConfidence: {} });
  });
});
