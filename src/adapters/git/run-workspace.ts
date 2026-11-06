// CloneRunWorkspace (D-01, D-02, D-03; CON-9, CON-16): the git side of one run, behind the RunWorkspace port. A run works in a
// local clone at {workRoot}/{runId}/clone on branch `avarice/<runId>`, built by the same partial-then-rename rules as onboarding
// staging (prepareClone). The source repository is never written by preparation. Everything here runs in the supervisor, outside any
// invocation, through runGit: no hooks, no fsmonitor, filter drivers blanked on every call that reads or writes working-tree files,
// no global option, no free configuration.
//
//  - commit: the supervisor commits, not the model (D-03), under a fixed identity, unsigned, with `--no-verify`, exactly the
//    clone-relative paths it is given.
//  - fetchIntoSource: the one write to the user's repository (D-02). It creates `refs/heads/avarice/<runId>` and nothing else.
//    It is create-only (an existing equal ref is success, a different one a conflict and nothing is fetched), never forced,
//    never checks anything out, and runs with fsck on because the objects come from a tree an agent wrote into.
//  - snapshot, changedSince, status: a tree of the clone's tracked and untracked non-ignored content is computed through a
//    temporary index file under {workRoot}/{runId}/tmp, so the clone's own index is never touched.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type {
  CommitInput,
  DiscardResult,
  FetchIntoSourceInput,
  HandoffResult,
  HeadTrailers,
  PathChange,
  PrepareRunInput,
  PrepareValidationInput,
  RunWorkspace,
  RunWorkspaceDescription,
  RunWorkspaceInfo,
  WorkspaceSnapshot,
} from '../../ports/run-workspace.ts';
import { parseStatus } from './repo-facts.ts';
import { runGit } from './safe-git.ts';
import { prepareClone } from './staging-clone.ts';
import { checkRelative, COMMIT_SHA, ensureConfinedDir, failure, inside, invalid, nulSplit, readConfinedFile, sortedUnique } from './staging-base.ts';

export const AVARICE_COMMIT_IDENTITY: Readonly<{ name: string; email: string }> = Object.freeze({ name: 'AVARICE', email: 'avarice@localhost.invalid' });

const RUN_ID = /^[A-Za-z0-9_]{1,64}$/;
const RUN_BRANCH = /^avarice\/[A-Za-z0-9_]{1,64}$/;
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: [^\r\n\0]+$/;
// Hashing and writing a whole working tree, and fetching a run's objects, can exceed the default per-call timeout.
const TREE_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 120_000;
const MAX_IGNORED = 10_000;
const RESTORE_CHUNK = 200;

interface RunTarget {
  runDir: string;
  clone: string;
  branch: string;
}

// Validation before any side effect: the pin flows into git argv and the run ID into a path and a ref name.
function resolveRunTarget(input: PrepareRunInput): Result<RunTarget> {
  if (!COMMIT_SHA.test(input.pin)) return invalid('pin', 'a full lowercase commit SHA is required');
  if (!RUN_ID.test(input.runId)) return invalid('runId', 'letters, digits and underscore only');
  if (!isAbsolute(input.workRoot)) return invalid('workRoot', 'an absolute path is required');
  const workRoot = resolve(input.workRoot);
  const runDir = join(workRoot, input.runId);
  const clone = join(runDir, 'clone');
  if (!inside(workRoot, resolve(clone)) || resolve(clone) === workRoot) return invalid('runId', 'clone path would be outside the work root');
  return ok({ runDir, clone, branch: `avarice/${input.runId}` });
}

// A path the supervisor may pass to `git add` and `git commit`: relative, inside the clone, never git's own directory, never an option.
function checkCommitPath(path: unknown): Result<string> {
  if (typeof path !== 'string' || path.length === 0) return invalid('paths', 'every path must be a non-empty string');
  if (path.startsWith('-')) return invalid('paths', `${JSON.stringify(path)} starts with a dash`);
  if (isAbsolute(path)) return invalid('paths', `${JSON.stringify(path)} is absolute`);
  const checked = checkRelative(path);
  if (!checked.ok) return invalid('paths', `${JSON.stringify(path)} is not a clone-relative path`);
  if (checked.value.some((segment) => segment.toLowerCase() === '.git')) return invalid('paths', `${JSON.stringify(path)} names git's own directory`);
  return ok(checked.value.join('/'));
}

function parseNameStatus(stdout: string): PathChange[] {
  const tokens = nulSplit(stdout);
  const changes: PathChange[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const letter = (tokens[i] as string)[0];
    const path = tokens[i + 1] as string;
    changes.push({ path, status: letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified' });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Delete one path the run added. The leaf is unlinked as it is (a symlink is removed as a link, never followed); a directory is never
// removed; a parent that resolves outside the clone, because the run planted a symlink there, is refused before anything is touched.
// Returns false when the path was already gone.
function removeAddedPath(root: string, rel: string): Result<boolean> {
  const segments = checkRelative(rel);
  if (!segments.ok) return segments;
  const parts = segments.value;
  let parent: string;
  try {
    parent = realpathSync(join(root, ...parts.slice(0, -1)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return ok(false);
    return err({ kind: 'internal', cause: `discard ${rel}: ${code ?? String(error)}` });
  }
  if (!inside(root, parent)) return err({ kind: 'denied', rule: 'discard-stays-inside-the-clone', enforcer: 'avarice' });
  const target = join(parent, parts[parts.length - 1] as string);
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ok(false);
    return err({ kind: 'internal', cause: `discard ${rel}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
  }
  if (stat.isDirectory()) return err({ kind: 'conflict', expected: `${rel} to be a file or a link`, actual: 'a directory, which discard never removes' });
  try {
    unlinkSync(target);
  } catch (error) {
    return err({ kind: 'internal', cause: `discard ${rel}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
  }
  return ok(true);
}

// Before a snapshot file is written back, a directory standing where it belongs is removed when it is empty (the run's added files
// in it are already gone). A directory with anything left in it, such as ignored files, is not touched and the discard stops.
function clearDirectoryInTheWay(root: string, rel: string): Result<void> {
  const segments = checkRelative(rel);
  if (!segments.ok) return segments;
  const target = join(root, ...segments.value);
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return ok(undefined); // absent, or a parent is absent: restore creates it
  }
  if (!stat.isDirectory()) return ok(undefined);
  try {
    rmdirSync(target);
  } catch {
    return err({ kind: 'conflict', expected: `${rel} to be restorable as a file`, actual: 'a directory that is not empty (ignored or unlisted content), left untouched' });
  }
  return ok(undefined);
}

export class CloneRunWorkspace implements RunWorkspace {
  prepare(input: PrepareRunInput): Result<RunWorkspaceInfo> {
    const target = resolveRunTarget(input);
    if (!target.ok) return target;
    const { runDir, clone, branch } = target.value;
    const prepared = prepareClone(input.repoPath, { parentDir: runDir, path: clone, branch, pin: input.pin });
    return prepared.ok ? ok({ path: clone, branch }) : prepared;
  }

  // ONB-10: the scratch clone a declared check is validated in. Same clone rules as the run clone (prepareClone), detached at the pin.
  prepareValidationClone(input: PrepareValidationInput): Result<string> {
    const target = resolveRunTarget({ ...input });
    if (!target.ok) return target;
    const clone = join(target.value.runDir, 'validate');
    const prepared = prepareClone(input.repoPath, { parentDir: target.value.runDir, path: clone, branch: null, pin: input.pin });
    return prepared.ok ? ok(clone) : prepared;
  }

  head(path: string): Result<string> {
    const head = runGit(['rev-parse', 'HEAD'], { cwd: path });
    return head.ok ? ok(head.value.stdout.trim()) : failure(head.error);
  }

  // The last `Avarice-Run:` and `Avarice-Attempt:` lines of the HEAD message. The message is read as data and only those two keys are matched, each
  // on a line of its own, so text elsewhere in the message cannot pose as a trailer (the supervisor writes them last, after a blank line).
  headTrailers(path: string): Result<HeadTrailers> {
    const message = runGit(['log', '-1', '--format=%B'], { cwd: path });
    if (!message.ok) return failure(message.error);
    const found: HeadTrailers = { runId: null, attemptId: null };
    const lines = message.value.stdout.split('\n');
    for (const line of lines) {
      const run = /^Avarice-Run: ([A-Za-z0-9_]{1,64})\s*$/.exec(line);
      if (run !== null) found.runId = run[1] as string;
      const attempt = /^Avarice-Attempt: ([A-Za-z0-9_]{1,64})\s*$/.exec(line);
      if (attempt !== null) found.attemptId = attempt[1] as string;
    }
    return ok(found);
  }

  // `--ignored=traditional` with `--untracked-files=all` prints each ignored file as its own record (the matching mode hides the files of
  // an ignored directory), so a check that writes into an ignored place is seen.
  statusAll(path: string): Result<string[]> {
    const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=traditional'], { cwd: path, neutralizeFilters: true, timeoutMs: TREE_TIMEOUT_MS });
    if (!status.ok) return failure(status.error);
    const parsed = parseStatus(status.value.stdout);
    return ok(sortedUnique([...parsed.modified, ...parsed.untracked]));
  }

  listFiles(path: string): Result<string[]> {
    const listed = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: path, noUserExcludes: true, timeoutMs: TREE_TIMEOUT_MS });
    return listed.ok ? ok(sortedUnique(nulSplit(listed.value.stdout))) : failure(listed.error);
  }

  describe(path: string, relPaths: readonly string[]): Result<RunWorkspaceDescription> {
    const top = runGit(['ls-tree', '--name-only', '-z', 'HEAD'], { cwd: path });
    if (!top.ok) return failure(top.error);
    const entriesByDir: Record<string, string[]> = {};
    for (const rel of relPaths) {
      const checked = checkRelative(rel);
      if (!checked.ok) return checked;
      const dir = checked.value.join('/');
      const listed = runGit(['ls-tree', '--name-only', '-z', 'HEAD', '--', `${dir}/`], { cwd: path, literalPathspecs: true });
      if (!listed.ok) return failure(listed.error);
      entriesByDir[dir] = nulSplit(listed.value.stdout).map((entry) => entry.slice(dir.length + 1));
    }
    const dirs = runGit(['rev-parse', '--path-format=absolute', '--git-dir'], { cwd: path });
    if (!dirs.ok) return failure(dirs.error);
    const gitDir = dirs.value.stdout.split('\n').find((line) => line.length > 0);
    if (gitDir === undefined) return err({ kind: 'internal', cause: 'git did not report its directory' });
    return ok({ topLevelEntries: nulSplit(top.value.stdout), entriesByDir, gitPaths: [gitDir], repoReadAllow: [] });
  }

  status(path: string): Result<PathChange[]> {
    const tree = this.treeOfWorkingContent(path);
    if (!tree.ok) return tree;
    return this.diffTrees(path, 'HEAD', tree.value);
  }

  snapshot(path: string): Result<WorkspaceSnapshot> {
    const head = this.head(path);
    if (!head.ok) return head;
    const tree = this.treeOfWorkingContent(path);
    if (!tree.ok) return tree;
    const ignored = this.ignoredEntries(path);
    if (!ignored.ok) return ignored;
    return ok({ head: head.value, tree: tree.value, ignored: ignored.value });
  }

  changedSince(path: string, snapshot: WorkspaceSnapshot): Result<PathChange[]> {
    const tree = this.treeOfWorkingContent(path);
    if (!tree.ok) return tree;
    return this.diffTrees(path, snapshot.tree, tree.value);
  }

  // CON-16: put the clone back to its snapshot, and nothing else. The paths come only from the tree difference snapshot -> now, so a
  // path the run did not change is never named; a user's pre-run edit is in the snapshot tree and is restored to the user's version,
  // not HEAD's; ignored paths are in neither tree and are never touched. There is no reset, no clean and no checkout of the
  // clone: files are rewritten one path at a time by `restore --source=<snapshot tree> --worktree`, and an added path is
  // unlinked (a file or a symlink, never a directory, never through a symlink).
  discard(path: string, snapshot: WorkspaceSnapshot): Result<DiscardResult> {
    const head = this.head(path);
    if (!head.ok) return head;
    if (head.value !== snapshot.head) {
      return err({ kind: 'conflict', expected: `head-moved: HEAD at ${snapshot.head}`, actual: `HEAD at ${head.value}` });
    }
    const changes = this.changedSince(path, snapshot);
    if (!changes.ok) return changes;
    let root: string;
    try {
      root = realpathSync(path);
    } catch {
      return err({ kind: 'not_found', ref: path });
    }

    // Additions first: a file the run put where the snapshot had a directory, or a symlink where it had one, must be gone before
    // the snapshot's files can be written back.
    const removed: string[] = [];
    for (const change of changes.value.filter((c) => c.status === 'added')) {
      const gone = removeAddedPath(root, change.path);
      if (!gone.ok) return gone;
      if (gone.value) removed.push(change.path);
    }

    const restored = changes.value.filter((c) => c.status !== 'added').map((c) => c.path);
    for (const rel of restored) {
      // The snapshot had a file here and the run left a directory: it is empty once its added files are gone, or it is not ours.
      const cleared = clearDirectoryInTheWay(root, rel);
      if (!cleared.ok) return cleared;
    }
    for (let start = 0; start < restored.length; start += RESTORE_CHUNK) {
      const batch = restored.slice(start, start + RESTORE_CHUNK);
      const done = runGit(['restore', `--source=${snapshot.tree}`, '--worktree', '--', ...batch], { cwd: path, neutralizeFilters: true, literalPathspecs: true, timeoutMs: TREE_TIMEOUT_MS });
      if (!done.ok) return failure(done.error);
    }

    const after = this.treeOfWorkingContent(path);
    if (!after.ok) return after;
    if (after.value !== snapshot.tree) {
      const left = this.diffTrees(path, snapshot.tree, after.value);
      const names = left.ok ? left.value.slice(0, 5).map((c) => c.path).join(', ') : 'unknown';
      return err({ kind: 'internal', cause: `discard did not reach the snapshot tree; still different: ${names}` });
    }

    const ignored = this.ignoredEntries(path);
    if (!ignored.ok) return ignored;
    const known = new Set(snapshot.ignored);
    return ok({ restored: sortedUnique(restored), removed: sortedUnique(removed), ignoredLeft: ignored.value.filter((entry) => !known.has(entry)) });
  }

  commit(path: string, input: CommitInput): Result<string> {
    if (!Array.isArray(input.paths) || input.paths.length === 0) return invalid('paths', 'at least one path is required');
    const paths: string[] = [];
    for (const candidate of input.paths) {
      const checked = checkCommitPath(candidate);
      if (!checked.ok) return checked;
      paths.push(checked.value);
    }
    if (typeof input.message !== 'string' || input.message.trim().length === 0 || input.message.includes('\0')) return invalid('message', 'a non-empty message without NUL is required');
    const trailers = input.trailers ?? [];
    for (const trailer of trailers) {
      if (!TRAILER.test(trailer)) return invalid('trailers', `${JSON.stringify(trailer)} is not a single "Key: value" line`);
    }
    const message = trailers.length === 0 ? input.message : `${input.message.replace(/\s+$/, '')}\n\n${trailers.join('\n')}`;

    const options = { cwd: path, neutralizeFilters: true, noUserExcludes: true, literalPathspecs: true, timeoutMs: TREE_TIMEOUT_MS } as const;
    const added = runGit(['add', '--', ...paths], options);
    if (!added.ok) return failure(added.error);
    const staged = runGit(['diff', '--cached', '--name-only', '-z', 'HEAD', '--', ...paths], options);
    if (!staged.ok) return failure(staged.error);
    if (nulSplit(staged.value.stdout).length === 0) return err({ kind: 'conflict', expected: 'a change in the given paths', actual: 'no change in them' });

    // `commit -- <paths>` commits exactly those paths from the working tree and leaves anything else staged out of it.
    const committed = runGit(['commit', '--no-verify', '--no-gpg-sign', '--quiet', '-m', message, '--', ...paths], { ...options, identity: AVARICE_COMMIT_IDENTITY });
    if (!committed.ok) return failure(committed.error);
    return this.head(path);
  }

  // The subset of `paths` that exists at HEAD.
  private presentAtHead(path: string, paths: readonly string[]): Result<Set<string>> {
    const listed = runGit(['ls-tree', '--name-only', '-z', 'HEAD', '--', ...paths], { cwd: path, literalPathspecs: true });
    return listed.ok ? ok(new Set(nulSplit(listed.value.stdout))) : failure(listed.error);
  }

  private checkedPaths(relPaths: readonly string[]): Result<string[]> {
    if (!Array.isArray(relPaths) || relPaths.length === 0) return invalid('paths', 'at least one path is required');
    const paths: string[] = [];
    for (const candidate of relPaths) {
      const checked = checkCommitPath(candidate);
      if (!checked.ok) return checked;
      paths.push(checked.value);
    }
    return ok([...new Set(paths)]);
  }

  restorePaths(path: string, relPaths: readonly string[]): Result<string[]> {
    const paths = this.checkedPaths(relPaths);
    if (!paths.ok) return paths;
    const present = this.presentAtHead(path, paths.value);
    if (!present.ok) return present;
    const missing = paths.value.filter((p) => !present.value.has(p));
    if (missing.length > 0) return err({ kind: 'conflict', expected: 'every path to exist at HEAD', actual: `${missing.slice(0, 5).join(', ')} not at HEAD` });
    for (let start = 0; start < paths.value.length; start += RESTORE_CHUNK) {
      const batch = paths.value.slice(start, start + RESTORE_CHUNK);
      const done = runGit(['restore', '--source=HEAD', '--worktree', '--', ...batch], { cwd: path, neutralizeFilters: true, literalPathspecs: true, timeoutMs: TREE_TIMEOUT_MS });
      if (!done.ok) return failure(done.error);
    }
    return ok(paths.value);
  }

  removeUntracked(path: string, relPaths: readonly string[]): Result<string[]> {
    const paths = this.checkedPaths(relPaths);
    if (!paths.ok) return paths;
    const present = this.presentAtHead(path, paths.value);
    if (!present.ok) return present;
    const tracked = paths.value.filter((p) => present.value.has(p));
    if (tracked.length > 0) return err({ kind: 'conflict', expected: 'untracked paths only', actual: `${tracked.slice(0, 5).join(', ')} exist at HEAD` });
    let root: string;
    try {
      root = realpathSync(path);
    } catch {
      return err({ kind: 'not_found', ref: path });
    }
    const removed: string[] = [];
    for (const rel of paths.value) {
      const gone = removeAddedPath(root, rel);
      if (!gone.ok) return gone;
      if (gone.value) removed.push(rel);
      // The directories the file leaves empty go too; a directory with anything in it stays.
      const parts = rel.split('/');
      for (let depth = parts.length - 1; depth > 0; depth -= 1) {
        const dir = join(root, ...parts.slice(0, depth));
        try {
          rmdirSync(dir);
        } catch {
          break;
        }
      }
    }
    return ok(removed);
  }

  diffCommits(path: string, from: string, to: string): Result<PathChange[]> {
    if (!COMMIT_SHA.test(from) || !COMMIT_SHA.test(to)) return invalid('revision', 'full lowercase commit SHAs are required');
    return this.diffTrees(path, from, to);
  }

  fetchIntoSource(input: FetchIntoSourceInput): Result<HandoffResult> {
    if (!RUN_BRANCH.test(input.branch)) return invalid('branch', 'avarice/<runId> is required');
    if (!isAbsolute(input.clonePath)) return invalid('clonePath', 'an absolute path is required');
    const ref = `refs/heads/${input.branch}`;

    const cloneCommit = runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: input.clonePath, acceptExit: [1] });
    if (!cloneCommit.ok) return failure(cloneCommit.error);
    const commit = cloneCommit.value.stdout.trim();
    if (!COMMIT_SHA.test(commit)) return err({ kind: 'not_found', ref: `${input.branch} in the run clone` });

    const top = runGit(['rev-parse', '--show-toplevel'], { cwd: input.repoPath });
    if (!top.ok) return failure(top.error);
    const source = realpathSync(top.value.stdout.trim());

    const existing = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: source, acceptExit: [1] });
    if (!existing.ok) return failure(existing.error);
    const present = existing.value.stdout.trim();
    if (present.length > 0) {
      if (present === commit) return ok({ created: false, commit });
      return err({ kind: 'conflict', expected: `${ref} absent or at ${commit}`, actual: `${ref} at ${present}` });
    }

    // Not forced (`+` is refused by runGit), so it can only create the ref; the ref name is run-unique.
    const fetched = runGit(['fetch', '--no-tags', '--no-write-fetch-head', '--', input.clonePath, `${ref}:${ref}`], { cwd: source, fsck: true, timeoutMs: FETCH_TIMEOUT_MS });
    if (!fetched.ok) return failure(fetched.error);
    const created = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: source, acceptExit: [1] });
    if (!created.ok) return failure(created.error);
    if (created.value.stdout.trim() !== commit) return err({ kind: 'internal', cause: `${ref} is not at ${commit} after the fetch` });
    return ok({ created: true, commit });
  }

  readText(path: string, relPath: string, maxBytes: number): Result<string | null> {
    return readConfinedFile(path, relPath, maxBytes);
  }

  ensureDir(path: string, relPath: string): Result<void> {
    return ensureConfinedDir(path, relPath);
  }

  // The tree of the clone's tracked and untracked non-ignored content, through a temporary index (never the clone's own).
  // `core.excludesFile` is blanked so only the repository's own ignore rules decide what is ignored.
  protected treeOfWorkingContent(path: string): Result<string> {
    if (!existsSync(path)) return err({ kind: 'not_found', ref: path });
    const tmpRoot = join(dirname(resolve(path)), 'tmp');
    let dir: string;
    try {
      mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
      dir = mkdtempSync(join(tmpRoot, 'idx-'));
    } catch (error) {
      return err({ kind: 'internal', cause: `cannot create a temporary index directory: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
    }
    try {
      const indexFile = join(dir, 'index');
      // Every call here neutralizes filters, `write-tree` included: it re-hashes a racily clean entry, which runs a clean filter.
      const base = { cwd: path, indexFile, neutralizeFilters: true, timeoutMs: TREE_TIMEOUT_MS } as const;
      const read = runGit(['read-tree', 'HEAD'], base);
      if (!read.ok) return failure(read.error);
      const added = runGit(['add', '-A'], { ...base, noUserExcludes: true });
      if (!added.ok) return failure(added.error);
      const written = runGit(['write-tree'], base);
      if (!written.ok) return failure(written.error);
      const tree = written.value.stdout.trim();
      return COMMIT_SHA.test(tree) ? ok(tree) : err({ kind: 'internal', cause: 'git write-tree did not print a tree id' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  protected diffTrees(path: string, from: string, to: string): Result<PathChange[]> {
    const diff = runGit(['diff-tree', '-r', '--name-status', '-z', '--no-renames', from, to], { cwd: path, timeoutMs: TREE_TIMEOUT_MS });
    return diff.ok ? ok(parseNameStatus(diff.value.stdout)) : failure(diff.error);
  }

  // Ignored entries present now (a wholly ignored directory is one entry with a trailing slash), at most MAX_IGNORED.
  protected ignoredEntries(path: string): Result<string[]> {
    const listed = runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: path, noUserExcludes: true, timeoutMs: TREE_TIMEOUT_MS });
    if (!listed.ok) return failure(listed.error);
    return ok(sortedUnique(nulSplit(listed.value.stdout)).slice(0, MAX_IGNORED));
  }
}
