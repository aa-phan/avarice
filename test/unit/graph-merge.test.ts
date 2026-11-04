// Plan 01-18 Task 2: AVARICE's own merge of the code graph and the knowledge-pass graph in one ID space
// (mergeKnowledgeGraph) and the validation of the merged graph (validateKnowledgeGraph). Pure; no files, no tools.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeKnowledgeGraph } from '../../src/domain/graph-merge.ts';
import { KNOWLEDGE_LIMITS, validateKnowledgeGraph } from '../../src/domain/knowledge-validation.ts';
import type { KnowledgeManifest } from '../../src/domain/knowledge-corpus.ts';

type Json = Record<string, unknown>;
const PIN = 'b'.repeat(40);
const REV = `git:${PIN}`;

const entry = (sourcePath: string) => ({ copyPath: `.avarice-knowledge/${sourcePath}`, sourcePath, revision: REV, sha256: 'c'.repeat(64) });
const MANIFEST: KnowledgeManifest = {
  schema: 1,
  revision: REV,
  entries: ['docs/decisions/ADR-001-storage.md', 'docs/guide.md', '.planning/PROJECT.md'].map(entry),
  excluded: [],
};

function codeGraph(): Json {
  return {
    directed: false,
    multigraph: false,
    graph: {},
    built_at_commit: PIN,
    hyperedges: [{ id: 'h1' }],
    nodes: [
      { id: 'src_store_db', label: 'db', file_type: 'code', source_file: 'src/store/db.ts', _origin: 'ast' },
      { id: 'src_store_ledger', label: 'ledger', file_type: 'code', source_file: 'src/store/ledger.ts', _origin: 'ast' },
    ],
    links: [{ source: 'src_store_db', target: 'src_store_ledger', relation: 'imports', confidence: 'EXTRACTED', confidence_score: 1, _origin: 'ast' }],
  };
}

const docNode = (id: string, sourceFile: string, extra: Json = {}): Json => ({ id, label: id, file_type: 'document', source_file: sourceFile, ...extra });
const edge = (source: string, target: string, confidence: string, score: number, extra: Json = {}): Json => ({ source, target, relation: 'documents', confidence, confidence_score: score, ...extra });

function skill(nodes: Json[], links: Json[]): Json {
  return { directed: false, multigraph: false, nodes, links };
}

const merge = (docs: Json, code: Json = codeGraph()) => mergeKnowledgeGraph({ code, docs, manifest: MANIFEST, onboardedRevision: PIN });
const nodesOf = (g: Json): Json[] => g['nodes'] as Json[];
const linksOf = (g: Json): Json[] => g['links'] as Json[];
const byId = (g: Json, id: string): Json | undefined => nodesOf(g).find((n) => n['id'] === id);

describe('mergeKnowledgeGraph: one ID space, tiers kept (ONB-14, S-45)', () => {
  it('unions a document node with the code graph by unprefixed ID, keeps the edge with its tier and score, and rewrites provenance', () => {
    const docs = skill([docNode('docs_decisions_adr_001_storage', 'docs/decisions/ADR-001-storage.md')], [edge('docs_decisions_adr_001_storage', 'src_store_db', 'INFERRED', 0.8)]);
    const { graph, stats } = merge(docs);
    assert.deepEqual(nodesOf(graph).map((n) => n['id']).sort(), ['docs_decisions_adr_001_storage', 'src_store_db', 'src_store_ledger']);
    const document = byId(graph, 'docs_decisions_adr_001_storage');
    assert.ok(document);
    assert.equal(document['source_file'], 'docs/decisions/ADR-001-storage.md');
    assert.equal(document['source_revision'], REV);
    assert.equal(document['_avarice_origin'], 'knowledge-pass');
    assert.equal(graph['built_at_commit'], PIN);
    const joined = linksOf(graph).find((l) => l['source'] === 'docs_decisions_adr_001_storage');
    assert.ok(joined);
    assert.equal(joined['target'], 'src_store_db', 'the edge joins the code node, not a prefixed copy');
    assert.equal(joined['confidence'], 'INFERRED');
    assert.equal(joined['confidence_score'], 0.8);
    assert.deepEqual({ codeNodes: stats.codeNodes, documentNodes: stats.documentNodes, edges: stats.edges }, { codeNodes: 2, documentNodes: 1, edges: 2 });
    assert.equal(nodesOf(graph).some((n) => String(n['id']).includes('::')), false, 'no prefixed IDs');
  });

  it('drops an edge to an ID in neither graph, counts it, and creates no node for it', () => {
    const docs = skill([docNode('docs_guide', 'docs/guide.md')], [edge('docs_guide', 'ghost', 'INFERRED', 0.5), edge('ghost2', 'docs_guide', 'INFERRED', 0.5), edge('docs_guide', 'src_store_db', 'INFERRED', 0.6)]);
    const { graph, stats } = merge(docs);
    assert.equal(stats.dropped.dangling, 2);
    assert.equal(byId(graph, 'ghost'), undefined);
    assert.equal(byId(graph, 'ghost2'), undefined);
    assert.equal(linksOf(graph).length, 2, 'the code edge and the one live edge');
    assert.equal(stats.skillEdges, 3);
  });

  it('drops a deterministic `_origin: ast` edge that touches a document node and counts it, changing no other edge', () => {
    const docs = skill(
      [docNode('docs_guide', 'docs/guide.md'), docNode('planning_project', '.planning/PROJECT.md')],
      [
        edge('planning_project', 'docs_guide', 'EXTRACTED', 1, { relation: 'contains', _origin: 'ast' }),
        edge('planning_project', 'docs_guide', 'INFERRED', 0.7),
        edge('docs_guide', 'src_store_db', 'AMBIGUOUS', 0.2),
      ],
    );
    const { graph, stats } = merge(docs);
    assert.equal(stats.dropped.astDocument, 1);
    const kept = linksOf(graph).filter((l) => l['source'] !== 'src_store_db');
    assert.deepEqual(kept.map((l) => [l['source'], l['target'], l['confidence'], l['confidence_score']]), [
      ['planning_project', 'docs_guide', 'INFERRED', 0.7],
      ['docs_guide', 'src_store_db', 'AMBIGUOUS', 0.2],
    ]);
  });

  it('never upgrades a tier: INFERRED and AMBIGUOUS stay as written, and a document edge labelled EXTRACTED is lowered to INFERRED and marked', () => {
    const docs = skill(
      [docNode('docs_guide', 'docs/guide.md')],
      [edge('docs_guide', 'src_store_db', 'EXTRACTED', 1), edge('docs_guide', 'src_store_ledger', 'AMBIGUOUS', 0.3), edge('src_store_db', 'docs_guide', 'INFERRED', 0.55)],
    );
    const { graph, stats } = merge(docs);
    const tiers = linksOf(graph).filter((l) => l['_avarice_origin'] === 'knowledge-pass').map((l) => [l['target'] ?? '', l['confidence'], l['confidence_score']]);
    assert.deepEqual(tiers.sort(), [
      ['docs_guide', 'INFERRED', 0.55],
      ['src_store_db', 'INFERRED', 0.8],
      ['src_store_ledger', 'AMBIGUOUS', 0.3],
    ]);
    const lowered = linksOf(graph).find((l) => l['_avarice_retagged_from'] === 'EXTRACTED');
    assert.ok(lowered, 'the lowered edge says what it was');
    assert.equal(stats.retagged, 1);
    for (const l of linksOf(graph)) assert.notEqual(l['_avarice_origin'] === 'knowledge-pass' && l['confidence'] === 'EXTRACTED', true, 'no knowledge-pass edge is EXTRACTED');
  });

  it('leaves the code graph exactly as it was, and lets a code node win an ID collision', () => {
    const before = JSON.stringify(codeGraph());
    const docs = skill([{ id: 'src_store_db', label: 'imposter', file_type: 'document', source_file: 'docs/guide.md' }, docNode('docs_guide', 'docs/guide.md')], [edge('docs_guide', 'src_store_db', 'INFERRED', 0.6)]);
    const code = codeGraph();
    const { graph, stats } = merge(docs, code);
    assert.equal(JSON.stringify(code), before, 'the input is not mutated');
    const winner = byId(graph, 'src_store_db');
    assert.equal(winner?.['label'], 'db');
    assert.equal(winner?.['file_type'], 'code');
    assert.equal(winner?.['_avarice_origin'], undefined);
    assert.equal(stats.collided, 1);
    assert.deepEqual(nodesOf(graph).slice(0, 2), (code['nodes'] as Json[]), 'code nodes come first, untouched');
    assert.deepEqual(graph['hyperedges'], [{ id: 'h1' }], 'other top-level keys of the code graph are kept');
  });

  it('stamps built_at_commit with the onboarded revision whatever the code graph carried, with or without the git: prefix', () => {
    const noCommit = codeGraph();
    delete noCommit['built_at_commit'];
    assert.equal(merge(skill([docNode('docs_guide', 'docs/guide.md')], []), noCommit).graph['built_at_commit'], PIN);
    const stale = { ...codeGraph(), built_at_commit: 'f'.repeat(40) };
    assert.equal(merge(skill([docNode('docs_guide', 'docs/guide.md')], []), stale).graph['built_at_commit'], PIN);
    const prefixed = mergeKnowledgeGraph({ code: noCommit, docs: skill([docNode('docs_guide', 'docs/guide.md')], []), manifest: MANIFEST, onboardedRevision: REV });
    assert.equal(prefixed.graph['built_at_commit'], PIN);
  });

  it('rewrites `source_file` whichever way the skill spelled it, through the manifest, and leaves an unknown source for validation to refuse', () => {
    const docs = skill(
      [
        docNode('n1', './docs/guide.md'),
        docNode('n2', '.avarice-knowledge/docs/guide.md'),
        docNode('n3', '/tmp/x/staging/.avarice-knowledge/.planning/PROJECT.md'),
        docNode('n4', 'docs/unknown.md'),
        { id: 'n5', label: 'no source', file_type: 'concept' },
      ],
      [],
    );
    const { graph } = merge(docs);
    assert.deepEqual(['n1', 'n2', 'n3', 'n4'].map((id) => byId(graph, id)?.['source_file']), ['docs/guide.md', 'docs/guide.md', '.planning/PROJECT.md', 'docs/unknown.md']);
    assert.equal(byId(graph, 'n4')?.['source_revision'], undefined, 'no revision is claimed for a source the manifest does not know');
    assert.equal(byId(graph, 'n5')?.['source_revision'], undefined);
  });

  it('counts a node without a string id as malformed and an edge with no endpoints as dangling, instead of failing', () => {
    const docs = skill([docNode('docs_guide', 'docs/guide.md'), { label: 'no id' } as Json, 7 as unknown as Json], [{ relation: 'x' } as Json, 'junk' as unknown as Json]);
    const { graph, stats } = merge(docs);
    assert.equal(stats.dropped.malformed, 2);
    assert.equal(stats.dropped.dangling, 2);
    assert.equal(nodesOf(graph).length, 3);
  });
});

function mergedFixture(): { graph: Json; stats: ReturnType<typeof merge>['stats'] } {
  const docs = skill(
    [docNode('docs_guide', 'docs/guide.md'), docNode('docs_decisions_adr_001_storage', 'docs/decisions/ADR-001-storage.md'), docNode('planning_project', '.planning/PROJECT.md')],
    [
      edge('docs_guide', 'src_store_db', 'INFERRED', 0.7),
      edge('docs_guide', 'docs_decisions_adr_001_storage', 'INFERRED', 0.7),
      edge('planning_project', 'docs_guide', 'AMBIGUOUS', 0.3),
      edge('planning_project', 'src_store_ledger', 'INFERRED', 0.6),
      edge('docs_decisions_adr_001_storage', 'src_store_db', 'INFERRED', 0.9),
      edge('docs_guide', 'planning_project', 'INFERRED', 0.5),
      edge('src_store_db', 'planning_project', 'INFERRED', 0.5),
      edge('src_store_ledger', 'docs_guide', 'INFERRED', 0.5),
      edge('src_store_ledger', 'docs_decisions_adr_001_storage', 'INFERRED', 0.5),
      edge('docs_decisions_adr_001_storage', 'planning_project', 'INFERRED', 0.5),
    ],
  );
  return merge(docs);
}

const validate = (graph: unknown, stats = mergedFixture().stats) => validateKnowledgeGraph(graph, MANIFEST, stats);
const problemsOf = (result: ReturnType<typeof validate>): string[] => (result.valid ? [] : result.problems);

function clone(graph: Json): Json {
  return JSON.parse(JSON.stringify(graph)) as Json;
}

describe('validateKnowledgeGraph (docs/repository-onboarding.md "Validation", Document nodes)', () => {
  it('accepts a merge of cited document nodes on INFERRED and AMBIGUOUS edges and summarizes it', () => {
    const { graph, stats } = mergedFixture();
    const result = validateKnowledgeGraph(graph, MANIFEST, stats);
    assert.deepEqual(problemsOf(result), []);
    assert.ok(result.valid);
    assert.equal(result.summary.nodesByFileType['document'], 3);
    assert.equal(KNOWLEDGE_LIMITS.nodeTextBytes, 2048);
    assert.equal(KNOWLEDGE_LIMITS.danglingShare, 0.1);
  });

  it('refuses a knowledge-pass node whose source is not in the manifest, or that cites no or another revision', () => {
    const { graph, stats } = mergedFixture();
    const unknown = clone(graph);
    (byId(unknown, 'docs_guide') as Json)['source_file'] = 'docs/elsewhere.md';
    assert.match(problemsOf(validate(unknown, stats)).join('\n'), /docs_guide.*not in the manifest/);
    const norev = clone(graph);
    delete (byId(norev, 'docs_guide') as Json)['source_revision'];
    assert.match(problemsOf(validate(norev, stats)).join('\n'), /docs_guide.*revision/);
    const other = clone(graph);
    (byId(other, 'docs_guide') as Json)['source_revision'] = `git:${'d'.repeat(40)}`;
    assert.match(problemsOf(validate(other, stats)).join('\n'), /docs_guide.*revision/);
  });

  it('refuses node text above 2 KiB and accepts exactly 2 KiB', () => {
    const { graph, stats } = mergedFixture();
    const big = clone(graph);
    (byId(big, 'docs_guide') as Json)['label'] = 'x'.repeat(KNOWLEDGE_LIMITS.nodeTextBytes + 1);
    assert.match(problemsOf(validate(big, stats)).join('\n'), /docs_guide.*2048/);
    const edge2k = clone(graph);
    const node = byId(edge2k, 'docs_guide') as Json;
    const others = Object.entries(node).filter(([k, v]) => typeof v === 'string' && k !== 'label').reduce((n, [, v]) => n + Buffer.byteLength(v as string, 'utf8'), 0);
    node['label'] = 'x'.repeat(KNOWLEDGE_LIMITS.nodeTextBytes - others);
    assert.deepEqual(problemsOf(validate(edge2k, stats)), []);
  });

  it('refuses a secret pattern anywhere in the merged JSON, naming the pattern and never the text', () => {
    const { graph, stats } = mergedFixture();
    const leaked = clone(graph);
    (byId(leaked, 'docs_guide') as Json)['label'] = `token ghp_${'a'.repeat(36)}`;
    const problems = problemsOf(validate(leaked, stats)).join('\n');
    assert.match(problems, /secret/i);
    assert.equal(problems.includes('ghp_'), false, 'the matched text is not repeated');
    const inCode = clone(graph);
    (byId(inCode, 'src_store_db') as Json)['label'] = `AKIA${'A'.repeat(16)}`;
    assert.match(problemsOf(validate(inCode, stats)).join('\n'), /secret/i, 'the whole graph is scanned, not only the knowledge-pass nodes');
  });

  it('refuses an EXTRACTED edge that touches a knowledge-pass document node, whichever end it is', () => {
    const { graph, stats } = mergedFixture();
    for (const [source, target] of [['docs_guide', 'src_store_db'], ['src_store_ledger', 'docs_guide']] as const) {
      const g = clone(graph);
      linksOf(g).push(edge(source, target, 'EXTRACTED', 1, { _avarice_origin: 'knowledge-pass' }));
      assert.match(problemsOf(validate(g, stats)).join('\n'), /EXTRACTED.*document/);
    }
    // A deterministic code edge between code nodes may stay EXTRACTED.
    assert.deepEqual(problemsOf(validate(graph, stats)), []);
  });

  it('refuses a node that comes from .planning/phases/ or STATE.md, whatever the manifest says', () => {
    const { graph, stats } = mergedFixture();
    const g = clone(graph);
    nodesOf(g).push({ id: 'phase_plan', label: 'plan', file_type: 'document', source_file: '.planning/phases/01-x/01-01-PLAN.md', _avarice_origin: 'knowledge-pass', source_revision: REV });
    const manifest: KnowledgeManifest = { ...MANIFEST, entries: [...MANIFEST.entries, entry('.planning/phases/01-x/01-01-PLAN.md')] };
    assert.match(problemsOf(validateKnowledgeGraph(g, manifest, stats)).join('\n'), /phase_plan.*\.planning\/phases/);
  });

  // Found by the live exit rehearsal (plan 01-19): the real target tracks code under .planning/phases/ (contrast-check.mjs), so its
  // code graph holds 27 code nodes sourced from there. The rule is about what the knowledge pass may cite, not about the code graph.
  it('accepts a code-graph node sourced from .planning/phases/ (a tracked script), and still refuses a knowledge-pass node from there', () => {
    const { graph, stats } = mergedFixture();
    const g = clone(graph);
    nodesOf(g).push({ id: 'planning_phases_01_x_contrast_check_checkdoc', label: 'checkDoc', file_type: 'code', source_file: '.planning/phases/01-x/contrast-check.mjs' });
    assert.deepEqual(problemsOf(validate(g, stats)), [], 'a code node from a tracked file under .planning/phases/ is not a corpus node');
    const state = clone(graph);
    nodesOf(state).push({ id: 'state_script', label: 'run', file_type: 'code', source_file: '.planning/STATE.md' });
    assert.deepEqual(problemsOf(validate(state, stats)), [], 'the origin decides, not the file name');
    const fromPass = clone(graph);
    nodesOf(fromPass).push({ id: 'phase_note', label: 'note', file_type: 'document', source_file: '.planning/phases/01-x/01-01-PLAN.md', _avarice_origin: 'knowledge-pass', source_revision: REV });
    const manifest: KnowledgeManifest = { ...MANIFEST, entries: [...MANIFEST.entries, entry('.planning/phases/01-x/01-01-PLAN.md')] };
    assert.match(problemsOf(validateKnowledgeGraph(fromPass, manifest, stats)).join('\n'), /phase_note.*\.planning\/phases/);
  });

  it('refuses a dangling share above 10 percent, accepts exactly 10, and counts against the edges the pass produced', () => {
    const { graph } = mergedFixture();
    const base = mergedFixture().stats;
    const ten = { ...base, skillEdges: 20, dropped: { ...base.dropped, dangling: 2 } };
    assert.deepEqual(problemsOf(validateKnowledgeGraph(graph, MANIFEST, ten)), []);
    const eleven = { ...base, skillEdges: 20, dropped: { ...base.dropped, dangling: 3 } };
    assert.match(problemsOf(validateKnowledgeGraph(graph, MANIFEST, eleven)).join('\n'), /dangling/);
  });

  it('refuses a graph with no document node, a wrong build commit, or a shape that is not a graph', () => {
    const { graph, stats } = mergedFixture();
    const wrong = clone(graph);
    wrong['built_at_commit'] = 'e'.repeat(40);
    assert.match(problemsOf(validate(wrong, stats)).join('\n'), /built_at_commit/);
    const missing = clone(graph);
    delete missing['built_at_commit'];
    assert.match(problemsOf(validate(missing, stats)).join('\n'), /built_at_commit/);
    const bare = mergeKnowledgeGraph({ code: codeGraph(), docs: skill([], []), manifest: MANIFEST, onboardedRevision: PIN });
    assert.match(problemsOf(validate(bare.graph, bare.stats)).join('\n'), /no document node/);
    for (const junk of [null, 'x', [], { nodes: 1 }]) assert.equal(validate(junk, stats).valid, false);
  });
});

describe('validateKnowledgeGraph: the corpus never holds .planning/STATE.md or phase files (S-45)', () => {
  it('refuses a node sourced from STATE.md or from .planning/phases, whatever its origin', () => {
    const { graph, stats } = mergedFixture();
    for (const source of ['.planning/STATE.md', '.planning/phases/01-x/01-01-PLAN.md']) {
      const sourced = clone(graph);
      (byId(sourced, 'src_store_db') as Json)['source_file'] = source;
      assert.match(problemsOf(validate(sourced, stats)).join('\n'), /src_store_db: sourced from .*which the corpus never holds/, source);
    }
  });
});

// MF-03 (01-MUTATION.md, fixed in 01-20): the cap of docs/repository-onboarding.md "Validation" is on "each node's text", so every string
// value of a knowledge-pass node counts, whatever its depth, in the same way the flat fields did. Object keys are names, not text, and are
// not counted. The code did not distinguish structural ids from text before (id, source_file and the like were already counted at the top
// level), so the rule stays "all string values".
describe('MF-03: nested node text and the 2 KiB cap', () => {
  const cap = KNOWLEDGE_LIMITS.nodeTextBytes;
  const problemFor = (mutate: (node: Json) => void): string => {
    const { graph, stats } = mergedFixture();
    const copy = clone(graph);
    mutate(byId(copy, 'docs_guide') as Json);
    return problemsOf(validate(copy, stats)).join('\n');
  };

  it('counts text held in a nested field of a document node toward the cap', () => {
    assert.match(problemFor((node) => (node['notes'] = ['x'.repeat(cap + 1)])), /docs_guide.*2048/);
    assert.match(problemFor((node) => (node['notes'] = { summary: { text: 'x'.repeat(cap + 1) } })), /docs_guide.*2048/);
  });

  it('adds the strings of an array and of several levels to one total', () => {
    const half = 'y'.repeat(cap / 2);
    assert.match(problemFor((node) => (node['notes'] = [half, [half, { deep: 'z' }]])), /docs_guide: text is \d+ bytes, above the 2048 limit/);
  });

  it('counts bytes, not characters, in a nested string', () => {
    assert.match(problemFor((node) => (node['notes'] = ['é'.repeat(cap / 2 + 1)])), /docs_guide.*2048/);
  });

  it('does not count object keys, numbers or nested text under the cap', () => {
    assert.equal(problemFor((node) => (node['notes'] = { ['k'.repeat(cap + 1)]: 1, count: 12345, flag: true, none: null, tags: ['a', 'b'] })), '');
  });
});
