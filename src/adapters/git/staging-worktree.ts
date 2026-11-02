// WorktreeStagingWorkspace (ONB-3, ONB-4): a detached `git worktree` of the user's repository at the pinned
// SHA, switched to `avarice/onboard-{onb}`, under the profile work root. The user's checkout is never
// written: its working tree, index and HEAD are untouched, and the only footprint inside `.git` is the
// worktree metadata and one branch ref (research, "Staging worktree mechanics"). Every git call goes
// through runGit, which carries the safe-git environment.
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type {
  PrepareInput,
  RepoFacts,
  StagingChanges,
  StagingInfo,
  StagingWorkspace,
  WorkspaceDescription,
} from '../../ports/staging-workspace.ts';
import { runGit } from './safe-git.ts';

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ONBOARDING_ID = /^[A-Za-z0-9_]{1,64}$/;
const LOCK_REASON = 'avarice-onboarding';

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function denied(rule: string): Result<never> {
  return err({ kind: 'denied', rule, enforcer: 'avarice' });
}

function failure(error: PortError): Result<never> {
  return err(error);
}

function nulSplit(text: string): string[] {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

// Lexical check shared by read and ensureDir: relative, no `..` segment, no NUL.
function checkRelative(relPath: string): Result<string[]> {
  if (typeof relPath !== 'string' || relPath.length === 0) return invalid('relPath', 'a relative path is required');
  if (relPath.includes('\0')) return invalid('relPath', 'path contains a NUL byte');
  if (isAbsolute(relPath)) return denied('staging-paths-are-relative');
  const segments = relPath.split(/[\\/]/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.includes('..')) return denied('staging-paths-stay-inside-staging');
  if (segments.length === 0) return invalid('relPath', 'a relative path is required');
  return ok(segments);
}

function stripCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

interface StatusEntries {
  modified: string[];
  untracked: string[];
}

// `git status --porcelain=v2 -z`: records are NUL separated; a rename or copy record (`2`) is followed by
// one extra NUL-separated field, its original path.
function parseStatus(stdout: string): StatusEntries {
  const modified: string[] = [];
  const untracked: string[] = [];
  const fields = stdout.split('\0');
  const pathAfter = (record: string, spaces: number): string => {
    let from = 0;
    for (let i = 0; i < spaces; i++) from = record.indexOf(' ', from) + 1;
    return record.slice(from);
  };
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i] as string;
    if (record.length === 0) continue;
    switch (record[0]) {
      case '1':
        modified.push(pathAfter(record, 8));
        break;
      case '2':
        modified.push(pathAfter(record, 9));
        i++;
        break;
      case 'u':
        modified.push(pathAfter(record, 10));
        break;
      case '?':
        untracked.push(record.slice(2));
        break;
      default:
        break;
    }
  }
  return { modified: modified.sort(), untracked: untracked.sort() };
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export class WorktreeStagingWorkspace implements StagingWorkspace {
  prepare(input: PrepareInput): Result<StagingInfo> {
    if (!COMMIT_SHA.test(input.pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    if (!ONBOARDING_ID.test(input.onboardingId)) return invalid('onboardingId', 'letters, digits and underscore only');
    if (!isAbsolute(input.workRoot)) return invalid('workRoot', 'an absolute path is required');
    const workRoot = resolve(input.workRoot);
    const staging = join(workRoot, input.onboardingId, 'staging');
    if (!inside(workRoot, resolve(staging)) || resolve(staging) === workRoot) {
      return invalid('onboardingId', 'staging path would be outside the work root');
    }
    const branch = `avarice/onboard-${input.onboardingId}`;

    const top = runGit(['rev-parse', '--show-toplevel'], { cwd: input.repoPath });
    if (!top.ok) return failure(top.error);
    const repoRoot = top.value.stdout.trim();
    const exists = runGit(['cat-file', '-e', `${input.pin}^{commit}`], { cwd: repoRoot });
    if (!exists.ok) return err({ kind: 'not_found', ref: input.pin });

    const info: StagingInfo = { path: staging, branch, strategy: 'worktree' };
    if (existsSync(staging)) {
      const reused = this.reuse(info, repoRoot, input.pin);
      return reused.ok ? ok(info) : reused;
    }

    mkdirSync(join(workRoot, input.onboardingId), { recursive: true, mode: 0o700 });
    const added = runGit(['worktree', 'add', '--detach', staging, input.pin], { cwd: repoRoot });
    if (!added.ok) return failure(added.error);
    const finished = this.finish(info, repoRoot);
    return finished.ok ? ok(info) : finished;
  }

  // An existing staging directory is reused only when it is a worktree of this repository that contains the
  // pin. A crash between `worktree add`, the branch switch and the lock leaves a partial state; finish()
  // completes whatever is missing.
  private reuse(info: StagingInfo, repoRoot: string, pin: string): Result<void> {
    const common = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: info.path });
    const mine = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot });
    if (!common.ok || !mine.ok) return err({ kind: 'conflict', expected: 'a git worktree of the repository', actual: 'an existing directory that is not' });
    if (realpathSync(common.value.stdout.trim()) !== realpathSync(mine.value.stdout.trim())) {
      return err({ kind: 'conflict', expected: `a worktree of ${repoRoot}`, actual: 'a worktree of another repository' });
    }
    const head = runGit(['rev-parse', 'HEAD'], { cwd: info.path });
    if (!head.ok) return failure(head.error);
    const contains = runGit(['merge-base', '--is-ancestor', pin, 'HEAD'], { cwd: info.path });
    if (!contains.ok) return err({ kind: 'conflict', expected: `staging containing pin ${pin}`, actual: `staging at ${head.value.stdout.trim()}` });
    return this.finish(info, repoRoot);
  }

  private finish(info: StagingInfo, repoRoot: string): Result<void> {
    const current = runGit(['branch', '--show-current'], { cwd: info.path });
    if (!current.ok) return failure(current.error);
    const onBranch = current.value.stdout.trim();
    if (onBranch === '') {
      const switched = runGit(['switch', '-c', info.branch], { cwd: info.path });
      if (!switched.ok) return failure(switched.error);
    } else if (onBranch !== info.branch) {
      return err({ kind: 'conflict', expected: `branch ${info.branch}`, actual: `branch ${onBranch}` });
    }
    const listing = runGit(['worktree', 'list', '--porcelain', '-z'], { cwd: repoRoot });
    if (!listing.ok) return failure(listing.error);
    const stagingReal = realpathSync(info.path);
    const locked = nulSplit(listing.value.stdout.replaceAll('\n', '\0')).some((field, index, all) => {
      if (field !== `worktree ${stagingReal}`) return false;
      for (let i = index + 1; i < all.length && !(all[i] as string).startsWith('worktree '); i++) {
        if ((all[i] as string).startsWith('locked')) return true;
      }
      return false;
    });
    if (!locked) {
      const lock = runGit(['worktree', 'lock', '--reason', LOCK_REASON, info.path], { cwd: repoRoot });
      if (!lock.ok) return failure(lock.error);
    }
    return ok(undefined);
  }

  head(path: string): Result<string> {
    const head = runGit(['rev-parse', 'HEAD'], { cwd: path });
    return head.ok ? ok(head.value.stdout.trim()) : failure(head.error);
  }

  changes(path: string, pin: string): Result<StagingChanges> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const diff = runGit(['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', pin, '--'], { cwd: path });
    if (!diff.ok) return failure(diff.error);
    const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: path });
    if (!status.ok) return failure(status.error);

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const tokens = nulSplit(diff.value.stdout);
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const letter = (tokens[i] as string)[0];
      const file = tokens[i + 1] as string;
      if (letter === 'A') added.push(file);
      else if (letter === 'D') deleted.push(file);
      else modified.push(file);
    }
    added.push(...parseStatus(status.value.stdout).untracked);
    return ok({ modified: sortedUnique(modified), added: sortedUnique(added), deleted: sortedUnique(deleted) });
  }

  describe(path: string, pin: string): Result<WorkspaceDescription> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const top = runGit(['ls-tree', '--name-only', '-z', pin], { cwd: path });
    if (!top.ok) return failure(top.error);
    const planning = runGit(['ls-tree', '--name-only', '-z', pin, '.planning/'], { cwd: path });
    if (!planning.ok) return failure(planning.error);
    const dirs = runGit(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { cwd: path });
    if (!dirs.ok) return failure(dirs.error);
    const [gitDir, commonDir] = dirs.value.stdout.split('\n').filter((line) => line.length > 0);
    if (gitDir === undefined || commonDir === undefined) return err({ kind: 'internal', cause: 'git did not report its directories' });
    return ok({
      topLevelEntries: nulSplit(top.value.stdout),
      planningEntries: nulSplit(planning.value.stdout),
      gitPaths: sortedUnique([gitDir, commonDir]),
      repoReadAllow: [commonDir],
    });
  }

  listTracked(path: string, pin: string): Result<string[]> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const listed = runGit(['ls-tree', '-r', '--name-only', '-z', pin], { cwd: path });
    return listed.ok ? ok(nulSplit(listed.value.stdout)) : failure(listed.error);
  }

  read(path: string, relPath: string, maxBytes: number): Result<string | null> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return invalid('maxBytes', 'a non-negative integer is required');
    const segments = checkRelative(relPath);
    if (!segments.ok) return segments;
    let root: string;
    try {
      root = realpathSync(path);
    } catch {
      return err({ kind: 'not_found', ref: path });
    }
    const target = join(root, ...segments.value);

    // A parent that resolves outside staging is refused even when the file itself is absent.
    let parent: string;
    try {
      parent = realpathSync(join(root, ...segments.value.slice(0, -1)));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return ok(null);
      return err({ kind: 'internal', cause: `read ${relPath}: ${code ?? String(error)}` });
    }
    if (!inside(root, parent)) return denied('staging-reads-stay-inside-staging');

    try {
      lstatSync(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return ok(null);
      return err({ kind: 'internal', cause: `read ${relPath}: ${code ?? String(error)}` });
    }
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      return denied('staging-reads-stay-inside-staging');
    }
    if (!inside(root, real)) return denied('staging-reads-stay-inside-staging');

    let fd: number;
    try {
      fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      return err({ kind: 'internal', cause: `read ${relPath}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) return invalid('relPath', 'not a regular file');
      if (stat.size > maxBytes) return invalid('size', `${stat.size} bytes exceeds the limit of ${maxBytes}`);
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const n = readSync(fd, buffer, offset, buffer.length - offset, null);
        if (n === 0) break;
        offset += n;
      }
      return ok(buffer.toString('utf8', 0, offset));
    } finally {
      closeSync(fd);
    }
  }

  ensureDir(path: string, relPath: string): Result<void> {
    const segments = checkRelative(relPath);
    if (!segments.ok) return segments;
    let current: string;
    try {
      current = realpathSync(path);
    } catch {
      return err({ kind: 'not_found', ref: path });
    }
    for (const segment of segments.value) {
      current = join(current, segment);
      let stat;
      try {
        stat = lstatSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return err({ kind: 'internal', cause: `ensureDir ${relPath}: ${String(error)}` });
        }
        mkdirSync(current);
        continue;
      }
      if (stat.isSymbolicLink()) return denied('staging-reads-stay-inside-staging');
      if (!stat.isDirectory()) return invalid('relPath', `${segment} exists and is not a directory`);
    }
    return ok(undefined);
  }

  inspectRepo(repoPath: string): Result<RepoFacts> {
    const cwd = repoPath;
    const top = runGit(['rev-parse', '--show-toplevel'], { cwd });
    if (!top.ok) return failure(top.error);
    const roots = runGit(['rev-list', '--max-parents=0', 'HEAD'], { cwd });
    if (!roots.ok) return failure(roots.error);
    const pin = runGit(['rev-parse', 'HEAD'], { cwd });
    if (!pin.ok) return failure(pin.error);
    const branch = runGit(['branch', '--show-current'], { cwd });
    if (!branch.ok) return failure(branch.error);
    const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd });
    if (!status.ok) return failure(status.error);
    const remote = runGit(['remote', 'get-url', 'origin'], { cwd });

    // A repository can have several root commits; the lowest SHA is a stable, deterministic choice.
    const rootCommit = roots.value.stdout.split('\n').filter((line) => line.length > 0).sort()[0];
    if (rootCommit === undefined) return err({ kind: 'internal', cause: 'repository has no root commit' });
    const parsed = parseStatus(status.value.stdout);
    const facts: RepoFacts = {
      gitRoot: top.value.stdout.trim(),
      rootCommit,
      pin: pin.value.stdout.trim(),
      branch: branch.value.stdout.trim(),
      modified: parsed.modified,
      untracked: parsed.untracked,
    };
    if (remote.ok && remote.value.stdout.trim().length > 0) facts.remote = stripCredentials(remote.value.stdout.trim());
    return ok(facts);
  }
}
