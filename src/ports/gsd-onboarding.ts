// GsdOnboarding port (docs/contracts-and-state.md "GsdOnboarding"): semantic operations over GSD's
// onboarding surface, so application code never sees slash-command syntax, gsd-tools argv or GSD file
// layouts. Phase 1 admits one GSD distribution and line (@opengsd/gsd-core 1.17.x). Every mutating
// operation takes the staging path and runs with that path as its working directory; none is ever
// pointed at the user's checkout.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

export const GSD_ADMITTED_PACKAGE = '@opengsd/gsd-core';
// Human-readable form of the admitted version line, for messages and events.
export const GSD_ADMITTED_RANGE = '1.17.x';

export interface GsdCapabilitySnapshot {
  version: string;
  packageName: string;
  // Directory of the located gsd-core (the one that holds bin/gsd-tools.cjs).
  gsdCoreDir: string;
  // Where GSD itself looks for its agent definitions: `{gsdCoreDir}/../agents`.
  agentsDir: string;
  // Names of the operations this GSD supports: init-onboard, map-full, map-fast, stamp, verify-drift.
  capabilities: string[];
}

// The projection of `init onboard --raw`, reduced to what AVARICE decides on. GSD's own identifiers are kept
// verbatim (next_action.kind, file names).
export interface GsdProjectState {
  isBrownfield: boolean;
  mapReadiness: 'complete' | 'fast' | 'none';
  missingMapFiles: string[];
  planningFiles: Record<string, boolean>;
  // GSD's own next_action.kind, verbatim.
  nextAction: string;
  lastMappedCommit?: string;
  docCandidates: string[];
}

export type GsdSetting = readonly [key: string, value: string];

export interface GsdAppliedSetting {
  key: string;
  value: string;
}

// `stamp-codebase-map` output.
export interface GsdStampResult {
  stamped: string[];
  failed: string[];
  commit: string | null;
  skipped: boolean;
}

// `verify codebase-drift` output, reduced.
export interface GsdDriftResult {
  block: boolean;
  skipped: boolean;
  reason: string | null;
  lastMappedCommit: string | null;
  threshold: number | null;
  action: string | null;
  affectedPaths: string[];
}

// `graphify build snapshot` output: the diff snapshot GSD writes next to the installed graph.
export interface GsdGraphSnapshot {
  saved: boolean;
  nodeCount: number;
  edgeCount: number;
}

// `graphify status` output, reduced. `exists` is false (and the counts zero) when GSD finds no graph; `disabled` is
// true when `graphify.enabled` is off in the staging config. `stale` folds GSD's age rule with the auto-update
// status; `commitStale` is null when GSD could not compare the build commit with HEAD.
export interface GsdGraphStatus {
  disabled: boolean;
  exists: boolean;
  stale: boolean;
  commitStale: boolean | null;
  commitsBehind: number | null;
  builtAtCommit: string | null;
  currentCommit: string | null;
  nodeCount: number;
  edgeCount: number;
}

// `intel validate` output, reduced. `disabled` is true when `intel.enabled` is off in the staging config.
export interface GsdIntelValidation {
  disabled: boolean;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// `intel diff` output, reduced: the files whose hash differs from the snapshot `intel snapshot` wrote. `noBaseline` is
// true when there is no readable snapshot, so nothing can be said about change.
export interface GsdIntelDiff {
  disabled: boolean;
  noBaseline: boolean;
  changed: string[];
  added: string[];
  removed: string[];
}

// `intel snapshot` output, reduced: GSD hashed the intel files into `.planning/intel/.last-refresh.json`, which `intel diff` then
// compares against. `files` is how many files it hashed. `disabled` is true when `intel.enabled` is off in the staging config.
export interface GsdIntelSnapshot {
  disabled: boolean;
  saved: boolean;
  files: number;
}

export interface GsdIntelFileStatus {
  exists: boolean;
  updatedAt: string | null;
  stale: boolean;
}

// `intel status` output, reduced.
export interface GsdIntelStatus {
  disabled: boolean;
  files: Record<string, GsdIntelFileStatus>;
  overallStale: boolean;
}

export interface GsdIntelEntry {
  key: string;
  value: unknown;
}

// `intel query <term>` output: the matching entries of each intel file, as GSD's own reader found them.
export interface GsdIntelQueryResult {
  disabled: boolean;
  matches: Array<{ source: string; entries: GsdIntelEntry[] }>;
  total: number;
  truncated: boolean;
}

export type GsdGraphConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GsdGraphNode {
  id: string;
  label: string;
  fileType: string | null;
  sourceFile: string | null;
  description: string | null;
}

export interface GsdGraphEdge {
  source: string;
  target: string;
  relation: string | null;
  // GSD's confidence tier for the edge; null when the graph gives none GSD recognizes.
  confidence: GsdGraphConfidence | null;
}

// `graphify query <term> --budget <n>` output, reduced. To meet the budget GSD drops AMBIGUOUS, then INFERRED, then
// EXTRACTED edges; `budgetMet` is null when no budget was asked for.
export interface GsdGraphQueryResult {
  disabled: boolean;
  nodes: GsdGraphNode[];
  edges: GsdGraphEdge[];
  trimmed: string | null;
  budgetMet: boolean | null;
  budgetEstimate: number | null;
}

export interface GsdOnboarding {
  readonly descriptor: CapabilityDescriptor;
  // What this GSD can do. No side effects; `unsupported` when the located gsd-core is outside the range.
  inspect(): Result<GsdCapabilitySnapshot>;
  // `init onboard --raw` with cwd = staging (the projection can rewrite staging `.planning/config.json`).
  probeState(staging: string): Promise<Result<GsdProjectState>>;
  // One `config-set` per setting, in order, each awaited, with cwd = staging. Never run inside an invocation.
  configure(staging: string, settings: readonly GsdSetting[]): Promise<Result<GsdAppliedSetting[]>>;
  // `stamp-codebase-map [--files ...]` with cwd = staging.
  stamp(staging: string, files?: readonly string[]): Promise<Result<GsdStampResult>>;
  // `verify codebase-drift` with cwd = staging. Read-only.
  checkDrift(staging: string): Promise<Result<GsdDriftResult>>;
  // `graphify build snapshot` with cwd = staging; writes only `.planning/graphs` (the installed graph must exist).
  graphifySnapshot(staging: string): Promise<Result<GsdGraphSnapshot>>;
  // `graphify status` with cwd = staging. Read-only; the result says whether GSD sees the installed graph as fresh.
  graphifyStatus(staging: string): Promise<Result<GsdGraphStatus>>;
  // `intel validate|diff|status` and `intel query <term>` with cwd = staging. Read-only: they write nothing. AVARICE never edits
  // an intel document (they are written only by the contained intel invocation); its one write there is the snapshot below.
  intelValidate(staging: string): Promise<Result<GsdIntelValidation>>;
  intelDiff(staging: string): Promise<Result<GsdIntelDiff>>;
  // `intel snapshot` with cwd = staging and `.planning/intel` the one writable directory (it writes only `.last-refresh.json`
  // there). Run by AVARICE after the contained intel invocation ended, never inside it (decision A, 2026-11-03: the hook denies
  // the verb to the model, so AVARICE takes the snapshot itself, as it stamps a map).
  intelSnapshot(staging: string): Promise<Result<GsdIntelSnapshot>>;
  intelStatus(staging: string): Promise<Result<GsdIntelStatus>>;
  intelQuery(staging: string, term: string): Promise<Result<GsdIntelQueryResult>>;
  // `graphify query <term> --budget <n>` with cwd = staging: GSD's own reader, never the standalone `graphify query`.
  graphifyQuery(staging: string, term: string, budget: number): Promise<Result<GsdGraphQueryResult>>;
  // Planning initialization is out of scope for Phase 1; always `unsupported`.
  initPlanning(): Result<never>;
}
