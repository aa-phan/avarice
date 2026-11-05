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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type {
  CommitInput,
  FetchIntoSourceInput,
  HandoffResult,
  PathChange,
  PrepareRunInput,
  RunWorkspace,
  RunWorkspaceDescription,
  RunWorkspaceInfo,
  WorkspaceSnapshot,
} from '../../ports/run-workspace.ts';
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

export class CloneRunWorkspace implements RunWorkspace {
  prepare(input: PrepareRunInput): Result<RunWorkspaceInfo> {
    const target = resolveRunTarget(input);
    if (!target.ok) return target;
    const { runDir, clone, branch } = target.value;
    const prepared = prepareClone(input.repoPath, { parentDir: runDir, path: clone, branch, pin: input.pin });
    return prepared.ok ? ok({ path: clone, branch }) : prepared;
  }

  head(path: string): Result<string> {
    const head = runGit(['rev-parse', 'HEAD'], { cwd: path });
    return head.ok ? ok(head.value.stdout.trim()) : failure(head.error);
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
      const base = { cwd: path, indexFile, timeoutMs: TREE_TIMEOUT_MS } as const;
      const read = runGit(['read-tree', 'HEAD'], base);
      if (!read.ok) return failure(read.error);
      const added = runGit(['add', '-A'], { ...base, neutralizeFilters: true, noUserExcludes: true });
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
