// WorktreeStagingWorkspace: placeholder until the implementation commit.
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

const NOT_YET = { kind: 'internal', cause: 'WorktreeStagingWorkspace is not implemented yet' } as const;

export class WorktreeStagingWorkspace implements StagingWorkspace {
  prepare(_input: PrepareInput): Result<StagingInfo> { return err(NOT_YET); }
  head(_path: string): Result<string> { return err(NOT_YET); }
  changes(_path: string, _pin: string): Result<StagingChanges> { return err(NOT_YET); }
  describe(_path: string, _pin: string): Result<WorkspaceDescription> { return err(NOT_YET); }
  listTracked(_path: string, _pin: string): Result<string[]> { return err(NOT_YET); }
  read(_path: string, _relPath: string, _maxBytes: number): Result<string | null> { return err(NOT_YET); }
  ensureDir(_path: string, _relPath: string): Result<void> { return err(NOT_YET); }
  inspectRepo(_repoPath: string): Result<RepoFacts> { return err(NOT_YET); }
}
