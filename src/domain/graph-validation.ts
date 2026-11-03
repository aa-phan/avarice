// RED stub (plan 01-14 Task 2): the real validation arrives in the GREEN commit.
export interface GraphSummary {
  nodes: number;
  edges: number;
  nodesByFileType: Record<string, number>;
  edgesByConfidence: Record<string, number>;
}

export type GraphValidation = { valid: true; summary: GraphSummary } | { valid: false; problems: string[] };

export function summarizeGraph(_graph: unknown): GraphSummary {
  return { nodes: 0, edges: 0, nodesByFileType: {}, edgesByConfidence: {} };
}

export function validateCodeGraph(graph: unknown, _stagingHead: string): GraphValidation {
  return { valid: true, summary: summarizeGraph(graph) };
}
