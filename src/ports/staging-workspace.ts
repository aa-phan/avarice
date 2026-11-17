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

// A file of the accepted map, promoted by its repository-relative path (under `.planning/`) and its bytes.
export interface PromotionFile {
  path: string;
  content: Uint8Array;
}

// What `copyIntoCheckout` did with each file: written (the target was absent), present (the target held the same bytes) or conflicts (anything else is
// the owner's and was not touched). Sorted.
export interface CopyOutcome {
  written: string[];
  present: string[];
  conflicts: string[];
}

export interface CommitPromotionInput {
  // The user's repository and the staging clone the commit is built in.
  repoPath: string;
  stagingPath: string;
  onboardingId: string;
  // The revision the onboarding was pinned to; the commit's only parent.
  pin: string;
  files: readonly PromotionFile[];
  message: string;
}

export interface CommitPromotionOutcome {
  // `avarice/onboard-<onboarding id>`, created in the user's repository as `refs/heads/<branch>` at `commit`.
  branch: string;
  commit: string;
  created: true;
}

export interface StagingWorkspace {
  prepare(input: PrepareInput): Result<StagingInfo>;
  head(path: string): Result<string>;
  changes(path: string, pin: string): Result<StagingChanges>;
  describe(path: string, pin: string): Result<WorkspaceDescription>;
  listTracked(path: string, pin: string): Result<string[]>;
  // The repository-relative paths that differ between two commits of the staging repository (`git diff --name-only`), sorted and unique; names only,
  // from git objects. Refuses a revision that is not a full lowercase commit SHA, and a diff of more than 20000 paths (a refresh then plans a full map).
  changedBetween(path: string, from: string, to: string): Result<string[]>;
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
  // Promotion (plan 04-21; ONB-6, D-15), the only writes to the user's repository. `copyIntoCheckout` writes a file under `.planning/` of the checkout
  // only where the target is absent; a byte-identical target is counted as present and any other is a conflict, left untouched. It never replaces or
  // deletes. `commitPromotion` commits the files on top of the pin in the staging clone and creates `refs/heads/avarice/onboard-<id>` in the user's
  // repository with a create-only fetch: no checkout, index, working-tree file or other ref changes. It refuses (conflict) a branch that exists.
  copyIntoCheckout(repoPath: string, files: readonly PromotionFile[]): Result<CopyOutcome>;
  commitPromotion(input: CommitPromotionInput): Result<CommitPromotionOutcome>;
}
