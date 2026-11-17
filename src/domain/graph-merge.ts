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

// ---------------------------------------------------------------------------------------------------------
// The code graph of an incremental refresh (plan 04-17, ONB-11, D-11, spike S4-B)
// ---------------------------------------------------------------------------------------------------------
//
// The spike measured that a path-subset extraction cannot give a changed file's edges to files outside the subset (4 of 1261 edges were missing after
// one changed file), and that a whole-tree code-only extraction is deterministic and costs 1.5 s on 157 files. So the refresh extracts the whole tree
// with the same invocation as a full build and this function applies it against the previous graph: the nodes and edges of the changed and deleted
// files come from the extraction, the ones of every other file are the previous graph's, and the node-level diff says what moved. The merged graph is
// therefore the extraction; what this adds is the proof that the change is confined to the changed paths (`outside`) and the delta the step records.
// `graphify update` is never involved.

// Keys graphify's clustering derives from the whole graph: a node whose only difference is one of these has not changed.
const DERIVED_KEYS: ReadonlySet<string> = new Set(['community', 'community_name']);

export interface ChangedPathsInput {
  // The previous code graph (parsed `code-graph.json`).
  previous: Json;
  // The whole-tree code-only extraction of the new tree.
  extracted: Json;
  // Every path that differs between the two revisions (a deleted path included), repository-relative.
  changedPaths: readonly string[];
  // The changed paths that no longer exist.
  deletedPaths: readonly string[];
}

export interface ChangedPathsDelta {
  nodesAdded: number;
  nodesRemoved: number;
  // Same ID, different content.
  nodesChanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  // Added or removed edges that touch a changed file and have one end outside the changed files: the edges a path-subset extraction cannot see.
  boundaryEdgesAdded: number;
  boundaryEdgesRemoved: number;
  // Nodes of files outside the changed paths that the new graph has exactly as the previous one did, external nodes included.
  nodesKept: number;
  // Differences that lie outside the changed paths: nodes of other files added, removed or changed, and edges that touch no changed file. Zero when the
  // previous graph is the graph of the revision the changed paths were measured from.
  outside: number;
}

const normalizePath = (path: string): string => {
  let out = path.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  return out;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => !DERIVED_KEYS.has(key))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const fileOf = (node: Json | undefined): string | undefined => (node !== undefined && typeof node['source_file'] === 'string' && node['source_file'] !== '' ? normalizePath(node['source_file']) : undefined);
const edgeKeyOf = (s: string, t: string, relation: unknown): string => `${s}\u0000${t}\u0000${typeof relation === 'string' ? relation : ''}`;

interface Indexed {
  nodes: Map<string, Json>;
  edges: Map<string, { edge: Json; source: string; target: string }>;
}

// Nodes by ID and edges by `source, target, relation`; the first of a duplicate is kept, a malformed entry is left out.
function indexOf(doc: Json): Indexed {
  const nodes = new Map<string, Json>();
  for (const node of Array.isArray(doc['nodes']) ? (doc['nodes'] as unknown[]) : []) {
    if (isObject(node) && typeof node['id'] === 'string' && !nodes.has(node['id'])) nodes.set(node['id'], node);
  }
  const edges = new Map<string, { edge: Json; source: string; target: string }>();
  for (const edge of listOf(doc)) {
    if (!isObject(edge)) continue;
    const source = endpoint(edge['source']);
    const target = endpoint(edge['target']);
    if (source === undefined || target === undefined) continue;
    const key = edgeKeyOf(source, target, edge['relation']);
    if (!edges.has(key)) edges.set(key, { edge, source, target });
  }
  return { nodes, edges };
}

export function mergeChangedPaths(input: ChangedPathsInput): { graph: Json; delta: ChangedPathsDelta } {
  const changed = new Set([...input.changedPaths, ...input.deletedPaths].map(normalizePath));
  const before = indexOf(input.previous);
  const after = indexOf(input.extracted);
  const inChanged = (file: string | undefined): boolean => file !== undefined && changed.has(file);

  const delta: ChangedPathsDelta = { nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0, boundaryEdgesAdded: 0, boundaryEdgesRemoved: 0, nodesKept: 0, outside: 0 };

  // A difference of a node counts as outside when the file it belongs to is not a changed one; a node with no file (an external package) is never outside.
  const outsideNode = (node: Json): boolean => {
    const file = fileOf(node);
    return file !== undefined && !changed.has(file);
  };
  for (const [id, node] of after.nodes) {
    const was = before.nodes.get(id);
    if (was === undefined) {
      delta.nodesAdded += 1;
      if (outsideNode(node)) delta.outside += 1;
    } else if (stable(was) !== stable(node)) {
      delta.nodesChanged += 1;
      if (outsideNode(node) || outsideNode(was)) delta.outside += 1;
    } else if (!inChanged(fileOf(node))) {
      delta.nodesKept += 1;
    }
  }
  for (const [id, node] of before.nodes) {
    if (after.nodes.has(id)) continue;
    delta.nodesRemoved += 1;
    if (outsideNode(node)) delta.outside += 1;
  }

  // An edge touches a changed file through either end or through the file it was found in. It is a boundary edge when an end is not in a changed file.
  const touches = (entry: { edge: Json; source: string; target: string }, nodes: Map<string, Json>): { touches: boolean; boundary: boolean } => {
    const ends = [entry.source, entry.target].map((id) => fileOf(nodes.get(id)));
    const own = typeof entry.edge['source_file'] === 'string' ? normalizePath(entry.edge['source_file']) : undefined;
    const touchesChanged = ends.some(inChanged) || inChanged(own);
    return { touches: touchesChanged, boundary: touchesChanged && ends.some((file) => !inChanged(file)) };
  };
  for (const [key, entry] of after.edges) {
    const was = before.edges.get(key);
    if (was !== undefined) continue;
    delta.edgesAdded += 1;
    const at = touches(entry, after.nodes);
    if (at.boundary) delta.boundaryEdgesAdded += 1;
    if (!at.touches) delta.outside += 1;
  }
  for (const [key, entry] of before.edges) {
    if (after.edges.has(key)) continue;
    delta.edgesRemoved += 1;
    const at = touches(entry, before.nodes);
    if (at.boundary) delta.boundaryEdgesRemoved += 1;
    if (!at.touches) delta.outside += 1;
  }

  const edgeKey = input.extracted['links'] === undefined && input.extracted['edges'] !== undefined ? 'edges' : 'links';
  const graph: Json = { ...input.extracted, nodes: [...after.nodes.values()], [edgeKey]: [...after.edges.values()].map((entry) => entry.edge) };
  return { graph, delta };
}

// ---------------------------------------------------------------------------------------------------------
// The document nodes a knowledge refresh keeps (plan 04-17, ONB-15, S-47)
// ---------------------------------------------------------------------------------------------------------
//
// A refresh extracts only the documents whose content changed. The nodes the earlier pass made for every other document are kept: the nodes and edges of the
// previous merged graph that carry the pass's origin and cite one of `keep` (repository paths of the unchanged documents). They are returned as a skill graph's
// parts, so that mergeKnowledgeGraph treats them like the pass's own (it rewrites their source revision through the new manifest, lowers nothing that is
// already INFERRED, and drops a node whose ID the code graph has). An edge is kept when both ends are kept nodes or nodes of the new code graph (`codeIds`), so a
// document's edge to a code node the new tree no longer has goes quietly with it instead of counting as a dangling edge of the pass, and when the file it was
// found in, if it names one, is a kept document. The clustering keys are dropped: they are derived from the whole graph and recomputed.
export interface RetainedKnowledge {
  nodes: Json[];
  edges: Json[];
  // Edges of kept documents that went because an end is gone.
  droppedEdges: number;
}

// The repository path a skill `source_file` names: relative to the corpus root, with a leading `./`, as the staging-relative copy path or as an absolute path
// through the corpus directory.
function documentPathOf(sourceFile: unknown): string | undefined {
  if (typeof sourceFile !== 'string' || sourceFile === '') return undefined;
  let path = sourceFile;
  while (path.startsWith('./')) path = path.slice(2);
  if (path.startsWith('/')) {
    const at = path.indexOf(`/${CORPUS_DIR}/`);
    if (at === -1) return path;
    path = path.slice(at + 1);
  }
  return path.startsWith(`${CORPUS_DIR}/`) ? path.slice(CORPUS_DIR.length + 1) : path;
}

const withoutDerived = (value: Json): Json => Object.fromEntries(Object.entries(value).filter(([key]) => !DERIVED_KEYS.has(key)));

export function retainedKnowledge(previous: Json, keep: ReadonlySet<string>, codeIds: ReadonlySet<string>): RetainedKnowledge {
  const nodes: Json[] = [];
  const kept = new Set<string>();
  for (const node of Array.isArray(previous['nodes']) ? (previous['nodes'] as unknown[]) : []) {
    if (!isObject(node) || node['_avarice_origin'] !== KNOWLEDGE_ORIGIN || typeof node['id'] !== 'string') continue;
    const path = documentPathOf(node['source_file']);
    if (path === undefined || !keep.has(path) || kept.has(node['id'])) continue;
    kept.add(node['id']);
    nodes.push(withoutDerived(node));
  }
  const edges: Json[] = [];
  let droppedEdges = 0;
  for (const edge of listOf(previous)) {
    if (!isObject(edge) || edge['_avarice_origin'] !== KNOWLEDGE_ORIGIN) continue;
    const own = documentPathOf(edge['source_file']);
    if (own !== undefined && !keep.has(own)) continue;
    const s = endpoint(edge['source']);
    const t = endpoint(edge['target']);
    if (s === undefined || t === undefined) continue;
    const known = (id: string): boolean => kept.has(id) || codeIds.has(id);
    if (!(kept.has(s) || kept.has(t))) continue;
    if (!known(s) || !known(t)) {
      droppedEdges += 1;
      continue;
    }
    edges.push(withoutDerived(edge));
  }
  return { nodes, edges, droppedEdges };
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
