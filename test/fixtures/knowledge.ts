// Fixtures for the knowledge pass (plan 01-18): the documents committed into the scratch repository, and the
// `graph.json` the graphify skill leaves in `.avarice-knowledge/graphify-out/`, in the shape spike S0-G recorded
// (document, concept and code nodes with `source_file` relative to the corpus root and no `_origin` or
// `built_at_commit`; edges tagged EXTRACTED by the subagent even for documents).
import { INJECTION } from './index-fixtures.ts';

export { INJECTION };

export const ADR_001 = '# ADR-001: Storage\n\nStatus: accepted\n\nWe store state in SQLite, one database per profile. Reads go through the ledger port.\n';
export const ADR_002 = `# ADR-002: Hosting\n\nStatus: accepted\n\nThe service runs on one machine. ${INJECTION}. The ledger port stays the only writer.\n`;
export const GUIDE = '# Guide\n\nRun the tool with `avarice onboard`. See ADR-001 for where the state lives.\n';
export const PROJECT_MD = '# Project\n\nA small service that answers questions.\n';
export const STATE_MD = '---\nstatus: executing\n---\n# State\n\nVolatile.\n';
export const PHASE_PLAN = '# Plan 01\n\nVolatile phase plan.\n';

// Tracked documents of the knowledge scratch repository (plus the source files the code graph covers).
export const KNOWLEDGE_REPO_FILES: Readonly<Record<string, string>> = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export function answer(): number {\n  return helper();\n}\nexport function helper(): number {\n  return 42;\n}\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': GUIDE,
  'docs/decisions/ADR-001-storage.md': ADR_001,
  'docs/decisions/ADR-002-hosting.md': ADR_002,
  '.planning/PROJECT.md': PROJECT_MD,
  '.planning/STATE.md': STATE_MD,
  '.planning/phases/01-x/01-01-PLAN.md': PHASE_PLAN,
};

export const MAP_DOCUMENT_PATHS = ['STACK', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'INTEGRATIONS', 'CONCERNS'].map((name) => `.planning/codebase/${name}.md`);

// The documents the pass is expected to read in the integration repository (full map).
export const EXPECTED_CORPUS_PATHS: readonly string[] = [
  ...MAP_DOCUMENT_PATHS,
  '.planning/PROJECT.md',
  'docs/decisions/ADR-001-storage.md',
  'docs/decisions/ADR-002-hosting.md',
  'docs/guide.md',
].sort();

const idOf = (path: string): string => path.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export const documentId = idOf;

export interface SkillGraphOptions {
  // IDs of two nodes of the code graph (the fake graphify's are `a` and `b`).
  codeIds?: readonly [string, string];
}

type Json = Record<string, unknown>;

// What the skill writes for the fixture corpus: one document node per corpus file, a concept node and a code node,
// INFERRED and AMBIGUOUS document edges, one EXTRACTED document edge (the model tagged it), one `_origin: ast`
// document-structure edge, and one dangling edge among 16.
export function skillGraph(options: SkillGraphOptions = {}): Json {
  const [a, b] = options.codeIds ?? ['a', 'b'];
  const doc = (path: string, label: string): Json => ({ id: idOf(path), label, file_type: 'document', source_file: path, source_location: 'L1' });
  const adr1 = idOf('docs/decisions/ADR-001-storage.md');
  const adr2 = idOf('docs/decisions/ADR-002-hosting.md');
  const guide = idOf('docs/guide.md');
  const project = idOf('.planning/PROJECT.md');
  const stack = idOf('.planning/codebase/STACK.md');
  const arch = idOf('.planning/codebase/ARCHITECTURE.md');
  const structure = idOf('.planning/codebase/STRUCTURE.md');
  const testing = idOf('.planning/codebase/TESTING.md');
  const edge = (source: string, target: string, relation: string, confidence: string, score: number, extra: Json = {}): Json => ({
    source,
    target,
    relation,
    confidence,
    confidence_score: score,
    ...extra,
  });
  return {
    directed: false,
    multigraph: false,
    graph: {},
    nodes: [
      doc('docs/decisions/ADR-001-storage.md', 'ADR-001: Storage'),
      doc('docs/decisions/ADR-002-hosting.md', `ADR-002: Hosting (${INJECTION})`),
      doc('docs/guide.md', 'Guide'),
      doc('.planning/PROJECT.md', 'Project'),
      ...MAP_DOCUMENT_PATHS.map((path) => doc(path, path.replace(/^.*\//, '').replace(/\.md$/, ''))),
      { id: 'concept_sqlite_storage', label: 'SQLite storage', file_type: 'concept', source_file: 'docs/decisions/ADR-001-storage.md', source_location: 'L5' },
      { id: 'concept_ledger_port', label: 'Ledger port', file_type: 'concept', source_file: 'docs/decisions/ADR-001-storage.md', source_location: 'L5' },
    ],
    links: [
      edge(adr1, a, 'documents', 'INFERRED', 0.8),
      edge(adr1, 'concept_sqlite_storage', 'describes', 'INFERRED', 0.9),
      edge(adr2, adr1, 'relates_to', 'AMBIGUOUS', 0.2),
      edge(guide, b, 'documents', 'INFERRED', 0.7),
      edge(guide, adr1, 'cites', 'INFERRED', 0.75),
      edge(project, guide, 'relates_to', 'INFERRED', 0.6),
      edge(project, a, 'describes', 'INFERRED', 0.6),
      edge(stack, b, 'documents', 'INFERRED', 0.7),
      edge(arch, a, 'documents', 'INFERRED', 0.8),
      edge(structure, b, 'documents', 'INFERRED', 0.7),
      edge(arch, adr1, 'cites', 'INFERRED', 0.7),
      edge(adr2, guide, 'relates_to', 'AMBIGUOUS', 0.3),
      edge('concept_ledger_port', b, 'implemented_by', 'INFERRED', 0.6),
      // The subagent tagged this document edge EXTRACTED; AVARICE lowers it to INFERRED (S-45).
      edge(testing, a, 'references', 'EXTRACTED', 1),
      // Deterministic document structure (`_origin: ast`): dropped.
      edge(project, guide, 'contains', 'EXTRACTED', 1, { _origin: 'ast' }),
      // Dangling: `ghost_node` is in neither graph.
      edge(guide, 'ghost_node', 'cites', 'INFERRED', 0.5),
    ],
  };
}
