// Validation of the code graph before it is installed or recorded (docs/repository-onboarding.md "Validation",
// Graph index and Document nodes rows; T-01-38). The graph is data a later run reads, so its shape, its build
// commit and its content class are checked here, on the parsed document, whatever tool wrote it. Pure.
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const MAX_SAMPLE_IDS = 3;

export interface GraphSummary {
  nodes: number;
  edges: number;
  nodesByFileType: Record<string, number>;
  edgesByConfidence: Record<string, number>;
}

export type GraphValidation = { valid: true; summary: GraphSummary } | { valid: false; problems: string[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The edges of a graph document: graphify writes `links`, other node-link writers `edges`; the graph tool reads either.
function edgesOf(doc: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(doc['links'])) return doc['links'];
  if (Array.isArray(doc['edges'])) return doc['edges'];
  return undefined;
}

function tally(items: readonly unknown[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = isObject(item) ? item[key] : undefined;
    const name = typeof value === 'string' && value !== '' ? value : 'unknown';
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

// Counts nodes by `file_type` and edges by `confidence`; a missing or non-string value counts as `unknown`, and
// something that is not a graph counts as empty.
export function summarizeGraph(graph: unknown): GraphSummary {
  const doc = isObject(graph) ? graph : {};
  const nodes = Array.isArray(doc['nodes']) ? doc['nodes'] : [];
  const edges = edgesOf(doc) ?? [];
  return { nodes: nodes.length, edges: edges.length, nodesByFileType: tally(nodes, 'file_type'), edgesByConfidence: tally(edges, 'confidence') };
}

const bare = (commit: string): string => (commit.startsWith('git:') ? commit.slice('git:'.length) : commit).toLowerCase();

// A code graph is acceptable when it has node and edge arrays, was built at exactly the staging HEAD (a full commit,
// so the record's build commit is the onboarded revision) and holds no document node. Every problem is reported.
export function validateCodeGraph(graph: unknown, stagingHead: string): GraphValidation {
  if (!isObject(graph)) return { valid: false, problems: ['graph.json is not a JSON object'] };
  const problems: string[] = [];
  const nodes = graph['nodes'];
  const edges = edgesOf(graph);
  if (!Array.isArray(nodes)) problems.push('graph.json has no nodes array');
  if (edges === undefined) problems.push('graph.json has no links array');

  const built = graph['built_at_commit'];
  if (built === undefined || built === null) {
    problems.push('built_at_commit is missing');
  } else if (typeof built !== 'string' || !FULL_COMMIT.test(built.toLowerCase())) {
    problems.push('built_at_commit is not a 40-character hexadecimal commit');
  } else if (built.toLowerCase() !== bare(stagingHead)) {
    problems.push(`built_at_commit ${built.toLowerCase()} is not the staging HEAD ${bare(stagingHead)}`);
  }

  if (Array.isArray(nodes)) {
    const documents: string[] = [];
    nodes.forEach((node, index) => {
      if (!isObject(node)) {
        problems.push(`node ${index} is not an object`);
      } else if (node['file_type'] === 'document') {
        documents.push(typeof node['id'] === 'string' ? node['id'] : `#${index}`);
      }
    });
    if (documents.length > 0) {
      problems.push(`${documents.length} document node(s); a code graph holds none (for example ${documents.slice(0, MAX_SAMPLE_IDS).join(', ')})`);
    }
  }
  if (edges !== undefined) {
    edges.forEach((edge, index) => {
      if (!isObject(edge)) problems.push(`edge ${index} is not an object`);
    });
  }

  return problems.length > 0 ? { valid: false, problems } : { valid: true, summary: summarizeGraph(graph) };
}
