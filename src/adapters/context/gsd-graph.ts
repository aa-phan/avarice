// `gsd-graph` context adapter: answers from `.planning/graphs/graph.json` through GSD's own reader (`gsd_run graphify
// query <term> --budget <n>`), never the standalone `graphify query` (the two return different shapes and read
// `--budget` in different units). To meet the budget GSD drops AMBIGUOUS, then INFERRED, then EXTRACTED edges, so code
// edges survive longest; this adapter ranks what is left the same way, EXTRACTED first. Freshness is the graph's build
// commit against the repository's current HEAD; when stale, each cited path is confirmed with `git cat-file -e`.
// It reads no file itself and writes nothing.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextConfidence, ContextHandle, ContextItem, ContextQuery, ContextSource, ExternalRef, TokenBudget } from '../../ports/context-source.ts';
import type { GsdGraphEdge, GsdGraphNode, GsdOnboarding } from '../../ports/gsd-onboarding.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';
import { currentHead, estimateTokens, freshnessAt, isCitablePath, pathExistsAtHead } from './freshness.ts';

const GRAPH_PATH = '.planning/graphs/graph.json';
const MAX_EDGES_IN_EXCERPT = 5;
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

function excerptOf(node: GsdGraphNode, edges: readonly GsdGraphEdge[], byId: ReadonlyMap<string, GsdGraphNode>): string {
  const touching = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .sort((a, b) => rankOf(a.confidence ?? undefined) - rankOf(b.confidence ?? undefined));
  const lines = [`${clip(node.label)} [${node.fileType ?? 'unknown'}]${node.sourceFile !== null ? ` in ${node.sourceFile}` : ''}`];
  if (node.description !== null) lines.push(clip(node.description));
  for (const edge of touching.slice(0, MAX_EDGES_IN_EXCERPT)) {
    const outgoing = edge.source === node.id;
    const other = outgoing ? edge.target : edge.source;
    lines.push(`${outgoing ? '->' : '<-'} ${edge.relation ?? 'related to'} ${neighbourName(byId.get(other), other)} (${edge.confidence ?? 'no tier'})`);
  }
  return lines.join('\n');
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
      capabilities: { find: true, read: true, refresh: false },
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
      const excerpt = excerptOf(node, edges, byId);
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
        readRule: 'one-hop',
        ...(confidence !== undefined ? { confidence } : {}),
        // Anything that is not code (a document, or a concept or rationale a model read out of one) is data, not
        // instruction: its text is printed fenced and never acted on.
        ...(node.fileType !== 'code' ? { untrusted: true } : {}),
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
        ...(handle.confirmed !== undefined ? { confirmed: handle.confirmed } : {}),
      });
    }
    return ok(items);
  }
}
