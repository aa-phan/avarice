// RunWorkspace port (D-01, D-02, D-03, CON-9, CON-16). The git side of one run: a local clone of the source at the pin
// on branch `avarice/<runId>`, the changes the run made inside it, the supervisor's own commit of those changes, and the
// hand-off of the run branch to the source as one new ref. Every method runs in the supervisor, outside any invocation; the
// contained model never calls it and never writes git metadata. The adapter is the only code that touches git or the
// filesystem for a run.
//
// Nothing here writes to the user's checkout except `fetchIntoSource`, and that creates exactly one ref
// (`refs/heads/avarice/<runId>`): no checkout, no reset, no clean, no index or working-tree change.
import type { Result } from '../domain/result.ts';

export interface PrepareRunInput {
  // The user's repository; prepare never writes to it.
  repoPath: string;
  // The profile work root; the clone lives at {workRoot}/{runId}/clone.
  workRoot: string;
  runId: string;
  // Full commit SHA of the active project record's pin (D-04); only this SHA is used afterwards.
  pin: string;
}

export interface RunWorkspaceInfo {
  path: string;
  // `avarice/<runId>`
  branch: string;
}

export interface PrepareValidationInput {
  // The user's repository; never written.
  repoPath: string;
  // The profile work root; the validation clone lives at {workRoot}/{runId}/validate.
  workRoot: string;
  runId: string;
  // Full commit SHA of the pin; the clone is detached there and has no branch.
  pin: string;
}

export interface RunWorkspaceDescription {
  topLevelEntries: string[];
  // Entry names (not paths) of each requested directory at HEAD; a directory HEAD does not have maps to [].
  entriesByDir: Record<string, string[]>;
  // Git metadata directories the sandbox must deny for the run (the clone's own `.git`).
  gitPaths: string[];
  // Paths inside the user's repository a sandboxed reader must be allowed to read; none for a clone.
  repoReadAllow: string[];
}

export interface PathChange {
  // Clone-relative path, as git reports it.
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface CommitInput {
  // Clone-relative paths and nothing else is committed. Refused: an empty list, an absolute path, `..`, a `.git` segment, a leading `-`.
  paths: readonly string[];
  message: string;
  // `Key: value` lines appended to the message after a blank line.
  trailers?: readonly string[];
}

export interface FetchIntoSourceInput {
  repoPath: string;
  clonePath: string;
  // `avarice/<runId>`
  branch: string;
}

export interface HandoffResult {
  // false when the source already had that ref at the same commit.
  created: boolean;
  commit: string;
}

export interface WorkspaceSnapshot {
  head: string;
  // Tree of the clone's tracked and untracked non-ignored content at the moment of the snapshot.
  tree: string;
  // Ignored entries present at the moment of the snapshot (at most 10 000); discard never removes an ignored entry.
  ignored: string[];
}

export interface HeadTrailers {
  runId: string | null;
  attemptId: string | null;
  // The parent commit IDs of HEAD, first parent first: one for an ordinary commit, two for a merge, none for a root commit.
  parents: string[];
}

export interface DiscardResult {
  // Paths put back to their snapshot content (a path the run changed or deleted).
  restored: string[];
  // Paths the snapshot did not have, deleted.
  removed: string[];
  // Ignored entries that exist now and were not in the snapshot; left in place.
  ignoredLeft: string[];
}

export interface RunWorkspace {
  // Clone at the pin, on `avarice/<runId>`, built in clone.partial and renamed when complete.
  prepare(input: PrepareRunInput): Result<RunWorkspaceInfo>;
  // ONB-10: a scratch clone of the source at the pin, detached, with no branch, where a declared check is run to see what it writes. Returns its
  // path. An existing validation clone of this repository at the pin is reused.
  prepareValidationClone(input: PrepareValidationInput): Result<string>;
  head(path: string): Result<string>;
  // The `Avarice-Run:` and `Avarice-Attempt:` trailers of the HEAD commit message (plan 02-17: a resume decides whether a commit on the clone is the
  // supervisor's own, made for the open attempt, from these and nothing else). A trailer the message does not carry is null.
  headTrailers(path: string): Result<HeadTrailers>;
  // Every path that differs from HEAD or is not tracked, one record per file: tracked changes, untracked files and ignored files
  // (an ignored directory is listed file by file). The validation of a check compares two of these.
  statusAll(path: string): Result<string[]>;
  // Clone-relative paths of the tracked and the untracked, non-ignored files, sorted (a tracked file that was deleted is still listed).
  listFiles(path: string): Result<string[]>;
  describe(path: string, relPaths: readonly string[]): Result<RunWorkspaceDescription>;
  // Working-tree content (tracked and untracked, not ignored) compared with HEAD.
  status(path: string): Result<PathChange[]>;
  // Records HEAD and a tree of the current working content; the clone's own index is not touched.
  snapshot(path: string): Result<WorkspaceSnapshot>;
  // What changed since the snapshot, by path.
  changedSince(path: string, snapshot: WorkspaceSnapshot): Result<PathChange[]>;
  // Puts every path changed since the snapshot back to its snapshot content and deletes the paths the snapshot did not have (CON-16).
  // `conflict` (head-moved) when HEAD is not the snapshot's HEAD, and nothing is changed. Ignored paths and paths the run did not
  // change are never touched, and nothing is deleted recursively. A second call after a first changes nothing.
  discard(path: string, snapshot: WorkspaceSnapshot): Result<DiscardResult>;
  // The supervisor's commit (D-03): fixed identity, no hooks, no signing, exactly `paths`. Returns the commit SHA.
  commit(path: string, input: CommitInput): Result<string>;
  // D-02: fetch `refs/heads/<branch>` of the clone into the source as a new local branch. Create-only.
  fetchIntoSource(input: FetchIntoSourceInput): Result<HandoffResult>;
  // Puts tracked paths back to their content at HEAD (D-17: the GSD records and settings the supervisor keeps off the review branch).
  // Every path must exist at HEAD (`conflict` otherwise, nothing changed); a path is one file, never a directory. Returns the paths restored.
  restorePaths(path: string, relPaths: readonly string[]): Result<string[]>;
  // Deletes untracked files (a file or a link, never a directory, never through a symlink) and then the directories they leave empty,
  // up to but not including the clone root. A path that exists at HEAD is refused (`conflict`) and nothing is changed. Returns the files removed.
  removeUntracked(path: string, relPaths: readonly string[]): Result<string[]>;
  // What changed between two commits, by path (the diff gate of G4 reads `<pin> HEAD`).
  diffCommits(path: string, from: string, to: string): Result<PathChange[]>;
  // UTF-8 text of a clone file; null when absent; refuses traversal, absolute paths and symlinks that leave the clone.
  readText(path: string, relPath: string, maxBytes: number): Result<string | null>;
  ensureDir(path: string, relPath: string): Result<void>;
}
