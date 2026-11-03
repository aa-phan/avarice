// StagingWorkspace port (SKELETON.md "Ports"). Application code reaches the staging copy of a repository
// only through this port; the adapter is the only code that touches git or the filesystem.
// `inspectRepo` is read-only: it reports names of uncommitted and untracked files, never their contents, and
// reads committed content only (through git objects at the pinned commit), never a file of the checkout
// (ONB-3, T-01-16).
import type { RepoFacts } from '../domain/preflight.ts';
import type { Result } from '../domain/result.ts';

export type { MapFileFacts, RepoFacts } from '../domain/preflight.ts';

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

export interface StagingWorkspace {
  prepare(input: PrepareInput): Result<StagingInfo>;
  head(path: string): Result<string>;
  changes(path: string, pin: string): Result<StagingChanges>;
  describe(path: string, pin: string): Result<WorkspaceDescription>;
  listTracked(path: string, pin: string): Result<string[]>;
  // The subset of `candidates` (repository-relative paths) that the repository's own committed `.gitignore` files ignore at
  // `pin` (deferred item 10): the files are read from git objects at the pin, never from the staging or the user's working
  // tree, and matched by git itself. Nothing else counts as a rule (no `.git/info/exclude`, no user or system excludes).
  // UTF-8 text of tracked files, read as blobs of the pinned tree (never from a working tree). A path that is not a tracked blob at the pin,
  // or is above the size cap, is left out of the answer.
  readTrackedAtPin(path: string, pin: string, relPaths: readonly string[]): Result<Record<string, string>>;
  ignoredByCommittedRules(path: string, pin: string, candidates: readonly string[]): Result<string[]>;
  // UTF-8 text of a staging file; null when absent; refuses traversal, absolute paths and symlinks that
  // leave staging, and files above maxBytes.
  read(path: string, relPath: string, maxBytes: number): Result<string | null>;
  ensureDir(path: string, relPath: string): Result<void>;
  inspectRepo(repoPath: string): Result<RepoFacts>;
}
