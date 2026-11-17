// Plan 01-18 Task 2: AVARICE's own merge of the code graph and the knowledge-pass graph in one ID space
// (mergeKnowledgeGraph) and the validation of the merged graph (validateKnowledgeGraph). Pure; no files, no tools.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChangedPaths, mergeKnowledgeGraph, retainedKnowledge } from '../../src/domain/graph-merge.ts';
import { KNOWLEDGE_LIMITS, documentCoverage, validateKnowledgeGraph } from '../../src/domain/knowledge-validation.ts';
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

  it('accepts a node of the pass that comes from .planning/phases/ or STATE.md when the manifest holds it, and refuses one the manifest does not (plan 04-17, ONB-15)', () => {
    const { graph, stats } = mergedFixture();
    const g = clone(graph);
    nodesOf(g).push({ id: 'phase_plan', label: 'plan', file_type: 'document', source_file: '.planning/phases/01-x/01-01-PLAN.md', _avarice_origin: 'knowledge-pass', source_revision: REV });
    nodesOf(g).push({ id: 'state', label: 'state', file_type: 'document', source_file: '.planning/STATE.md', _avarice_origin: 'knowledge-pass', source_revision: REV });
    const manifest: KnowledgeManifest = { ...MANIFEST, entries: [...MANIFEST.entries, entry('.planning/phases/01-x/01-01-PLAN.md'), entry('.planning/STATE.md')] };
    assert.deepEqual(problemsOf(validateKnowledgeGraph(g, manifest, stats)), []);
    const problems = problemsOf(validateKnowledgeGraph(g, MANIFEST, stats)).join('\n');
    assert.match(problems, /phase_plan: source ".planning\/phases\/01-x\/01-01-PLAN.md" is not in the manifest/);
    assert.match(problems, /state: source ".planning\/STATE.md" is not in the manifest/);
  });

  // Found by the live exit rehearsal (plan 01-19): the real target tracks code under .planning/phases/ (contrast-check.mjs), so its
  // code graph holds 27 code nodes sourced from there. The rule is about what the knowledge pass may cite, not about the code graph.
  it('accepts a code-graph node sourced from .planning/phases/ (a tracked script), refuses a planning document there, and takes a knowledge-pass node only for a manifest document', () => {
    const { graph, stats } = mergedFixture();
    const g = clone(graph);
    nodesOf(g).push({ id: 'planning_phases_01_x_contrast_check_checkdoc', label: 'checkDoc', file_type: 'code', source_file: '.planning/phases/01-x/contrast-check.mjs' });
    assert.deepEqual(problemsOf(validate(g, stats)), [], 'a code node from a tracked file under .planning/phases/ is not a corpus node');
    const data = clone(graph);
    nodesOf(data).push({ id: 'planning_phases_01_x_data', label: 'data', file_type: 'code', source_file: '.planning/phases/01-x/fixtures.json' });
    assert.deepEqual(problemsOf(validate(data, stats)), [], 'a data or script file is not a planning document');
    const doc = clone(graph);
    nodesOf(doc).push({ id: 'planning_phases_01_x_plan', label: 'plan', file_type: 'code', source_file: '.planning/phases/01-x/01-01-PLAN.md' });
    assert.match(problemsOf(validate(doc, stats)).join('\n'), /planning_phases_01_x_plan.*\.planning\/phases/, 'a planning document is refused whatever the origin');
    const fromPass = clone(graph);
    nodesOf(fromPass).push({ id: 'phase_note', label: 'note', file_type: 'document', source_file: '.planning/phases/01-x/01-01-PLAN.md', _avarice_origin: 'knowledge-pass', source_revision: REV });
    const manifest: KnowledgeManifest = { ...MANIFEST, entries: [...MANIFEST.entries, entry('.planning/phases/01-x/01-01-PLAN.md')] };
    assert.deepEqual(problemsOf(validateKnowledgeGraph(fromPass, manifest, stats)), [], 'a phase document of the manifest is a corpus document since plan 04-17');
    const passData = clone(graph);
    nodesOf(passData).push({ id: 'phase_data', label: 'data', file_type: 'document', source_file: '.planning/phases/01-x/fixtures.json', _avarice_origin: 'knowledge-pass', source_revision: REV });
    assert.match(problemsOf(validateKnowledgeGraph(passData, MANIFEST, stats)).join('\n'), /phase_data: source ".*fixtures.json" is not in the manifest/, 'a file the manifest does not hold is refused for a node the pass added');
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

describe('validateKnowledgeGraph: the code graph does not hold .planning/STATE.md or phase documents (S-45, plan 04-17)', () => {
  it('refuses a node of the code graph sourced from STATE.md or from a document under .planning/phases', () => {
    const { graph, stats } = mergedFixture();
    for (const source of ['.planning/STATE.md', '.planning/phases/01-x/01-01-PLAN.md']) {
      const sourced = clone(graph);
      (byId(sourced, 'src_store_db') as Json)['source_file'] = source;
      assert.match(problemsOf(validate(sourced, stats)).join('\n'), /src_store_db: sourced from .*a planning document the code graph does not hold/, source);
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

describe('documentCoverage and the coverage rule (G-01-154, plan 01-25)', () => {
  const ALL = ['.planning/PROJECT.md', 'docs/decisions/ADR-001-storage.md', 'docs/guide.md'];
  const manifestOf = (paths: string[]): KnowledgeManifest => ({ ...MANIFEST, entries: paths.map(entry) });
  // A merge of document nodes for `covered` (and nothing else) against a manifest of `all`.
  function coverageMerge(all: string[], covered: string[]): { graph: Json; stats: ReturnType<typeof merge>['stats']; manifest: KnowledgeManifest } {
    const manifest = manifestOf(all);
    const docs = skill(covered.map((path) => docNode(`doc_${path.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`, path)), []);
    const { graph, stats } = mergeKnowledgeGraph({ code: codeGraph(), docs, manifest, onboardedRevision: PIN });
    return { graph, stats, manifest };
  }

  it('covers every manifest document that a document node of the pass cites, sorted, with none unread', () => {
    const { graph } = mergedFixture();
    assert.deepEqual(documentCoverage(graph, MANIFEST), { expected: 3, covered: [...ALL], unread: [] });
  });

  it('lists a document no node cites as unread, and counts a merged value without a nodes array as covering nothing', () => {
    const { graph, manifest } = coverageMerge(ALL, ['docs/guide.md']);
    assert.deepEqual(documentCoverage(graph, manifest), { expected: 3, covered: ['docs/guide.md'], unread: ['.planning/PROJECT.md', 'docs/decisions/ADR-001-storage.md'] });
    assert.deepEqual(documentCoverage({}, MANIFEST), { expected: 3, covered: [], unread: [...ALL] });
  });

  it('does not count a concept node, a code-graph node, a node citing a file outside the corpus, or a node that lost an ID collision', () => {
    const concept = merge(skill([{ id: 'concept_guide', label: 'Guide', file_type: 'concept', source_file: 'docs/guide.md' }], []));
    assert.deepEqual(documentCoverage(concept.graph, MANIFEST).covered, [], 'a concept node covers no document');

    const withCodeDocument = codeGraph();
    nodesOf(withCodeDocument).push(docNode('code_side_guide', 'docs/guide.md'));
    const fromCode = merge(skill([], []), withCodeDocument);
    assert.equal(byId(fromCode.graph, 'code_side_guide')?.['file_type'], 'document');
    assert.deepEqual(documentCoverage(fromCode.graph, MANIFEST).covered, [], 'a document node without the pass origin is the code graph, not the pass');

    const outside = merge(skill([docNode('docs_elsewhere', 'docs/elsewhere.md')], []));
    assert.deepEqual(documentCoverage(outside.graph, MANIFEST).covered, [], 'a node citing a file outside the manifest covers no manifest document');

    const collided = merge(skill([docNode('src_store_db', 'docs/guide.md')], []));
    assert.equal(collided.stats.collided, 1);
    assert.deepEqual(documentCoverage(collided.graph, MANIFEST).covered, [], 'a node that lost an ID collision was never added');
  });

  it('refuses fewer than half the documents, accepts exactly half, and says so in counts (4 documents)', () => {
    const four = [...ALL, 'docs/other.md'];
    const two = coverageMerge(four, ['docs/guide.md', 'docs/other.md']);
    assert.deepEqual(problemsOf(validateKnowledgeGraph(two.graph, two.manifest, two.stats)), [], '2 of 4 is exactly half and is accepted');
    const one = coverageMerge(four, ['docs/guide.md']);
    const problems = problemsOf(validateKnowledgeGraph(one.graph, one.manifest, one.stats)).join('\n');
    assert.match(problems, /1 of 4 corpus documents have a document node/);
    assert.match(problems, /3 unread/);
    assert.equal(problems.includes('docs/guide.md'), false, 'a problem names counts, never a path');
  });

  it('refuses 1 of 3 and accepts 2 of 3, and a valid result carries the coverage', () => {
    const one = coverageMerge(ALL, ['docs/guide.md']);
    assert.match(problemsOf(validateKnowledgeGraph(one.graph, one.manifest, one.stats)).join('\n'), /1 of 3 corpus documents have a document node/);
    const two = coverageMerge(ALL, ['docs/guide.md', '.planning/PROJECT.md']);
    const result = validateKnowledgeGraph(two.graph, two.manifest, two.stats);
    assert.ok(result.valid, problemsOf(result).join('; '));
    assert.deepEqual(result.coverage, { expected: 3, covered: ['.planning/PROJECT.md', 'docs/guide.md'], unread: ['docs/decisions/ADR-001-storage.md'] });
    assert.equal(KNOWLEDGE_LIMITS.documentShare, 0.5);
  });
});

// Plan 04-17 (ONB-11, D-11, spike S4-B): the code graph of an incremental refresh. The extraction is the whole tree's (a path-subset extraction loses the
// edges that leave the extracted set); mergeChangedPaths applies it against the previous graph and reports the node-level diff.
describe('mergeChangedPaths: the previous graph, a whole-tree extraction and the changed paths (ONB-11)', () => {
  const code = (id: string, file: string, extra: Json = {}): Json => ({ id, label: id, file_type: 'code', source_file: file, _origin: 'ast', ...extra });
  const rel = (source: string, target: string, relation = 'imports'): Json => ({ source, target, relation, confidence: 'EXTRACTED', confidence_score: 1, _origin: 'ast' });
  const graphOf = (nodes: Json[], links: Json[], extra: Json = {}): Json => ({ directed: false, multigraph: false, graph: {}, built_at_commit: PIN, nodes, links, ...extra });
  const react = (): Json => ({ id: 'ref_react', label: 'react', file_type: 'code' });

  // Three files: app.ts imports lib.ts and the external package `ref_react`; util.ts calls into lib.ts.
  const previous = (): Json =>
    graphOf(
      [code('app', 'src/app.ts', { community: 0 }), code('lib', 'src/lib.ts', { community: 0 }), code('util', 'src/util.ts', { community: 1 }), react()],
      [rel('app', 'lib'), rel('app', 'ref_react'), rel('util', 'lib', 'calls')],
    );
  const keysOf = (g: Json): string[] => linksOf(g).map((l) => `${l['source']}>${l['target']}:${l['relation']}`).sort();

  it('replaces the changed file\'s nodes and edges and keeps every edge that crosses the boundary, new ones included', () => {
    // app.ts now also imports util.ts and a new function calls into lib.ts: two new edges whose other end is outside the changed set.
    const extracted = graphOf(
      [code('app', 'src/app.ts', { community: 0 }), code('app_run', 'src/app.ts', { community: 0 }), code('lib', 'src/lib.ts', { community: 0 }), code('util', 'src/util.ts', { community: 1 }), react()],
      [rel('app', 'lib'), rel('app', 'ref_react'), rel('app', 'util'), rel('app_run', 'lib', 'calls'), rel('util', 'lib', 'calls')],
    );
    const { graph, delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.deepEqual(nodesOf(graph).map((n) => n['id']), ['app', 'app_run', 'lib', 'util', 'ref_react']);
    assert.deepEqual(keysOf(graph), ['app>lib:imports', 'app>ref_react:imports', 'app>util:imports', 'app_run>lib:calls', 'util>lib:calls']);
    assert.equal(delta.nodesAdded, 1);
    assert.equal(delta.nodesRemoved, 0);
    assert.equal(delta.edgesAdded, 2);
    assert.equal(delta.boundaryEdgesAdded, 2, 'both new edges leave the changed file');
    assert.equal(delta.boundaryEdgesRemoved, 0);
    assert.equal(delta.outside, 0);
    assert.equal(delta.nodesKept, 3, 'lib, util and ref_react are the previous graph\'s');
  });

  it('drops the edges that ended at a node of a changed file that is gone, from unchanged files too', () => {
    const extracted = graphOf([code('app', 'src/app.ts'), code('lib2', 'src/lib.ts'), code('util', 'src/util.ts'), react()], [rel('app', 'lib2'), rel('app', 'ref_react')]);
    const { graph, delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/lib.ts'], deletedPaths: [] });
    assert.deepEqual(keysOf(graph), ['app>lib2:imports', 'app>ref_react:imports'], 'the edges that ended at the old lib node are gone');
    assert.equal(delta.nodesRemoved, 1);
    assert.equal(delta.nodesAdded, 1);
    assert.equal(delta.edgesRemoved, 2, 'app>lib and util>lib ended at a node that no longer exists');
    assert.equal(delta.boundaryEdgesRemoved, 2);
  });

  it('removes the nodes of a deleted file and the edges that ended at them, and an external node nothing refers to any more', () => {
    const extracted = graphOf([code('app', 'src/app.ts'), code('util', 'src/util.ts')], [rel('app', 'util')]);
    const { graph, delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/lib.ts', 'src/app.ts'], deletedPaths: ['src/lib.ts'] });
    assert.deepEqual(nodesOf(graph).map((n) => n['id']), ['app', 'util']);
    assert.deepEqual(keysOf(graph), ['app>util:imports']);
    assert.equal(delta.nodesRemoved, 2, 'lib and ref_react');
    assert.equal(delta.outside, 0, 'ref_react has no file, so it is not a change outside the paths');
  });

  it('is the extraction: a file outside the changed paths whose nodes differ from the previous graph is reported, and the graph still follows the extraction', () => {
    const extracted = graphOf(
      [code('app', 'src/app.ts'), code('lib', 'src/lib.ts'), code('util', 'src/util.ts', { label: 'changed behind our back' }), react()],
      [rel('app', 'lib'), rel('app', 'ref_react'), rel('util', 'lib', 'calls')],
    );
    const { graph, delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.equal(byId(graph, 'util')?.['label'], 'changed behind our back');
    assert.equal(delta.outside, 1);
  });

  it('treats the clustering keys as derived: a node whose only difference is its community is unchanged', () => {
    const extracted = previous();
    for (const node of nodesOf(extracted)) if (node['community'] !== undefined) node['community'] = 7;
    const { delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.equal(delta.outside, 0);
    assert.equal(delta.nodesAdded + delta.nodesRemoved + delta.edgesAdded + delta.edgesRemoved, 0);
  });

  it('spells a path the way the graph does: a leading ./ and backslashes make no difference', () => {
    const extracted = graphOf([code('app', './src\\app.ts', { label: 'new' }), code('lib', 'src/lib.ts'), code('util', 'src/util.ts'), react()], [rel('app', 'lib'), rel('app', 'ref_react'), rel('util', 'lib', 'calls')]);
    const { delta } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.equal(delta.outside, 0);
  });

  it('does not mutate its inputs, repeats exactly and keeps the other keys of the extraction', () => {
    const prev = previous();
    const extracted = graphOf([code('app', 'src/app.ts')], [], { hyperedges: [{ id: 'h' }] });
    const before = JSON.stringify([prev, extracted]);
    const one = mergeChangedPaths({ previous: prev, extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    const two = mergeChangedPaths({ previous: prev, extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.equal(JSON.stringify([prev, extracted]), before);
    assert.deepEqual(one, two);
    assert.deepEqual(one.graph['hyperedges'], [{ id: 'h' }]);
    assert.equal(one.graph['built_at_commit'], PIN);
  });

  it('emits no duplicate node and no duplicate edge', () => {
    const extracted = graphOf([code('app', 'src/app.ts'), code('app', 'src/app.ts'), code('lib', 'src/lib.ts')], [rel('app', 'lib'), rel('app', 'lib')]);
    const { graph } = mergeChangedPaths({ previous: previous(), extracted, changedPaths: ['src/app.ts'], deletedPaths: [] });
    assert.deepEqual(nodesOf(graph).map((n) => n['id']), ['app', 'lib']);
    assert.equal(linksOf(graph).length, 1);
  });
});

// Plan 04-17 (ONB-15, S-47): the nodes of the documents a refresh does not extract again.
describe('retainedKnowledge: the document nodes of the unchanged documents (ONB-15)', () => {
  const pass = { _avarice_origin: 'knowledge-pass' };
  const document = (id: string, path: string, extra: Json = {}): Json => ({ id, label: id, file_type: 'document', source_file: path, source_revision: `git:${'a'.repeat(40)}`, ...pass, ...extra });
  const link = (source: string, target: string, extra: Json = {}): Json => ({ source, target, relation: 'documents', confidence: 'INFERRED', confidence_score: 0.7, ...pass, ...extra });
  const previous = (): Json => ({
    nodes: [
      { id: 'a', label: 'a', file_type: 'code', source_file: 'src/index.ts' },
      document('docs_guide', 'docs/guide.md', { community: 3, community_name: 'Community 3' }),
      document('docs_adr', 'docs/adr.md'),
      document('concept_state', 'docs/guide.md', { file_type: 'concept' }),
    ],
    links: [
      link('docs_guide', 'a', { source_file: 'docs/guide.md' }),
      link('docs_adr', 'a', { source_file: 'docs/adr.md' }),
      link('docs_guide', 'docs_adr'),
      link('docs_guide', 'gone_code'),
      link('concept_state', 'docs_guide'),
      { source: 'a', target: 'a', relation: 'calls', confidence: 'EXTRACTED' },
    ],
  });
  const keep = new Set(['docs/guide.md']);
  const code = new Set(['a']);

  it('keeps the pass\'s nodes that cite a kept document and the edges between them and the code graph, without the clustering keys', () => {
    const { nodes, edges } = retainedKnowledge(previous(), keep, code);
    assert.deepEqual(nodes.map((n) => n['id']), ['docs_guide', 'concept_state']);
    assert.equal(nodes[0]?.['community'], undefined);
    assert.equal(nodes[0]?.['community_name'], undefined);
    assert.equal(nodes[0]?.['source_file'], 'docs/guide.md');
    assert.deepEqual(edges.map((e) => `${e['source']}>${e['target']}`), ['docs_guide>a', 'concept_state>docs_guide']);
  });

  it('drops the edges of a changed document and an edge whose other end is a re-extracted document or a code node the new tree lacks, and counts the last two', () => {
    const { edges, droppedEdges } = retainedKnowledge(previous(), keep, code);
    assert.equal(edges.some((e) => e['source'] === 'docs_adr'), false, 'an edge found in a changed document goes');
    assert.equal(edges.some((e) => e['target'] === 'gone_code'), false, 'a code node the new tree lacks goes with its edge');
    assert.equal(droppedEdges, 2, 'docs_guide>docs_adr and docs_guide>gone_code');
  });

  it('keeps nothing when no document is kept, ignores a node or edge the pass did not add, and accepts the spellings a skill uses for a path', () => {
    assert.deepEqual(retainedKnowledge(previous(), new Set(), code), { nodes: [], edges: [], droppedEdges: 0 });
    const spelled: Json = {
      nodes: [document('x', './docs/guide.md'), document('y', '/work/staging/.avarice-knowledge/docs/guide.md'), { id: 'z', file_type: 'document', source_file: 'docs/guide.md' }],
      links: [link('x', 'y', { source_file: '.avarice-knowledge/docs/guide.md' }), { source: 'x', target: 'y', relation: 'documents' }],
    };
    const out = retainedKnowledge(spelled, keep, code);
    assert.deepEqual(out.nodes.map((n) => n['id']), ['x', 'y'], 'z carries no origin of the pass');
    assert.equal(out.edges.length, 1);
  });

  it('does not mutate the previous graph', () => {
    const prev = previous();
    const before = JSON.stringify(prev);
    retainedKnowledge(prev, keep, code);
    assert.equal(JSON.stringify(prev), before);
  });

  it('feeds mergeKnowledgeGraph: the kept document is re-stamped with the new manifest\'s revision and its edge reaches the new code graph', () => {
    const kept = retainedKnowledge(previous(), keep, new Set(['src_store_db']));
    const reached = retainedKnowledge({ ...previous(), links: [link('docs_guide', 'src_store_db', { source_file: 'docs/guide.md' })] }, keep, new Set(['src_store_db']));
    const manifest: KnowledgeManifest = { ...MANIFEST, entries: [entry('docs/guide.md')] };
    const { graph, stats } = mergeKnowledgeGraph({ code: codeGraph(), docs: { nodes: reached.nodes, links: reached.edges }, manifest, onboardedRevision: PIN });
    assert.equal(byId(graph, 'docs_guide')?.['source_revision'], REV);
    assert.equal(stats.dropped.dangling, 0);
    assert.ok(linksOf(graph).some((l) => l['source'] === 'docs_guide' && l['target'] === 'src_store_db'));
    assert.equal(kept.nodes.length, 2);
  });
});
