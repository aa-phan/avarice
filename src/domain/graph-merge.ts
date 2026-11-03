// RED stub (plan 01-18 Task 2).
import type { KnowledgeManifest } from './knowledge-corpus.ts';

export interface MergeStats {
  codeNodes: number;
  documentNodes: number;
  knowledgeNodes: number;
  edges: number;
  skillEdges: number;
  knowledgeEdges: number;
  collided: number;
  retagged: number;
  dropped: { dangling: number; astDocument: number; malformed: number };
}

export interface MergeInput {
  code: Record<string, unknown>;
  docs: Record<string, unknown>;
  manifest: KnowledgeManifest;
  onboardedRevision: string;
}

export function mergeKnowledgeGraph(input: MergeInput): { graph: Record<string, unknown>; stats: MergeStats } {
  return { graph: { ...input.code }, stats: { codeNodes: 0, documentNodes: 0, knowledgeNodes: 0, edges: 0, skillEdges: 0, knowledgeEdges: 0, collided: 0, retagged: 0, dropped: { dangling: 0, astDocument: 0, malformed: 0 } } };
}
