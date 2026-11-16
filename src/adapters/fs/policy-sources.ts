// Skeleton: the readers arrive with the implementation.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { PolicyFile } from '../../domain/policy.ts';

export function readOrganizationPolicy(_path: string): Result<PolicyFile> {
  return err({ kind: 'unavailable', cause: 'skeleton' });
}

export function readRepositoryPolicy(_repoPath: string, _pin: string): Result<PolicyFile | null> {
  return err({ kind: 'unavailable', cause: 'skeleton' });
}
