// Project record builder (docs/repository-onboarding.md "Project record").
// The record holds operational metadata only: paths, digests, revisions and classifications of GSD
// artifacts, never their content (ONB-2). A record version is immutable once stored.
import { digestOf } from './digest.ts';
import { completenessFor } from './mapping.ts';
import type { Completeness, MappingMode } from './mapping.ts';

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
  paths?: Partial<RecordPaths>;
  execution?: Partial<RecordExecution>;
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
  gsd: { version: string };
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
  commands: never[];
}

// Defaults grant nothing: no write paths, no endpoints, no credentials. Repository proposals and later
// plans can only narrow authority (ONB-9); widening needs a new record version through policy.
export function buildProjectRecord(input: ProjectRecordInput): ProjectRecord {
  const paths = input.paths ?? {};
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
    // The GSD version is read by the adapter in plan 01-09.
    gsd: { version: 'unknown' },
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
    paths: {
      read: [...(paths.read ?? ['**'])],
      write: [...(paths.write ?? [])],
      protected: [...(paths.protected ?? [])],
      generated: [...(paths.generated ?? [])],
      artifacts: [...(paths.artifacts ?? [])],
    },
    execution: {
      toolClasses: [...(execution.toolClasses ?? ['read'])],
      environments: [...(execution.environments ?? ['local-sandbox'])],
      endpoints: [...(execution.endpoints ?? [])],
      credentials: [...(execution.credentials ?? [])],
    },
    commands: [],
  };
}

export function recordDigest(record: unknown): string {
  return digestOf(record);
}
