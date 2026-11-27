// `gsd-graph` context adapter: answers from `.planning/graphs/graph.json` through GSD's own reader (`gsd_run graphify
// query <term> --budget <n>`), never the standalone `graphify query` (the two return different shapes and read
// `--budget` in different units). To meet the budget GSD drops AMBIGUOUS, then INFERRED, then EXTRACTED edges, so code
// edges survive longest; this adapter ranks what is left the same way, EXTRACTED first. Freshness is the graph's build
// commit against the repository's current HEAD; when stale, each cited path is confirmed with `git cat-file -e`.
// It reads no file itself and writes nothing.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { ruleFor, widestRule } from '../../domain/retrieval-rules.ts';
import type { ReadRule } from '../../domain/retrieval-rules.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextConfidence, ContextHandle, ContextItem, ContextQuery, ContextRefreshQuery, ContextSource, ExternalRef, Freshness, TokenBudget } from '../../ports/context-source.ts';
import type { GsdGraphEdge, GsdGraphNode, GsdOnboarding } from '../../ports/gsd-onboarding.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';
import { currentHead, estimateTokens, freshnessAt, isCitablePath, pathExistsAtHead } from './freshness.ts';

const GRAPH_PATH = '.planning/graphs/graph.json';
const MAX_EDGES_IN_EXCERPT = 5;
// How far below a node a containment chain is followed (T-04-23).
const MAX_DESCENT_DEPTH = 3;
const MAX_TEXT_CHARS = 300;
// What GSD's reader is asked when the caller gives no budget.
const DEFAULT_BUDGET = 4000;

// Lower is better. A node with no edge in the answer (a match that stands alone, or one whose edges were trimmed) ranks
// between code-derived and model-derived evidence.
const TIER_RANK: Readonly<Record<ContextConfidence, number>> = { EXTRACTED: 0, INFERRED: 2, AMBIGUOUS: 3 };
const NO_EDGE_RANK = 1;

const clip = (text: string): string => (text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)}…`);

interface Found {
  handle: ContextHandle;
  excerpt: string;
}

function rankOf(confidence: ContextConfidence | undefined): number {
  return confidence === undefined ? NO_EDGE_RANK : TIER_RANK[confidence];
}

// The best tier among the edges that touch a node.
function bestTier(nodeId: string, edges: readonly GsdGraphEdge[]): ContextConfidence | undefined {
  let best: ContextConfidence | undefined;
  for (const edge of edges) {
    if ((edge.source !== nodeId && edge.target !== nodeId) || edge.confidence === null) continue;
    if (best === undefined || TIER_RANK[edge.confidence] < TIER_RANK[best]) best = edge.confidence;
  }
  return best;
}

// Text of a node that is not code is data, so it is printed only in that node's own (fenced) entry: an edge in another
// node's excerpt names such a neighbour by its kind, never by its label.
function neighbourName(other: GsdGraphNode | undefined, id: string): string {
  if (other === undefined) return clip(id);
  return other.fileType === 'code' ? clip(other.label) : `a ${other.fileType ?? 'non-code'} node`;
}

// What an edge adds about the node at its far end, by the read rule of its relation (FR-22): the ID alone, or the label
// with the source file for a code node.
function describeNeighbour(rule: ReadRule, other: GsdGraphNode | undefined, id: string): string {
  if (rule === 'id-only') return clip(id);
  const name = neighbourName(other, id);
  return other !== undefined && other.fileType === 'code' && other.sourceFile !== null ? `${name} in ${clip(other.sourceFile)}` : name;
}

const byTier = (a: GsdGraphEdge, b: GsdGraphEdge): number => rankOf(a.confidence ?? undefined) - rankOf(b.confidence ?? undefined);

// The rule an edge has for the node reading it: a containment edge pointing down is followed to its descendants, the same
// edge seen from the child only names the parent, like a dependency.
function ruleAt(edge: GsdGraphEdge, nodeId: string): ReadRule {
  const rule = ruleFor(edge.relation);
  return rule === 'descendants' && edge.source !== nodeId ? 'one-hop' : rule;
}

// The rule that governs how a node's edges are read: the widest of its edges' rules.
function readRuleOf(node: GsdGraphNode, edges: readonly GsdGraphEdge[]): ReadRule {
  return widestRule(edges.filter((e) => e.source === node.id || e.target === node.id).map((e) => ruleAt(e, node.id)));
}

// The excerpt of a node, and whether it shows any text that is not a code label: the node's own description, or the ID or kind of a neighbour that is not a code node
// in the answer. A caller prints such an excerpt as data (WR-18).
function excerptOf(node: GsdGraphNode, edges: readonly GsdGraphEdge[], byId: ReadonlyMap<string, GsdGraphNode>): { text: string; foreignText: boolean } {
  const lines = [`${clip(node.label)} [${node.fileType ?? 'unknown'}]${node.sourceFile !== null ? ` in ${node.sourceFile}` : ''}`];
  let foreignText = node.description !== null;
  if (node.description !== null) lines.push(clip(node.description));
  // Every neighbour an edge line names goes through here, so the flag cannot miss a line.
  const neighbour = (rule: ReadRule, id: string): string => {
    const other = byId.get(id);
    if (other?.fileType !== 'code') foreignText = true;
    return describeNeighbour(rule, other, id);
  };
  const edgeLines: string[] = [];
  const full = (): boolean => edgeLines.length >= MAX_EDGES_IN_EXCERPT;
  const shown = new Set<string>([node.id]);

  // A containment edge pointing down is followed to its descendants, to a depth bound and the excerpt cap; the same edge
  // seen from the child names the parent like a dependency, and nothing above it is followed.
  const descend = (parentId: string, depth: number): void => {
    if (depth > MAX_DESCENT_DEPTH) return;
    for (const edge of edges.filter((e) => e.source === parentId && ruleFor(e.relation) === 'descendants').sort(byTier)) {
      if (full()) return;
      if (shown.has(edge.target)) continue;
      shown.add(edge.target);
      edgeLines.push(`${'  '.repeat(depth - 1)}-> ${edge.relation ?? 'related to'} ${neighbour('descendants', edge.target)} (${edge.confidence ?? 'no tier'})`);
      descend(edge.target, depth + 1);
    }
  };

  for (const edge of edges.filter((e) => e.source === node.id || e.target === node.id).sort(byTier)) {
    if (full()) break;
    const outgoing = edge.source === node.id;
    const other = outgoing ? edge.target : edge.source;
    const rule = ruleAt(edge, node.id);
    if (rule === 'descendants') {
      if (shown.has(other)) continue;
      shown.add(other);
      edgeLines.push(`-> ${edge.relation ?? 'related to'} ${neighbour(rule, other)} (${edge.confidence ?? 'no tier'})`);
      descend(other, 2);
      continue;
    }
    edgeLines.push(`${outgoing ? '->' : '<-'} ${edge.relation ?? 'related to'} ${neighbour(rule, other)} (${edge.confidence ?? 'no tier'})`);
  }
  return { text: [...lines, ...edgeLines].join('\n'), foreignText };
}

export class GsdGraphContext implements ContextSource {
  readonly descriptor: CapabilityDescriptor;
  readonly #gsd: GsdOnboarding;
  readonly #nowMs: () => number;
  // The nodes the latest `find` returned, by node ID, so `read` answers without a second query.
  #found = new Map<string, Found>();

  constructor(gsd: GsdOnboarding, options: ContextAdapterOptions) {
    this.#gsd = gsd;
    this.#nowMs = () => options.nowMs();
    this.descriptor = {
      port: 'context-source',
      adapter: 'gsd-graph',
      version: '1',
      capabilities: { find: true, read: true, refresh: true },
      offline: true,
    };
  }

  async find(query: ContextQuery, budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    this.#found = new Map();
    const tokens = Number.isSafeInteger(budget) && budget >= 0 ? budget : DEFAULT_BUDGET;
    const answer = await this.#gsd.graphifyQuery(query.workspace.stagingPath, query.term, tokens);
    if (!answer.ok) return answer;
    if (answer.value.disabled) return err({ kind: 'unavailable', cause: 'graphify is disabled in the staging GSD config' });
    const { nodes, edges } = answer.value;

    const freshness = freshnessAt(query.indexRevision, currentHead(query.workspace.repoPath));
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    const handles: ContextHandle[] = [];
    for (const node of nodes) {
      const confidence = bestTier(node.id, edges);
      const { text: excerpt, foreignText } = excerptOf(node, edges, byId);
      const cited = node.sourceFile !== null && isCitablePath(node.sourceFile) ? node.sourceFile : undefined;
      const ref: ExternalRef = {
        provider: 'gsd-graph',
        kind: 'graph-node',
        id: node.id,
        revision: query.indexRevision,
        retrievedAt,
        // The path the node was extracted from; a node that names none is cited at the graph file itself.
        scope: cited ?? GRAPH_PATH,
        freshness,
      };
      const handle: ContextHandle = {
        ref,
        title: node.label,
        estTokens: estimateTokens(excerpt),
        reason: `matched "${query.term}"${confidence !== undefined ? `, best edge ${confidence}` : ''}`,
        readRule: readRuleOf(node, edges),
        ...(confidence !== undefined ? { confidence } : {}),
        // Anything that is not code (a document, or a concept or rationale a model read out of one) is data, not
        // instruction: its text is printed fenced and never acted on. So is the excerpt of a code node that shows such text:
        // its description, or the ID of a neighbour that is not code.
        ...(node.fileType !== 'code' || foreignText ? { untrusted: true } : {}),
        // What a consumer of the node's facts (its file and its label) needs, which the mark above does not say: a code node whose excerpt is untrusted is still a code node.
        ...(node.fileType === 'code' ? { codeNode: true } : {}),
        ...(cited !== undefined ? { citedPath: cited } : {}),
      };
      if (freshness !== 'fresh' && cited !== undefined) {
        const confirmed = pathExistsAtHead(query.workspace.repoPath, cited);
        if (confirmed !== undefined) handle.confirmed = confirmed;
      }
      this.#found.set(ref.id, { handle, excerpt });
      handles.push(handle);
    }
    // EXTRACTED first, then standalone matches, then INFERRED, then AMBIGUOUS; the reader's order within a tier.
    return ok(handles.map((handle, index) => ({ handle, index })).sort((a, b) => rankOf(a.handle.confidence) - rankOf(b.handle.confidence) || a.index - b.index).map((x) => x.handle));
  }

  async read(handles: readonly ContextHandle[], _budget: TokenBudget): Promise<Result<ContextItem[]>> {
    const items: ContextItem[] = [];
    for (const handle of handles) {
      const found = this.#found.get(handle.ref.id);
      if (found === undefined) return err({ kind: 'invalid', field: 'handle', reason: `${handle.ref.id} was not returned by this source's latest find` });
      items.push({
        ref: handle.ref,
        title: handle.title,
        excerpt: found.excerpt,
        estTokens: handle.estTokens,
        reason: handle.reason,
        ...(handle.confidence !== undefined ? { confidence: handle.confidence } : {}),
        ...(handle.untrusted === true ? { untrusted: true } : {}),
        ...(handle.codeNode === true ? { codeNode: true } : {}),
        ...(handle.confirmed !== undefined ? { confirmed: handle.confirmed } : {}),
        ...(handle.citedPath !== undefined ? { citedPath: handle.citedPath } : {}),
      });
    }
    return ok(items);
  }

  // A graph node is judged by the index it came from and the repository as it is now. The path it cites is looked at first: a node whose source file is gone at
  // HEAD is `deleted`, whatever the index says. A node recorded at another build of the graph than the project record names now is `changed` (the graph was
  // rebuilt since the pack was made). Otherwise the build commit against HEAD decides `fresh` or `stale`, and a HEAD that cannot be read is `unavailable`.
  async refresh(ref: ExternalRef, query: ContextRefreshQuery): Promise<Result<ExternalRef>> {
    const retrievedAt = new Date(this.#nowMs()).toISOString();
    const settled = (freshness: Freshness): Result<ExternalRef> => ok({ ...ref, revision: query.indexRevision, retrievedAt, freshness });
    if (ref.scope !== GRAPH_PATH && pathExistsAtHead(query.workspace.repoPath, ref.scope) === false) return settled('deleted');
    if (ref.revision !== undefined && ref.revision !== query.indexRevision) return settled('changed');
    return settled(freshnessAt(query.indexRevision, currentHead(query.workspace.repoPath)));
  }
}
