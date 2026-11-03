// Shared half of the staging adapters: everything that is the same whether staging is a linked worktree or a
// local clone (ONB-3, ONB-4). A subclass decides how `prepare` builds the staging copy and which git
// directories the sandbox must deny; reads, edits-against-the-pin, listing and confined file access are common.
// Every git call goes through runGit, which carries the safe-git environment; calls that compare or write
// working-tree files also neutralize the repository's filter drivers.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

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
import { collectRepoFacts, parseStatus } from './repo-facts.ts';
import { runGit } from './safe-git.ts';

export const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const ONBOARDING_ID = /^[A-Za-z0-9_]{1,64}$/;

// Limits of the ignore-rule reader (see ignoredByCommittedRules).
const MAX_IGNORE_FILES = 200;
const MAX_IGNORE_FILE_BYTES = 1024 * 1024;
const MAX_IGNORE_CANDIDATES = 5000;
const IGNORE_CHUNK = 500;

// A candidate git can be asked about on its command line without quoting or option confusion: plain path characters only.
const isCheckable = (candidate: string): boolean => /^[A-Za-z0-9._+@][A-Za-z0-9._+@/-]*$/.test(candidate) && !candidate.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');

// A last segment with no extension may name a directory (`dist`, `.shots`, `node_modules`).
const mayBeDirectory = (candidate: string): boolean => (candidate.split('/').at(-1) as string).lastIndexOf('.') <= 0;

export function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

export function denied(rule: string): Result<never> {
  return err({ kind: 'denied', rule, enforcer: 'avarice' });
}

export function failure(error: PortError): Result<never> {
  return err(error);
}

export function nulSplit(text: string): string[] {
  return text.split('\0').filter((entry) => entry.length > 0);
}

export function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export interface StagingTarget {
  workRoot: string;
  // {workRoot}/{onboardingId}: the directory AVARICE creates for this onboarding.
  onboardingDir: string;
  // {workRoot}/{onboardingId}/staging
  staging: string;
  branch: string;
}

// Validation before any side effect: the pin flows into git argv and the onboarding ID into a path.
export function resolveStagingTarget(input: PrepareInput): Result<StagingTarget> {
  if (!COMMIT_SHA.test(input.pin)) return invalid('pin', 'a full lowercase commit SHA is required');
  if (!ONBOARDING_ID.test(input.onboardingId)) return invalid('onboardingId', 'letters, digits and underscore only');
  if (!isAbsolute(input.workRoot)) return invalid('workRoot', 'an absolute path is required');
  const workRoot = resolve(input.workRoot);
  const onboardingDir = join(workRoot, input.onboardingId);
  const staging = join(onboardingDir, 'staging');
  if (!inside(workRoot, resolve(staging)) || resolve(staging) === workRoot) {
    return invalid('onboardingId', 'staging path would be outside the work root');
  }
  return ok({ workRoot, onboardingDir, staging, branch: `avarice/onboard-${input.onboardingId}` });
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

export abstract class GitStagingWorkspace implements StagingWorkspace {
  abstract prepare(input: PrepareInput): Result<StagingInfo>;

  // The git directories the sandbox must deny and what it must still be able to read of the user repository.
  protected abstract gitAccess(gitDir: string, commonDir: string): { gitPaths: string[]; repoReadAllow: string[] };

  head(path: string): Result<string> {
    const head = runGit(['rev-parse', 'HEAD'], { cwd: path });
    return head.ok ? ok(head.value.stdout.trim()) : failure(head.error);
  }

  changes(path: string, pin: string): Result<StagingChanges> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const diff = runGit(['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', pin, '--'], { cwd: path, neutralizeFilters: true });
    if (!diff.ok) return failure(diff.error);
    const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: path, neutralizeFilters: true });
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
      ...this.gitAccess(gitDir, commonDir),
    });
  }

  listTracked(path: string, pin: string): Result<string[]> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const listed = runGit(['ls-tree', '-r', '--name-only', '-z', pin], { cwd: path });
    return listed.ok ? ok(nulSplit(listed.value.stdout)) : failure(listed.error);
  }

  readTrackedAtPin(_path: string, _pin: string, _relPaths: readonly string[]): Result<Record<string, string>> {
    return ok({});
  }

  // Which candidates the repository's own committed `.gitignore` files ignore at the pin (deferred item 10). The rule files are
  // read as blobs of the pinned tree and written into a throwaway repository beside staging (a fresh `git init` with no
  // template, no user or system excludes), and `git check-ignore --no-index` there decides, so git's own matching applies
  // (anchoring, nesting, negation, directory rules, ignored parents) and nothing the staging working tree, its
  // `.git/info/exclude`, the user's checkout or the machine's configuration says can add a rule. A symbolic link named
  // `.gitignore` is not a rule file (git does not follow it either). More rule files than the cap, or one above the size cap,
  // answers "nothing is ignored" and never a partial rule set: that can only keep a reference dangling, never forgive one.
  ignoredByCommittedRules(path: string, pin: string, candidates: readonly string[]): Result<string[]> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    const wanted = [...new Set(candidates)].filter(isCheckable).slice(0, MAX_IGNORE_CANDIDATES);
    if (wanted.length === 0) return ok([]);

    const listed = runGit(['ls-tree', '-r', '-z', pin], { cwd: path });
    if (!listed.ok) return failure(listed.error);
    const ruleFiles: Array<{ path: string; sha: string }> = [];
    for (const entry of nulSplit(listed.value.stdout)) {
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const [mode, type, sha] = entry.slice(0, tab).split(' ');
      const file = entry.slice(tab + 1);
      if (type !== 'blob' || !(mode ?? '').startsWith('100') || sha === undefined) continue;
      if (file.split('/').at(-1) !== '.gitignore') continue;
      if (file.split('/').some((segment) => segment.toLowerCase() === '.git')) continue;
      ruleFiles.push({ path: file, sha });
    }
    if (ruleFiles.length === 0) return ok([]);
    if (ruleFiles.length > MAX_IGNORE_FILES) return ok([]);

    let scratchDir: string;
    try {
      scratchDir = mkdtempSync(join(dirname(path), 'ignore-'));
    } catch (error) {
      return err({ kind: 'internal', cause: `cannot create a directory for the ignore rules: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
    }
    try {
      const initialized = runGit(['init', '-q', '--template='], { cwd: scratchDir });
      if (!initialized.ok) return failure(initialized.error);
      for (const file of ruleFiles) {
        const blob = runGit(['cat-file', 'blob', file.sha], { cwd: path });
        if (!blob.ok) return failure(blob.error);
        if (Buffer.byteLength(blob.value.stdout, 'utf8') > MAX_IGNORE_FILE_BYTES) return ok([]);
        const target = join(scratchDir, ...file.path.split('/'));
        if (!inside(scratchDir, resolve(target))) return ok([]);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, blob.value.stdout);
      }

      // Each candidate is asked as written; one that may be a directory (no extension on its last segment) is asked with a
      // trailing slash too, because a rule such as `dist/` matches only a directory and git cannot tell that `dist` is one.
      const asked = new Map<string, string>();
      for (const candidate of wanted) {
        asked.set(candidate, candidate);
        if (mayBeDirectory(candidate)) asked.set(`${candidate}/`, candidate);
      }
      const names = [...asked.keys()];
      const ignored = new Set<string>();
      for (let start = 0; start < names.length; start += IGNORE_CHUNK) {
        const answer = runGit(['check-ignore', '--no-index', '--', ...names.slice(start, start + IGNORE_CHUNK)], {
          cwd: scratchDir,
          acceptExit: [1],
          noUserExcludes: true,
        });
        if (!answer.ok) return failure(answer.error);
        for (const line of answer.value.stdout.split('\n')) {
          const origin = asked.get(line);
          if (origin !== undefined) ignored.add(origin);
        }
      }
      return ok(wanted.filter((candidate) => ignored.has(candidate)));
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
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
    return collectRepoFacts(repoPath);
  }
}
