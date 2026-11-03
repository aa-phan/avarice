// Validation of the merged graph before it replaces `graph.json` (docs/repository-onboarding.md "Validation", Document
// nodes row; S-45, T-01-53, T-01-54). The pass's nodes are model output joined to deterministic code nodes, so the merge is
// checked on the parsed document, whatever tool wrote it. Pure. A problem names a node ID, a pattern kind or a count, never
// the text that matched.
import { summarizeGraph } from './graph-validation.ts';
import type { GraphSummary } from './graph-validation.ts';
import { KNOWLEDGE_ORIGIN } from './graph-merge.ts';
import type { MergeStats } from './graph-merge.ts';
import type { KnowledgeManifest } from './knowledge-corpus.ts';
import { findSecrets } from './secret-patterns.ts';

export const KNOWLEDGE_LIMITS = {
  // The text of one node of the pass: the UTF-8 bytes of all its string fields.
  nodeTextBytes: 2048,
  // Dropped dangling edges over the edges the pass produced.
  danglingShare: 0.1,
} as const;

export type KnowledgeValidation = { valid: true; summary: GraphSummary } | { valid: false; problems: string[] };

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const MAX_PROBLEMS = 25;
const MAX_SAMPLE = 3;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function endpoint(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isObject(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

const textBytes = (node: Record<string, unknown>): number =>
  Object.values(node).reduce<number>((total, value) => (typeof value === 'string' ? total + Buffer.byteLength(value, 'utf8') : total), 0);

// Paths the corpus never holds in Phase 1 (S-45): a node cannot come from them whatever the manifest says.
const forbiddenSource = (path: string): boolean => path.startsWith('.planning/phases/') || path === '.planning/STATE.md';

export function validateKnowledgeGraph(merged: unknown, manifest: KnowledgeManifest, stats: MergeStats): KnowledgeValidation {
  if (!isObject(merged)) return { valid: false, problems: ['the merged graph is not a JSON object'] };
  const nodes = merged['nodes'];
  const links = merged['links'] ?? merged['edges'];
  if (!Array.isArray(nodes) || !Array.isArray(links)) return { valid: false, problems: ['the merged graph has no nodes and links arrays'] };

  const problems: string[] = [];
  const built = merged['built_at_commit'];
  const expected = (manifest.revision.startsWith('git:') ? manifest.revision.slice('git:'.length) : manifest.revision).toLowerCase();
  if (typeof built !== 'string' || !FULL_COMMIT.test(built.toLowerCase())) problems.push('built_at_commit is missing or not a 40-character hexadecimal commit');
  else if (built.toLowerCase() !== expected) problems.push(`built_at_commit ${built.toLowerCase()} is not the onboarded revision ${expected}`);

  const bySource = new Map(manifest.entries.map((e) => [e.sourcePath, e] as const));
  const documentIds = new Set<string>();
  nodes.forEach((node, index) => {
    if (!isObject(node)) {
      problems.push(`node ${index} is not an object`);
      return;
    }
    const id = typeof node['id'] === 'string' ? node['id'] : `#${index}`;
    const source = node['source_file'];
    if (typeof source === 'string' && forbiddenSource(source)) problems.push(`node ${id}: sourced from ${source}, which the corpus never holds (.planning/phases and STATE.md are excluded)`);
    if (node['_avarice_origin'] !== KNOWLEDGE_ORIGIN) return;
    if (node['file_type'] === 'document') documentIds.add(id);
    const entry = typeof source === 'string' ? bySource.get(source) : undefined;
    if (entry === undefined) problems.push(`node ${id}: ${typeof source === 'string' ? `source ${JSON.stringify(source)}` : 'no source_file'} is not in the manifest`);
    else if (node['source_revision'] !== entry.revision) problems.push(`node ${id}: does not cite the revision ${entry.revision}`);
    const bytes = textBytes(node);
    if (bytes > KNOWLEDGE_LIMITS.nodeTextBytes) problems.push(`node ${id}: text is ${bytes} bytes, above the ${KNOWLEDGE_LIMITS.nodeTextBytes} limit`);
  });
  if (documentIds.size === 0) problems.push('the pass added no document node');

  const bad: string[] = [];
  let badCount = 0;
  links.forEach((edge, index) => {
    if (!isObject(edge)) {
      problems.push(`edge ${index} is not an object`);
      return;
    }
    const s = endpoint(edge['source']);
    const t = endpoint(edge['target']);
    if ((s !== undefined && documentIds.has(s)) || (t !== undefined && documentIds.has(t))) {
      if (edge['confidence'] !== 'INFERRED' && edge['confidence'] !== 'AMBIGUOUS') {
        badCount += 1;
        if (bad.length < MAX_SAMPLE) bad.push(`${s ?? '?'} -> ${t ?? '?'}`);
      }
    }
  });
  if (badCount > 0) problems.push(`${badCount} edge(s) touching a knowledge-pass document node are EXTRACTED or have no tier; document edges must be INFERRED or AMBIGUOUS (for example ${bad.join(', ')})`);

  // One field a line, so no line is long enough to make a pattern scan slow.
  const hits = findSecrets(JSON.stringify(merged, null, 1));
  if (hits.length > 0) problems.push(`a secret pattern matches in the merged graph (${[...new Set(hits.map((h) => h.pattern))].sort().join(', ')})`);

  if (stats.skillEdges > 0 && stats.dropped.dangling / stats.skillEdges > KNOWLEDGE_LIMITS.danglingShare + 1e-9) {
    problems.push(`${stats.dropped.dangling} of ${stats.skillEdges} edges the pass produced were dangling, above the ${Math.round(KNOWLEDGE_LIMITS.danglingShare * 100)}% limit`);
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_PROBLEMS);
    if (problems.length > shown.length) shown.push(`and ${problems.length - shown.length} more`);
    return { valid: false, problems: shown };
  }
  return { valid: true, summary: summarizeGraph(merged) };
}
