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
  // Planning initialization is out of scope for Phase 1; always `unsupported`.
  initPlanning(): Result<never>;
}
