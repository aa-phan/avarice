// Promotion of the accepted map into the user's repository (plan 04-21; ONB-6, ONB-5, D-15). The only code that writes to the user's checkout during
// an onboarding, and it writes in two ways only:
//
//  - copyIntoCheckout: a file under `.planning/` where the target is absent. A target that is byte-identical is left as it is and counted as present;
//    any other target (different bytes, a symbolic link, a directory, a path whose parent is not a directory) is left untouched and reported as a
//    conflict. A file is never replaced or deleted: it is written beside its target and linked into place, and a link refuses an existing name, so a
//    file that appears between the check and the write is a conflict too (S-28, T-04-56).
//  - commitPromotion: one commit on `refs/heads/avarice/onboard-<id>`, built in the staging clone (which must be its own repository) from the pin and the
//    accepted files, then fetched into the user's repository by a create-only fetch, as the run hand-off does. No checkout, no index, no working-tree
//    file and no other ref of the user's repository changes (T-04-58).
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CommitPromotionInput, CommitPromotionOutcome, CopyOutcome, PromotionFile } from '../../ports/staging-workspace.ts';
import { runGit } from './safe-git.ts';
import { COMMIT_SHA, ONBOARDING_ID, checkRelative, ensureConfinedDir, failure, invalid, readConfinedFile, sortedUnique } from './staging-base.ts';

const PLANNING = '.planning';
// A map document above this size is compared as a conflict without being read in full.
const MAX_COMPARE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;
// The commit identity of AVARICE's own commit: a machine's identity or signing configuration changes nothing about it.
const COMMIT_IDENTITY = { name: 'AVARICE', email: 'avarice@localhost' } as const;
// Where the commit is parked in the staging clone before the fetch; outside refs/heads and refs/tags, so the clone's branch and HEAD do not move.
const PARK_REF = 'refs/avarice/promote';

// A promoted path is a relative path inside `.planning/`; the checker rejects traversal, absolute paths and NUL bytes.
function checkPromotionPath(path: string): Result<string[]> {
  const segments = checkRelative(path);
  if (!segments.ok) return segments;
  if (segments.value.length < 2 || segments.value[0] !== PLANNING) return invalid('files', `${JSON.stringify(path)} is not a path under ${PLANNING}/`);
  if (segments.value.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) return invalid('files', `${JSON.stringify(path)} has a character a promoted path does not allow`);
  return segments;
}

function checkFiles(files: readonly PromotionFile[]): Result<void> {
  if (files.length === 0) return invalid('files', 'at least one file is required');
  const seen = new Set<string>();
  for (const file of files) {
    const checked = checkPromotionPath(file.path);
    if (!checked.ok) return checked;
    if (seen.has(file.path)) return invalid('files', `${file.path} is listed twice`);
    seen.add(file.path);
  }
  return ok(undefined);
}

function repoRootOf(repoPath: string): Result<string> {
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath });
  if (!top.ok) return failure(top.error);
  try {
    return ok(realpathSync(top.value.stdout.trim()));
  } catch {
    return err({ kind: 'not_found', ref: repoPath });
  }
}

// Writes `content` at `target` only when nothing is there: the bytes go to a temporary name in the same directory and are hard-linked to the target, which
// fails with EEXIST rather than replace. The temporary name is always removed. Returns false when the name was taken.
function createExclusive(target: string, content: Uint8Array): Result<boolean> {
  const temporary = join(dirname(target), `.avarice-promote-${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o644 });
    chmodSync(temporary, 0o644);
    try {
      linkSync(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return ok(false);
      return err({ kind: 'internal', cause: `cannot create ${target}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
    }
    return ok(true);
  } catch (error) {
    return err({ kind: 'internal', cause: `cannot write beside ${target}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name was never created, or is already gone.
    }
  }
}

export function copyIntoCheckout(repoPath: string, files: readonly PromotionFile[]): Result<CopyOutcome> {
  const checked = checkFiles(files);
  if (!checked.ok) return checked;
  if (!isAbsolute(repoPath)) return invalid('repoPath', 'an absolute path is required');
  const root = repoRootOf(repoPath);
  if (!root.ok) return root;

  const written: string[] = [];
  const present: string[] = [];
  const conflicts: string[] = [];
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const wanted = Buffer.from(file.content);
    const read = readConfinedFile(root.value, file.path, MAX_COMPARE_BYTES);
    if (!read.ok) {
      // A symbolic link out of the checkout, a file above the cap: whatever is there is the owner's, and is left as it is.
      if (read.error.kind === 'denied' || read.error.kind === 'invalid') {
        conflicts.push(file.path);
        continue;
      }
      return read;
    }
    if (read.value !== null) {
      if (Buffer.from(read.value, 'utf8').equals(wanted)) present.push(file.path);
      else conflicts.push(file.path);
      continue;
    }

    const directory = ensureConfinedDir(root.value, dirname(file.path));
    if (!directory.ok) {
      if (directory.error.kind === 'denied' || directory.error.kind === 'invalid') {
        conflicts.push(file.path);
        continue;
      }
      return directory;
    }
    const created = createExclusive(join(root.value, ...file.path.split('/')), wanted);
    if (!created.ok) return created;
    (created.value ? written : conflicts).push(file.path);
  }
  return ok({ written: sortedUnique(written), present: sortedUnique(present), conflicts: sortedUnique(conflicts) });
}

// The commit of the accepted files on top of the pin, built through a temporary index so the clone's own index and working tree are not read or written.
function buildCommit(stagingRoot: string, input: CommitPromotionInput): Result<string> {
  const tmpRoot = join(dirname(stagingRoot), 'tmp');
  let dir: string;
  try {
    mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
    dir = mkdtempSync(join(tmpRoot, 'promote-'));
  } catch (error) {
    return err({ kind: 'internal', cause: `cannot create a temporary directory: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
  }
  try {
    const indexFile = join(dir, 'index');
    const base = { cwd: stagingRoot, indexFile, neutralizeFilters: true } as const;
    const read = runGit(['read-tree', input.pin], base);
    if (!read.ok) return failure(read.error);
    let n = 0;
    for (const file of input.files) {
      const blobFile = join(dir, `blob-${n++}`);
      writeFileSync(blobFile, file.content, { flag: 'wx', mode: 0o600 });
      const hashed = runGit(['hash-object', '-w', '--no-filters', '--', blobFile], { cwd: stagingRoot, neutralizeFilters: true });
      if (!hashed.ok) return failure(hashed.error);
      const blob = hashed.value.stdout.trim();
      if (!COMMIT_SHA.test(blob)) return err({ kind: 'internal', cause: 'git hash-object did not print an object id' });
      const added = runGit(['update-index', '--add', '--cacheinfo', `100644,${blob},${file.path}`], base);
      if (!added.ok) return failure(added.error);
    }
    const tree = runGit(['write-tree'], base);
    if (!tree.ok) return failure(tree.error);
    const treeId = tree.value.stdout.trim();
    if (!COMMIT_SHA.test(treeId)) return err({ kind: 'internal', cause: 'git write-tree did not print a tree id' });
    const committed = runGit(['commit-tree', treeId, '-p', input.pin, '-m', input.message], { cwd: stagingRoot, identity: COMMIT_IDENTITY });
    if (!committed.ok) return failure(committed.error);
    const commit = committed.value.stdout.trim();
    return COMMIT_SHA.test(commit) ? ok(commit) : err({ kind: 'internal', cause: 'git commit-tree did not print a commit id' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function commitPromotion(input: CommitPromotionInput): Result<CommitPromotionOutcome> {
  if (!ONBOARDING_ID.test(input.onboardingId)) return invalid('onboardingId', 'letters, digits and underscore only');
  if (!COMMIT_SHA.test(input.pin)) return invalid('pin', 'a full lowercase commit SHA is required');
  if (!isAbsolute(input.repoPath) || !isAbsolute(input.stagingPath)) return invalid('path', 'absolute paths are required');
  if (input.message.trim() === '') return invalid('message', 'a commit message is required');
  const checked = checkFiles(input.files);
  if (!checked.ok) return checked;
  const branch = `avarice/onboard-${input.onboardingId}`;
  const ref = `refs/heads/${branch}`;

  const source = repoRootOf(input.repoPath);
  if (!source.ok) return source;
  let stagingRoot: string;
  try {
    stagingRoot = realpathSync(input.stagingPath);
  } catch {
    return err({ kind: 'not_found', ref: input.stagingPath });
  }
  // The commit is made inside the staging clone. A staging copy that shares the user's repository (a linked worktree) would put the commit's ref there.
  const own = join(stagingRoot, '.git');
  if (!existsSync(own)) return invalid('stagingPath', 'promotion by commit needs a staging clone with its own repository');
  const common = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: stagingRoot });
  if (!common.ok) return failure(common.error);
  if (realpathSync(common.value.stdout.trim()) !== realpathSync(own)) return invalid('stagingPath', 'promotion by commit needs a staging clone with its own repository');

  const hasPin = runGit(['cat-file', '-e', `${input.pin}^{commit}`], { cwd: source.value });
  if (!hasPin.ok) return err({ kind: 'not_found', ref: input.pin });
  const existing = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: source.value, acceptExit: [1] });
  if (!existing.ok) return failure(existing.error);
  if (existing.value.stdout.trim().length > 0) return err({ kind: 'conflict', expected: `${ref} absent`, actual: `${ref} at ${existing.value.stdout.trim()}` });

  const commit = buildCommit(stagingRoot, input);
  if (!commit.ok) return commit;
  const parked = runGit(['update-ref', PARK_REF, commit.value], { cwd: stagingRoot });
  if (!parked.ok) return failure(parked.error);

  // Not forced (`+` is refused by runGit) and into a ref that does not exist, so it can only create the branch.
  const fetched = runGit(['fetch', '--no-tags', '--no-write-fetch-head', '--', stagingRoot, `${PARK_REF}:${ref}`], { cwd: source.value, fsck: true, timeoutMs: FETCH_TIMEOUT_MS });
  if (!fetched.ok) return failure(fetched.error);
  const created = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: source.value, acceptExit: [1] });
  if (!created.ok) return failure(created.error);
  if (created.value.stdout.trim() !== commit.value) return err({ kind: 'internal', cause: `${ref} is not at ${commit.value} after the fetch` });
  return ok({ branch, commit: commit.value, created: true });
}
