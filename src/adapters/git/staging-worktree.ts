// WorktreeStagingWorkspace (ONB-3, ONB-4): a detached `git worktree` of the user's repository at the pinned
// SHA, switched to `avarice/onboard-{onb}`, under the profile work root. The user's checkout is never
// written: its working tree, index and HEAD are untouched, but the worktree metadata and one branch ref live
// inside the user's `.git` (research, "Staging worktree mechanics"), so a contained run must be denied write
// access to that `.git` (spike S0-B). This is the alternative strategy; the owner chose the clone
// (staging-clone.ts, STAGING_STRATEGY) in plan 01-08.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { PrepareInput, StagingInfo } from '../../ports/staging-workspace.ts';
import { failure, GitStagingWorkspace, nulSplit, resolveStagingTarget, sortedUnique } from './staging-base.ts';
import { runGit } from './safe-git.ts';

const LOCK_REASON = 'avarice-onboarding';
const CHECKOUT_TIMEOUT_MS = 120_000;

export class WorktreeStagingWorkspace extends GitStagingWorkspace {
  protected gitAccess(gitDir: string, commonDir: string): { gitPaths: string[]; repoReadAllow: string[] } {
    return { gitPaths: sortedUnique([gitDir, commonDir]), repoReadAllow: [commonDir] };
  }

  prepare(input: PrepareInput): Result<StagingInfo> {
    const target = resolveStagingTarget(input);
    if (!target.ok) return target;
    const { onboardingDir, staging, branch } = target.value;

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

    mkdirSync(onboardingDir, { recursive: true, mode: 0o700 });
    const added = runGit(['worktree', 'add', '--detach', staging, input.pin], { cwd: repoRoot, neutralizeFilters: true, timeoutMs: CHECKOUT_TIMEOUT_MS });
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

}
