// CloneStagingWorkspace (ONB-3, ONB-4, ONB-5, S-32): the staging strategy the owner chose in plan 01-08 on the
// evidence of spike S0-B. Staging is `git clone --local --no-hardlinks --no-checkout {repo} {staging}`,
// detached at the pin and switched to `avarice/onboard-{onb}`, all under the profile work root. Nothing is
// written to the user's repository: no worktree metadata, no branch ref, no object, not one byte under its
// `.git`. The clone's `.git` lives inside staging, so the sandbox can deny it in full and the user's checkout
// can be unreadable to the contained run. The clone also starts with no repository-defined configuration, so
// the user's filter drivers and `core.fsmonitor` do not exist in staging at all.
//
// Atomicity: the clone is built at {onboarding}/staging.partial and renamed to {onboarding}/staging only when
// it sits on the branch at the pin, so a `staging` directory is either complete or absent. A leftover
// staging.partial from a crash is removed only when it is demonstrably this adapter's own clone of this
// repository; anything else is reported as a conflict and left alone. `staging` itself is never removed.
//
// The clone, reuse and partial rules are module-level functions (`prepareClone`) so the run workspace (plan 02-07, D-01)
// builds `{workRoot}/{runId}/clone` by exactly the same rules instead of a copy of them.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { PrepareInput, StagingInfo } from '../../ports/staging-workspace.ts';
import { runGit } from './safe-git.ts';
import { failure, GitStagingWorkspace, resolveStagingTarget } from './staging-base.ts';

// A clone and checkout of a large repository can exceed the default per-call timeout.
const CLONE_TIMEOUT_MS = 120_000;

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export interface CloneTarget {
  // Created (0700) when absent; the clone and its partial directory live directly in it.
  parentDir: string;
  // `{parentDir}/staging` or `{parentDir}/clone`; its basename names it in conflict messages, and `{basename}.partial` is the build directory.
  path: string;
  // The branch the clone is switched to; null leaves it detached at the pin (the ONB-10 validation clone, plan 02-14).
  branch: string | null;
  // A full lowercase commit SHA, already validated: it reaches git argv.
  pin: string;
}

// Clone `repoPath` into `target.path` at the pin on `target.branch`, or accept an existing complete clone of the same
// repository at the pin on that branch. Anything else at the path is a conflict and is left untouched.
export function prepareClone(repoPath: string, target: CloneTarget): Result<void> {
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath });
  if (!top.ok) return failure(top.error);
  const repoRoot = realpathSync(top.value.stdout.trim());
  const exists = runGit(['cat-file', '-e', `${target.pin}^{commit}`], { cwd: repoRoot });
  if (!exists.ok) return err({ kind: 'not_found', ref: target.pin });

  if (existsSync(target.path)) return reusableClone(target, repoRoot);

  mkdirSync(target.parentDir, { recursive: true, mode: 0o700 });
  const partial = join(target.parentDir, `${basename(target.path)}.partial`);
  if (existsSync(partial)) {
    const cleared = clearOwnPartial(partial, repoRoot);
    if (!cleared.ok) return cleared;
  }

  const cloned = runGit(['clone', '--local', '--no-hardlinks', '--no-checkout', '--', repoRoot, partial], { cwd: target.parentDir, timeoutMs: CLONE_TIMEOUT_MS });
  if (!cloned.ok) return failure(cloned.error);
  // `pin` was validated as a full hex SHA, so git cannot read it as an option.
  const detached = runGit(['checkout', '--detach', target.pin], { cwd: partial, neutralizeFilters: true, timeoutMs: CLONE_TIMEOUT_MS });
  if (!detached.ok) return failure(detached.error);
  if (target.branch !== null) {
    const switched = runGit(['switch', '-c', target.branch], { cwd: partial });
    if (!switched.ok) return failure(switched.error);
  }
  renameSync(partial, target.path);
  return ok(undefined);
}

// An existing directory is reused only when it is its own git repository, a clone of this repository, on the
// branch, at the pin. Anything else is a conflict and is left untouched.
function reusableClone(target: CloneTarget, repoRoot: string): Result<void> {
  const noun = basename(target.path);
  const real = realpathOrNull(target.path);
  const toplevel = runGit(['rev-parse', '--show-toplevel'], { cwd: target.path });
  if (real === null || !toplevel.ok || realpathOrNull(toplevel.value.stdout.trim()) !== real) {
    return err({ kind: 'conflict', expected: `a git clone of the repository at the ${noun} path`, actual: 'an existing directory that is not a git repository of its own' });
  }
  const origin = runGit(['config', '--get', 'remote.origin.url'], { cwd: target.path });
  if (!origin.ok || realpathOrNull(origin.value.stdout.trim()) !== repoRoot) {
    return err({ kind: 'conflict', expected: `a clone of ${repoRoot}`, actual: 'a clone of another repository' });
  }
  const head = runGit(['rev-parse', 'HEAD'], { cwd: target.path });
  const current = runGit(['branch', '--show-current'], { cwd: target.path });
  if (!head.ok || !current.ok) return err({ kind: 'conflict', expected: `${noun} at pin ${target.pin}`, actual: 'a clone git cannot read' });
  if (head.value.stdout.trim() !== target.pin) {
    return err({ kind: 'conflict', expected: `${noun} at pin ${target.pin}`, actual: `${noun} at ${head.value.stdout.trim()}` });
  }
  if (current.value.stdout.trim() !== (target.branch ?? '')) {
    return err({ kind: 'conflict', expected: target.branch === null ? 'a detached HEAD' : `branch ${target.branch}`, actual: `branch ${current.value.stdout.trim() || '(detached)'}` });
  }
  return ok(undefined);
}

// A crash during the clone leaves {parent}/{noun}.partial. It is this adapter's own leftover when it is
// a real directory (not a symlink) that is either only an empty-ish `.git` or a clone whose origin is this
// repository; then it is replaced. Otherwise it is somebody else's data: a conflict, not removed.
function clearOwnPartial(partial: string, repoRoot: string): Result<void> {
  const stat = lstatSync(partial);
  const foreign = err({ kind: 'conflict', expected: `no ${basename(partial)}, or one that is an interrupted clone of this repository`, actual: `${partial} is something else` }) as Result<never>;
  if (!stat.isDirectory() || stat.isSymbolicLink()) return foreign;
  const entries = readdirSync(partial);
  const onlyGitDir = entries.length === 0 || (entries.length === 1 && entries[0] === '.git');
  const config = existsSync(join(partial, '.git', 'config'));
  let ours = onlyGitDir && !config;
  if (!ours && config) {
    const origin = runGit(['config', '--file', join(partial, '.git', 'config'), '--get', 'remote.origin.url'], { cwd: partial });
    ours = origin.ok && realpathOrNull(origin.value.stdout.trim()) === repoRoot;
  }
  if (!ours) return foreign;
  rmSync(partial, { recursive: true, force: true });
  return ok(undefined);
}

export class CloneStagingWorkspace extends GitStagingWorkspace {
  protected gitAccess(gitDir: string): { gitPaths: string[]; repoReadAllow: string[] } {
    return { gitPaths: [gitDir], repoReadAllow: [] };
  }

  prepare(input: PrepareInput): Result<StagingInfo> {
    const target = resolveStagingTarget(input);
    if (!target.ok) return target;
    const { onboardingDir, staging, branch } = target.value;
    const prepared = prepareClone(input.repoPath, { parentDir: onboardingDir, path: staging, branch, pin: input.pin });
    return prepared.ok ? ok({ path: staging, branch, strategy: 'clone' }) : prepared;
  }
}
