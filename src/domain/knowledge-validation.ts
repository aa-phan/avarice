// RED stub (plan 01-18 Task 2).
import type { GraphSummary } from './graph-validation.ts';
import type { MergeStats } from './graph-merge.ts';
import type { KnowledgeManifest } from './knowledge-corpus.ts';

export const KNOWLEDGE_LIMITS = { nodeTextBytes: 2048, danglingShare: 0.1 } as const;

export type KnowledgeValidation = { valid: true; summary: GraphSummary } | { valid: false; problems: string[] };

export function validateKnowledgeGraph(merged: unknown, manifest: KnowledgeManifest, stats: MergeStats): KnowledgeValidation {
  void merged;
  void manifest;
  void stats;
  return { valid: true, summary: { nodes: 0, edges: 0, nodesByFileType: {}, edgesByConfidence: {} } };
}
