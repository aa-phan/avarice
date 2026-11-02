// CloneStagingWorkspace (RED stub): replaced by the implementation in the next commit.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type {
  PrepareInput,
  RepoFacts,
  StagingChanges,
  StagingInfo,
  StagingWorkspace,
  WorkspaceDescription,
} from '../../ports/staging-workspace.ts';

const notYet = (): Result<never> => err({ kind: 'internal', cause: 'CloneStagingWorkspace is not implemented yet' });

export class CloneStagingWorkspace implements StagingWorkspace {
  prepare(_input: PrepareInput): Result<StagingInfo> {
    return notYet();
  }
  head(_path: string): Result<string> {
    return notYet();
  }
  changes(_path: string, _pin: string): Result<StagingChanges> {
    return notYet();
  }
  describe(_path: string, _pin: string): Result<WorkspaceDescription> {
    return notYet();
  }
  listTracked(_path: string, _pin: string): Result<string[]> {
    return notYet();
  }
  read(_path: string, _relPath: string, _maxBytes: number): Result<string | null> {
    return notYet();
  }
  ensureDir(_path: string, _relPath: string): Result<void> {
    return notYet();
  }
  inspectRepo(_repoPath: string): Result<RepoFacts> {
    return notYet();
  }
}
