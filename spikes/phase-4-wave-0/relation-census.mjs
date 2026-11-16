// Relation census over graphify graph.json files (Phase 4 wave 0, spike S4-A).
// Usage: node relation-census.mjs <graph.json> [<graph.json> ...]
// Prints one JSON document: per graph and in total, every edge `relation` with its count per `confidence` tier
// (EXTRACTED, INFERRED, AMBIGUOUS, missing). Built-ins only; the graphs are read, never written.
import { readFileSync } from 'node:fs';

const TIERS = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'missing'];

function tierOf(edge) {
  const c = edge.confidence;
  return TIERS.includes(c) ? c : 'missing';
}

function emptyRow() {
  return { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0, missing: 0, total: 0 };
}

function census(graph) {
  // graphify writes edges under `links` (networkx node-link) and some builds under `edges`.
  const edges = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  const relations = {};
  for (const edge of edges) {
    const name = typeof edge.relation === 'string' && edge.relation !== '' ? edge.relation : '(no relation)';
    const row = (relations[name] ??= emptyRow());
    row[tierOf(edge)] += 1;
    row.total += 1;
  }
  return { nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0, edges: edges.length, relations };
}

function sortRelations(relations) {
  return Object.fromEntries(Object.entries(relations).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])));
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write('usage: node relation-census.mjs <graph.json> [<graph.json> ...]\n');
  process.exit(2);
}

const out = { graphs: {}, totals: { nodes: 0, edges: 0, relations: {} } };
for (const path of paths) {
  const result = census(JSON.parse(readFileSync(path, 'utf8')));
  result.relations = sortRelations(result.relations);
  out.graphs[path] = result;
  out.totals.nodes += result.nodes;
  out.totals.edges += result.edges;
  for (const [name, row] of Object.entries(result.relations)) {
    const total = (out.totals.relations[name] ??= emptyRow());
    for (const key of Object.keys(row)) total[key] += row[key];
  }
}
out.totals.relations = sortRelations(out.totals.relations);
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
