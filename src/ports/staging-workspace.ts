// StagingWorkspace port (SKELETON.md "Ports"). Application code reaches the staging copy of a repository
// only through this port; the adapter is the only code that touches git or the filesystem.
// `inspectRepo` is read-only: it reports names, never file contents (ONB-3).
import type { Result } from '../domain/result.ts';

export interface PrepareInput {
  // The user's repository; prepare never writes to its working tree.
  repoPath: string;
  // The profile work root; staging lives at {workRoot}/{onboardingId}/staging.
  workRoot: string;
  onboardingId: string;
  // Full commit SHA recorded at registration; only this SHA is used afterwards.
  pin: string;
}

export interface StagingInfo {
  path: string;
  branch: string;
  strategy: 'worktree' | 'clone';
}

export interface WorkspaceDescription {
  topLevelEntries: string[];
  planningEntries: string[];
  // Git metadata directories the staging copy needs at run time (worktree git dir, common dir).
  gitPaths: string[];
  // Paths inside the user's repository a sandboxed reader must be allowed to read for staging to work.
  repoReadAllow: string[];
}

export interface StagingChanges {
  modified: string[];
  added: string[];
  deleted: string[];
}

export interface RepoFacts {
  gitRoot: string;
  rootCommit: string;
  // Remote URL of `origin` with any credentials removed.
  remote?: string;
  pin: string;
  // Empty string when HEAD is detached.
  branch: string;
  // Names of tracked files with uncommitted changes.
  modified: string[];
  // Names of untracked files (not ignored).
  untracked: string[];
}

export interface StagingWorkspace {
  prepare(input: PrepareInput): Result<StagingInfo>;
  head(path: string): Result<string>;
  changes(path: string, pin: string): Result<StagingChanges>;
  describe(path: string, pin: string): Result<WorkspaceDescription>;
  listTracked(path: string, pin: string): Result<string[]>;
  // UTF-8 text of a staging file; null when absent; refuses traversal, absolute paths and symlinks that
  // leave staging, and files above maxBytes.
  read(path: string, relPath: string, maxBytes: number): Result<string | null>;
  ensureDir(path: string, relPath: string): Result<void>;
  inspectRepo(repoPath: string): Result<RepoFacts>;
}
