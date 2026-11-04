// GraphTool port: builds and reads the code graph for onboarding (ONB-4). Phase 1 admits one adapter,
// graphify 0.9.x, which runs through the sandboxed CommandExecutor: no model, no network, and writes only to a
// directory outside the staging tree. The knowledge-pass methods (plan 01-18) materialize the document corpus, read the
// skill's graph and, after AVARICE's own merge, cluster and install the merged graph.
import type { CorpusDrop, KnowledgeManifest } from '../domain/knowledge-corpus.ts';
import type { ChunkText, ExtractionPlan } from '../domain/knowledge-extraction.ts';
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

// A merged graph after `cluster-only`: the clustered file, its report and the graph read back (so the caller can check
// that `built_at_commit` survived).
export interface MergedGraphBuild {
  outDir: string;
  graphFile: string;
  reportFile: string;
  graph: GraphData;
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

  // Byte size of each repository-relative path that is a regular file inside staging; a symlink or a missing file has no
  // entry. Reads no content.
  fileSizes(stagingPath: string, paths: readonly string[]): Result<Record<string, number>>;
  // Copies the selected files to `{staging}/.avarice-knowledge/{path}`, writes `.graphifyignore` there and the manifest
  // (mode 0600) to `manifestFile` outside the corpus. A file that is a symlink, too large or secret-bearing is left out
  // and listed in `manifest.excluded` next to `dropped`. Replaces any corpus an earlier attempt left.
  materializeCorpus(stagingPath: string, paths: readonly string[], manifestFile: string, pin: string, dropped?: readonly CorpusDrop[]): Result<{ manifest: KnowledgeManifest }>;
  // Writes the chunk plan to `{staging}/.avarice-knowledge/.chunks.json` (mode 0644) and creates an empty
  // `{staging}/.avarice-knowledge/.extraction/` beside the corpus files, replacing any output an earlier attempt left. Refuses a
  // corpus directory that is a symlink. Decision B: the model reads the plan and writes only under `.extraction`.
  writeExtractionPlan(stagingPath: string, plan: ExtractionPlan): Result<void>;
  // The chunk files the model wrote, by chunk number: the text of a regular file of at most `maxOutputBytes`; `too-large` for a
  // larger one; `missing` for none, for a symlink or any non-regular file, and for every chunk when `.extraction` is itself a
  // symlink or not a directory.
  readExtractionFiles(stagingPath: string, plan: ExtractionPlan): Result<Record<number, ChunkText>>;
  // The graph the graphify skill left in `{staging}/.avarice-knowledge/graphify-out/graph.json`; `not_found` when there is none.
  readSkillGraph(stagingPath: string): Result<GraphData>;
  // Writes AVARICE's merged graph to `{workDir}/graphify-out/graph.json` (workDir outside staging), runs
  // `graphify cluster-only --no-label --no-viz` on it, reads it back and fails when `built_at_commit` did not survive.
  clusterMerged(graph: Record<string, unknown>, workDir: string): Promise<Result<MergedGraphBuild>>;
  // Replaces `.planning/graphs/graph.json` and `GRAPH_REPORT.md` in staging with the merged graph and its report, and
  // writes nothing else (`code-graph.json` stays the code-only graph).
  installMergedGraph(stagingPath: string, files: GraphInstallFiles): Result<string[]>;
}
