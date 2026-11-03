// Project record builder (docs/repository-onboarding.md "Project record").
// The record holds operational metadata only: paths, digests, revisions and classifications of GSD
// artifacts, never their content (ONB-2). A record version is immutable once stored.
import { digestOf } from './digest.ts';
import { completenessFor } from './mapping.ts';
import type { Completeness, MappingMode } from './mapping.ts';
import { PROFILE_POLICY } from './policy-narrowing.ts';
import type { ProposedCommand } from './policy-narrowing.ts';

export interface CodebaseArtifact {
  path: string;
  digest: string;
  lastMappedCommit: string;
}

export interface ProjectRecordInput {
  projectId: string;
  recordVersion?: number;
  repository: { rootCommit: string; remote: string | null; defaultBranch: string };
  onboardedAt: string;
  activeRevision?: string;
  profile: string;
  stagingPath: string;
  codebase: readonly CodebaseArtifact[];
  snapshot: string;
  mapping: { mode: MappingMode; scope: readonly string[]; mappedAt: string; freshness?: 'fresh' | 'stale' };
  notMapped: readonly string[];
  // Version reported by the located gsd-core (`runtime-identity`); `unknown` when none was recorded.
  gsdVersion?: string;
  // The GSD settings AVARICE applied in staging and the operations the located gsd-core supports.
  gsd?: { config?: Readonly<Record<string, unknown>>; capabilities?: readonly string[] };
  // Preflight facts, as recorded at registration (names and classifications, never contents).
  existingState?: Readonly<Record<string, unknown>>;
  instructionFiles?: readonly string[];
  findings?: readonly RecordFinding[];
  // The onboarding contract the record was produced under.
  contract?: { runId: string; version: number; digest: string };
  // Accepted proposals, already narrowed by policy-narrowing.ts.
  paths?: Partial<RecordPaths>;
  commands?: readonly ProposedCommand[];
  execution?: Partial<RecordExecution>;
  // The indexes the index stage built, already folded from its step results (foldIndexResults).
  indexes?: RecordIndexes;
}

// Something validation or narrowing noted about this record: a name and a reason, never document text.
export interface RecordFinding {
  source: 'validation' | 'narrowing';
  field: string;
  reason: string;
  detail?: string;
}

// The code graph as the record states it (docs/repository-onboarding.md "Project record"): where it is, the digest
// of the installed graph.json, the commit it was built at and the counts that show it holds code and no documents.
export interface RecordGraphIndex {
  path: string;
  codeGraphPath: string;
  digest: string;
  builtAtCommit: string;
  tool: string;
  freshness: 'fresh' | 'stale';
  // Node counts by `file_type` (`document` is present and zero for a code-only graph) and edge counts by `confidence`.
  nodes: Record<string, number>;
  edges: Record<string, number>;
  // Present only when the knowledge pass added document nodes (plan 01-18).
  knowledge?: Record<string, unknown>;
}

export interface RecordIntelIndex {
  path: string;
  digest: string;
  refreshedAtCommit: string;
  freshness: 'fresh' | 'stale';
  files: number;
}

// An index that was not built: the record says so instead of listing it (ONB-13).
export interface RecordAbsentIndex {
  index: string;
  reason: string;
}

export interface RecordIndexes {
  graph?: RecordGraphIndex;
  intel?: RecordIntelIndex;
  // Only when at least one index is absent.
  absent?: RecordAbsentIndex[];
}

export const INDEX_NAMES = ['code-graph', 'intel', 'knowledge'] as const;
export type IndexName = (typeof INDEX_NAMES)[number];

// What one index step returns and the ledger stores as step `index:{name}` (SKELETON.md "Application"). `present`
// carries the result the record folds in; `absent` says why nothing was built; `disabled` means the contract
// turned the index off, so the record states nothing about it.
export interface IndexStepResult {
  index: IndexName;
  status: 'present' | 'absent' | 'disabled';
  reason?: string;
  // Short human-readable detail for the event only, never for the record.
  detail?: string;
  result?: Record<string, unknown>;
}

export interface RecordPaths {
  read: string[];
  write: string[];
  protected: string[];
  generated: string[];
  artifacts: string[];
}

export interface RecordExecution {
  toolClasses: string[];
  environments: string[];
  endpoints: string[];
  credentials: string[];
}

export interface ProjectRecord {
  schema: 1;
  recordVersion: number;
  projectId: string;
  repository: { rootCommit: string; remote: string | null; defaultBranch: string };
  revisions: { onboardedAt: string; active: string };
  profile: string;
  policyPreset: 'routine';
  promotion: 'none';
  gsd: { version: string; runtime: 'claude'; adapter: string; config: Record<string, unknown>; capabilities: string[] };
  contract: { runId: string; version: number; digest: string } | null;
  existingState: Record<string, unknown>;
  instructionFiles: string[];
  findings: RecordFinding[];
  artifacts: {
    location: 'staging';
    stagingPath: string;
    codebase: CodebaseArtifact[];
    snapshot: string;
  };
  mapping: {
    mode: MappingMode;
    scope: string[];
    completeness: Completeness;
    mappedAt: string;
    freshness: 'fresh' | 'stale';
  };
  indexes: RecordIndexes;
  notMapped: string[];
  paths: RecordPaths;
  execution: RecordExecution;
  commands: ProposedCommand[];
}

// Defaults grant nothing: no write paths, no endpoints, no credentials. Repository proposals and later
// plans can only narrow authority (ONB-9); widening needs a new record version through policy.
export function buildProjectRecord(input: ProjectRecordInput): ProjectRecord {
  const paths = input.paths ?? {};
  const defaults = PROFILE_POLICY.paths;
  const execution = input.execution ?? {};
  return {
    schema: 1,
    recordVersion: input.recordVersion ?? 1,
    projectId: input.projectId,
    repository: {
      rootCommit: input.repository.rootCommit,
      remote: input.repository.remote,
      defaultBranch: input.repository.defaultBranch,
    },
    revisions: { onboardedAt: input.onboardedAt, active: input.activeRevision ?? input.onboardedAt },
    profile: input.profile,
    policyPreset: 'routine',
    promotion: 'none',
    gsd: {
      version: input.gsdVersion ?? 'unknown',
      runtime: 'claude',
      adapter: 'gsd-onboarding@1.17',
      config: { ...(input.gsd?.config ?? {}) },
      capabilities: [...(input.gsd?.capabilities ?? [])],
    },
    contract: input.contract === undefined ? null : { runId: input.contract.runId, version: input.contract.version, digest: input.contract.digest },
    existingState: { ...(input.existingState ?? {}) },
    instructionFiles: [...(input.instructionFiles ?? [])],
    findings: (input.findings ?? []).map((f) => ({ ...f })),
    artifacts: {
      location: 'staging',
      stagingPath: input.stagingPath,
      codebase: input.codebase.map((c) => ({
        path: c.path,
        digest: c.digest,
        lastMappedCommit: c.lastMappedCommit,
      })),
      snapshot: input.snapshot,
    },
    mapping: {
      mode: input.mapping.mode,
      scope: [...input.mapping.scope],
      completeness: completenessFor(input.mapping.mode),
      mappedAt: input.mapping.mappedAt,
      freshness: input.mapping.freshness ?? 'fresh',
    },
    indexes: copyIndexes(input.indexes),
    notMapped: [...input.notMapped],
    // The profile policy's grants, then the proposals that survived narrowing. Protection only accumulates.
    paths: {
      read: [...(paths.read ?? defaults.read)],
      write: [...(paths.write ?? defaults.write)],
      protected: [...new Set([...defaults.protected, ...(paths.protected ?? [])])],
      generated: [...(paths.generated ?? defaults.generated)],
      artifacts: [...(paths.artifacts ?? defaults.artifacts)],
    },
    execution: {
      toolClasses: [...(execution.toolClasses ?? ['read'])],
      environments: [...(execution.environments ?? ['local-sandbox'])],
      endpoints: [...(execution.endpoints ?? [])],
      credentials: [...(execution.credentials ?? [])],
    },
    commands: (input.commands ?? []).map((c) => ({ name: c.name, argv: [...c.argv], provenance: c.provenance, status: c.status })),
  };
}

function copyIndexes(indexes: RecordIndexes | undefined): RecordIndexes {
  const copy: RecordIndexes = {};
  if (indexes?.graph !== undefined) {
    const graph = indexes.graph;
    copy.graph = {
      path: graph.path,
      codeGraphPath: graph.codeGraphPath,
      digest: graph.digest,
      builtAtCommit: graph.builtAtCommit,
      tool: graph.tool,
      freshness: graph.freshness,
      nodes: { ...graph.nodes },
      edges: { ...graph.edges },
      ...(graph.knowledge !== undefined ? { knowledge: { ...graph.knowledge } } : {}),
    };
  }
  if (indexes?.intel !== undefined) copy.intel = { ...indexes.intel };
  if (indexes?.absent !== undefined && indexes.absent.length > 0) copy.absent = indexes.absent.map((a) => ({ index: a.index, reason: a.reason }));
  return copy;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isFreshness = (value: unknown): value is 'fresh' | 'stale' => value === 'fresh' || value === 'stale';

function counts(value: unknown): Record<string, number> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return undefined;
    out[key] = count;
  }
  return out;
}

function graphIndexOf(result: Record<string, unknown> | undefined): RecordGraphIndex | undefined {
  if (result === undefined) return undefined;
  const nodes = counts(result['nodes']);
  const edges = counts(result['edges']);
  if (
    !isString(result['path']) ||
    !isString(result['codeGraphPath']) ||
    !isString(result['digest']) ||
    !isString(result['builtAtCommit']) ||
    !isString(result['tool']) ||
    !isFreshness(result['freshness']) ||
    nodes === undefined ||
    edges === undefined
  ) {
    return undefined;
  }
  return {
    path: result['path'],
    codeGraphPath: result['codeGraphPath'],
    digest: result['digest'],
    builtAtCommit: result['builtAtCommit'],
    tool: result['tool'],
    freshness: result['freshness'],
    nodes,
    edges,
  };
}

function intelIndexOf(result: Record<string, unknown> | undefined): RecordIntelIndex | undefined {
  if (result === undefined) return undefined;
  const files = result['files'];
  if (!isString(result['path']) || !isString(result['digest']) || !isString(result['refreshedAtCommit']) || !isFreshness(result['freshness']) || typeof files !== 'number' || !Number.isSafeInteger(files) || files < 0) {
    return undefined;
  }
  return { path: result['path'], digest: result['digest'], refreshedAtCommit: result['refreshedAtCommit'], freshness: result['freshness'], files };
}

// Folds the stored index step results into the record's `indexes`, in registry order:
//   code-graph present -> indexes.graph        intel present -> indexes.intel
//   knowledge present  -> indexes.graph.digest = result.graphDigest and indexes.graph.knowledge = result.knowledge (and
//                         indexes.graph.nodes / edges = result.nodes / edges when the step states the merged counts)
//   every absent step  -> an indexes.absent entry (the code graph is named `graph`)
// A disabled step says nothing. A present step whose result is not in the expected shape counts as absent, so a
// malformed result never reaches the record. Knowledge words only make sense on a graph: without one they are absent.
export function foldIndexResults(results: readonly IndexStepResult[]): RecordIndexes {
  const absent: RecordAbsentIndex[] = [];
  let graph: RecordGraphIndex | undefined;
  let intel: RecordIntelIndex | undefined;
  let knowledge: { graphDigest: string; knowledge: Record<string, unknown>; nodes?: Record<string, number>; edges?: Record<string, number> } | undefined;
  for (const step of results) {
    const recordName = step.index === 'code-graph' ? 'graph' : step.index;
    if (step.status === 'disabled') continue;
    if (step.status === 'absent') {
      absent.push({ index: recordName, reason: step.reason ?? 'unknown' });
      continue;
    }
    if (step.index === 'code-graph') {
      graph = graphIndexOf(step.result);
      if (graph === undefined) absent.push({ index: recordName, reason: 'invalid-result' });
    } else if (step.index === 'intel') {
      intel = intelIndexOf(step.result);
      if (intel === undefined) absent.push({ index: recordName, reason: 'invalid-result' });
    } else {
      const graphDigest = step.result?.['graphDigest'];
      const documents = step.result?.['knowledge'];
      // The merged graph's own counts, when the step states them (plan 01-18): the digest is of that file.
      const nodes = counts(step.result?.['nodes']);
      const edges = counts(step.result?.['edges']);
      if (isString(graphDigest) && isObject(documents)) knowledge = { graphDigest, knowledge: documents, ...(nodes !== undefined ? { nodes } : {}), ...(edges !== undefined ? { edges } : {}) };
      else absent.push({ index: recordName, reason: 'invalid-result' });
    }
  }
  if (knowledge !== undefined) {
    if (graph === undefined) absent.push({ index: 'knowledge', reason: 'graph-absent' });
    else graph = { ...graph, digest: knowledge.graphDigest, knowledge: knowledge.knowledge, ...(knowledge.nodes !== undefined ? { nodes: knowledge.nodes } : {}), ...(knowledge.edges !== undefined ? { edges: knowledge.edges } : {}) };
  }
  return { ...(graph !== undefined ? { graph } : {}), ...(intel !== undefined ? { intel } : {}), ...(absent.length > 0 ? { absent } : {}) };
}

export function recordDigest(record: unknown): string {
  return digestOf(record);
}
