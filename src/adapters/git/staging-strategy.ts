// The staging strategy is one constant (SKELETON.md "Staging"). Plan 01-08 Task 1: the owner chose `clone`
// after spike S0-B (a plain linked worktree let a contained mapper move the user's branch ref; a clone with
// its own `.git` under the work root left the user's repository byte-identical). The worktree adapter stays
// behind the same port and runs the same contract tests; only the adapter behind this constant changes.
import type { StagingWorkspace } from '../../ports/staging-workspace.ts';
import { CloneStagingWorkspace } from './staging-clone.ts';
import { WorktreeStagingWorkspace } from './staging-worktree.ts';

export type StagingStrategy = 'worktree' | 'clone';

export const STAGING_STRATEGY = 'clone' satisfies StagingStrategy;

export function createStagingWorkspace(strategy: StagingStrategy): StagingWorkspace {
  switch (strategy) {
    case 'worktree':
      return new WorktreeStagingWorkspace();
    case 'clone':
      return new CloneStagingWorkspace();
  }
}
