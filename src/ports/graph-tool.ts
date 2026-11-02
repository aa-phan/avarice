// GraphTool port: builds and reads the code graph for onboarding (ONB-4). Phase 1 admits one adapter,
// graphify 0.9.x, which runs through the sandboxed CommandExecutor: no model, no network, and writes only to a
// directory outside the staging tree. Plan 01-18 adds the knowledge-pass methods.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

export interface LocatedGraphTool {
  // Absolute path of the executable.
  bin: string;
  // `graphify --version`, trimmed.
  version: string;
}

// graph.json, reduced to what AVARICE reads. Nodes and links are kept as the tool wrote them.
export interface GraphData {
  // Full commit the graph was built at; null when the tool recorded none.
  builtAtCommit: string | null;
  nodes: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  // The whole document, for plans that need other keys (hyperedges, directed, ...).
  raw: Record<string, unknown>;
}

// Where a build left its files: `{outDir}/graphify-out/...`.
export interface GraphBuild {
  outDir: string;
  graphFile: string;
  // Present after `cluster`.
  reportFile?: string;
}

// The files `install` copies into `{staging}/.planning/graphs/`.
export interface GraphInstallFiles {
  graph: string;
  report: string;
}

export interface GraphTool {
  readonly descriptor: CapabilityDescriptor;
  // `unavailable` (cause starting `graphify-missing`) when the tool is not installed.
  locate(): Promise<Result<LocatedGraphTool>>;
  // Deterministic code extraction of the staging tree into outDir (outside staging); no model.
  extractCode(stagingPath: string, outDir: string): Promise<Result<GraphBuild>>;
  // Community clustering and report on an extraction in outDir; no model, no labels, no viz.
  cluster(outDir: string): Promise<Result<GraphBuild>>;
  readGraph(file: string): Result<GraphData>;
  // Copies graph.json (as `graph.json` and `code-graph.json`) and GRAPH_REPORT.md into
  // `{staging}/.planning/graphs/` and writes nothing else.
  install(stagingPath: string, files: GraphInstallFiles): Result<string[]>;
}
