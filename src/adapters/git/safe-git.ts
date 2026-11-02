// Safe git (ONB-4): placeholder until the implementation commit.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
}

export function runGit(_args: readonly string[], _options: RunGitOptions): Result<{ stdout: string; stderr: string }> {
  return err({ kind: 'internal', cause: 'runGit is not implemented yet' });
}
