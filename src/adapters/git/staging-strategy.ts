// The staging strategy is one constant (SKELETON.md "Staging"). Plan 01-08 confirms or switches it after
// spike S0-B and the owner's decision; only the adapter behind it changes.
import type { StagingWorkspace } from '../../ports/staging-workspace.ts';
import { CloneStagingWorkspace } from './staging-clone.ts';
import { WorktreeStagingWorkspace } from './staging-worktree.ts';

export type StagingStrategy = 'worktree' | 'clone';

export const STAGING_STRATEGY = 'worktree' satisfies StagingStrategy;

export function createStagingWorkspace(strategy: StagingStrategy): StagingWorkspace {
  switch (strategy) {
    case 'worktree':
      return new WorktreeStagingWorkspace();
    case 'clone':
      return new CloneStagingWorkspace();
  }
}
