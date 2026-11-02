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
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

export class CloneStagingWorkspace extends GitStagingWorkspace {
  protected gitAccess(gitDir: string): { gitPaths: string[]; repoReadAllow: string[] } {
    return { gitPaths: [gitDir], repoReadAllow: [] };
  }

  prepare(input: PrepareInput): Result<StagingInfo> {
    const target = resolveStagingTarget(input);
    if (!target.ok) return target;
    const { onboardingDir, staging, branch } = target.value;

    const top = runGit(['rev-parse', '--show-toplevel'], { cwd: input.repoPath });
    if (!top.ok) return failure(top.error);
    const repoRoot = realpathSync(top.value.stdout.trim());
    const exists = runGit(['cat-file', '-e', `${input.pin}^{commit}`], { cwd: repoRoot });
    if (!exists.ok) return err({ kind: 'not_found', ref: input.pin });

    const info: StagingInfo = { path: staging, branch, strategy: 'clone' };
    if (existsSync(staging)) {
      const reusable = this.reusable(info, repoRoot, input.pin);
      return reusable.ok ? ok(info) : reusable;
    }

    mkdirSync(onboardingDir, { recursive: true, mode: 0o700 });
    const partial = join(onboardingDir, 'staging.partial');
    if (existsSync(partial)) {
      const cleared = this.clearOwnPartial(partial, repoRoot);
      if (!cleared.ok) return cleared;
    }

    const cloned = runGit(['clone', '--local', '--no-hardlinks', '--no-checkout', '--', repoRoot, partial], { cwd: onboardingDir, timeoutMs: CLONE_TIMEOUT_MS });
    if (!cloned.ok) return failure(cloned.error);
    // `pin` was validated as a full hex SHA, so git cannot read it as an option.
    const detached = runGit(['checkout', '--detach', input.pin], { cwd: partial, neutralizeFilters: true, timeoutMs: CLONE_TIMEOUT_MS });
    if (!detached.ok) return failure(detached.error);
    const switched = runGit(['switch', '-c', branch], { cwd: partial });
    if (!switched.ok) return failure(switched.error);
    renameSync(partial, staging);
    return ok(info);
  }

  // An existing staging directory is reused only when it is its own git repository, a clone of this
  // repository, on the staging branch, at the pin. Anything else is a conflict and is left untouched.
  private reusable(info: StagingInfo, repoRoot: string, pin: string): Result<void> {
    const stagingReal = realpathOrNull(info.path);
    const toplevel = runGit(['rev-parse', '--show-toplevel'], { cwd: info.path });
    if (stagingReal === null || !toplevel.ok || realpathOrNull(toplevel.value.stdout.trim()) !== stagingReal) {
      return err({ kind: 'conflict', expected: 'a git clone of the repository at the staging path', actual: 'an existing directory that is not a git repository of its own' });
    }
    const origin = runGit(['config', '--get', 'remote.origin.url'], { cwd: info.path });
    if (!origin.ok || realpathOrNull(origin.value.stdout.trim()) !== repoRoot) {
      return err({ kind: 'conflict', expected: `a clone of ${repoRoot}`, actual: 'a clone of another repository' });
    }
    const head = runGit(['rev-parse', 'HEAD'], { cwd: info.path });
    const current = runGit(['branch', '--show-current'], { cwd: info.path });
    if (!head.ok || !current.ok) return err({ kind: 'conflict', expected: `staging at pin ${pin}`, actual: 'a clone git cannot read' });
    if (head.value.stdout.trim() !== pin) {
      return err({ kind: 'conflict', expected: `staging at pin ${pin}`, actual: `staging at ${head.value.stdout.trim()}` });
    }
    if (current.value.stdout.trim() !== info.branch) {
      return err({ kind: 'conflict', expected: `branch ${info.branch}`, actual: `branch ${current.value.stdout.trim() || '(detached)'}` });
    }
    return ok(undefined);
  }

  // A crash during the clone leaves {onboarding}/staging.partial. It is this adapter's own leftover when it is
  // a real directory (not a symlink) that is either only an empty-ish `.git` or a clone whose origin is this
  // repository; then it is replaced. Otherwise it is somebody else's data: a conflict, not removed.
  private clearOwnPartial(partial: string, repoRoot: string): Result<void> {
    const stat = lstatSync(partial);
    const foreign = err({ kind: 'conflict', expected: 'no staging.partial, or one that is an interrupted clone of this repository', actual: `${partial} is something else` }) as Result<never>;
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
}
