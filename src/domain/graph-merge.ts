// AVARICE's own merge of the code graph and the knowledge-pass graph (plan 01-18, ONB-14, S-45, owner decision
// 2026-11-01). graphify's own graph-merge command is a cross-repository merge: it prefixes every node ID and drops `built_at_commit`,
// which would sever every document-to-code edge, so it is not used. This is the union the skill's own Part C performs, in
// one ID space:
//   - nodes and edges are unioned by their unprefixed IDs; a code node wins an ID collision and the code graph is
//     copied as it is;
//   - every node and edge the knowledge pass adds is tagged `_avarice_origin: 'knowledge-pass'`, and a document node's
//     `source_file` is rewritten through the manifest to the real repository path, with `source_revision` set;
//   - `confidence` and `confidence_score` are kept. Nothing is ever raised. The one change is a lowering: the subagent
//     tags document edges EXTRACTED (spike S0-G, 16 of 21), which S-45 forbids for a model's claim, so an EXTRACTED edge
//     that touches a document node of the pass becomes INFERRED (score capped at 0.8) and says what it was;
//   - a deterministic `_origin: ast` edge that touches a document node of the pass is dropped and counted
//     (`astDocument`), as is an edge to an ID in neither graph (`dangling`); no node is created from an endpoint;
//   - `built_at_commit` is set to the onboarded revision.
// Pure: the inputs are not mutated.
import type { KnowledgeManifest, KnowledgeManifestEntry } from './knowledge-corpus.ts';

type Json = Record<string, unknown>;

export const KNOWLEDGE_ORIGIN = 'knowledge-pass';
// What a lowered EXTRACTED document edge gets as its score at most (graphify's own INFERRED default).
export const RETAGGED_SCORE_CAP = 0.8;

export interface MergeStats {
  codeNodes: number;
  // Nodes of the pass whose `file_type` is `document`.
  documentNodes: number;
  // Every node the pass added (documents, concepts, code mentioned in documents).
  knowledgeNodes: number;
  // Edges in the merged graph.
  edges: number;
  // Edges the skill graph held, before any was dropped.
  skillEdges: number;
  // Edges the pass added to the merged graph.
  knowledgeEdges: number;
  // Skill nodes left out because a node with their ID was already there.
  collided: number;
  // Document edges lowered from EXTRACTED to INFERRED.
  retagged: number;
  dropped: { dangling: number; astDocument: number; malformed: number };
}

export interface MergeInput {
  // The parsed code graph (`graph.json` of the code step).
  code: Json;
  // The parsed skill graph.
  docs: Json;
  manifest: KnowledgeManifest;
  // The onboarded revision, a full commit (with or without `git:`).
  onboardedRevision: string;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const bare = (revision: string): string => (revision.startsWith('git:') ? revision.slice('git:'.length) : revision);
const CORPUS_DIR = '.avarice-knowledge';

function listOf(doc: Json): unknown[] {
  const links = doc['links'] ?? doc['edges'];
  return Array.isArray(links) ? links : [];
}

// The manifest entry a skill `source_file` names, whichever way the skill spelled it: relative to the corpus root, with
// a leading `./`, as the staging-relative copy path, or as an absolute path through the corpus directory.
function entryFor(sourceFile: unknown, byCopy: ReadonlyMap<string, KnowledgeManifestEntry>): KnowledgeManifestEntry | undefined {
  if (typeof sourceFile !== 'string' || sourceFile === '') return undefined;
  let path = sourceFile;
  while (path.startsWith('./')) path = path.slice(2);
  if (path.startsWith('/')) {
    const at = path.indexOf(`/${CORPUS_DIR}/`);
    if (at === -1) return undefined;
    path = path.slice(at + 1);
  }
  return byCopy.get(path.startsWith(`${CORPUS_DIR}/`) ? path : `${CORPUS_DIR}/${path}`);
}

function endpoint(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isObject(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

export function mergeKnowledgeGraph(input: MergeInput): { graph: Json; stats: MergeStats } {
  const { code, docs, manifest } = input;
  const pin = bare(input.onboardedRevision);
  const byCopy = new Map(manifest.entries.map((e) => [e.copyPath, e] as const));

  const codeNodes = Array.isArray(code['nodes']) ? (code['nodes'] as unknown[]) : [];
  const codeEdges = listOf(code);
  const edgeKey = code['links'] === undefined && code['edges'] !== undefined ? 'edges' : 'links';
  const ids = new Set<string>();
  for (const node of codeNodes) if (isObject(node) && typeof node['id'] === 'string') ids.add(node['id']);

  const stats: MergeStats = {
    codeNodes: codeNodes.length,
    documentNodes: 0,
    knowledgeNodes: 0,
    edges: 0,
    skillEdges: 0,
    knowledgeEdges: 0,
    collided: 0,
    retagged: 0,
    dropped: { dangling: 0, astDocument: 0, malformed: 0 },
  };

  const added: Json[] = [];
  const documentIds = new Set<string>();
  for (const node of Array.isArray(docs['nodes']) ? (docs['nodes'] as unknown[]) : []) {
    if (!isObject(node) || typeof node['id'] !== 'string' || node['id'] === '') {
      stats.dropped.malformed += 1;
      continue;
    }
    const id = node['id'];
    if (ids.has(id)) {
      stats.collided += 1;
      continue;
    }
    const merged: Json = { ...node, _avarice_origin: KNOWLEDGE_ORIGIN };
    const entry = entryFor(node['source_file'], byCopy);
    if (entry !== undefined) {
      merged['source_file'] = entry.sourcePath;
      merged['source_revision'] = entry.revision;
    }
    added.push(merged);
    ids.add(id);
    if (node['file_type'] === 'document') documentIds.add(id);
  }
  stats.knowledgeNodes = added.length;
  stats.documentNodes = documentIds.size;

  const seen = new Set<string>();
  const key = (s: string, t: string, relation: unknown): string => `${s}\u0000${t}\u0000${typeof relation === 'string' ? relation : ''}`;
  for (const edge of codeEdges) {
    if (isObject(edge)) {
      const s = endpoint(edge['source']);
      const t = endpoint(edge['target']);
      if (s !== undefined && t !== undefined) seen.add(key(s, t, edge['relation']));
    }
  }
  const addedEdges: Json[] = [];
  const skillEdges = listOf(docs);
  stats.skillEdges = skillEdges.length;
  for (const edge of skillEdges) {
    if (!isObject(edge)) {
      stats.dropped.dangling += 1;
      continue;
    }
    const s = endpoint(edge['source']);
    const t = endpoint(edge['target']);
    if (s === undefined || t === undefined || !ids.has(s) || !ids.has(t)) {
      stats.dropped.dangling += 1;
      continue;
    }
    const touchesDocument = documentIds.has(s) || documentIds.has(t);
    if (edge['_origin'] === 'ast' && touchesDocument) {
      stats.dropped.astDocument += 1;
      continue;
    }
    const k = key(s, t, edge['relation']);
    if (seen.has(k)) continue;
    seen.add(k);
    const merged: Json = { ...edge, _avarice_origin: KNOWLEDGE_ORIGIN };
    if (touchesDocument && edge['confidence'] === 'EXTRACTED') {
      const score = typeof edge['confidence_score'] === 'number' ? edge['confidence_score'] : RETAGGED_SCORE_CAP;
      merged['confidence'] = 'INFERRED';
      merged['confidence_score'] = Math.min(score, RETAGGED_SCORE_CAP);
      merged['_avarice_retagged_from'] = 'EXTRACTED';
      stats.retagged += 1;
    }
    addedEdges.push(merged);
  }
  stats.knowledgeEdges = addedEdges.length;
  stats.edges = codeEdges.length + addedEdges.length;

  const graph: Json = {
    ...code,
    nodes: [...codeNodes, ...added],
    [edgeKey]: [...codeEdges, ...addedEdges],
    built_at_commit: pin,
  };
  return { graph, stats };
}
