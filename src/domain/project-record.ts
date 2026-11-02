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
}

// Something validation or narrowing noted about this record: a name and a reason, never document text.
export interface RecordFinding {
  source: 'validation' | 'narrowing';
  field: string;
  reason: string;
  detail?: string;
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
  indexes: Record<string, never>;
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
    indexes: {},
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

export function recordDigest(record: unknown): string {
  return digestOf(record);
}
