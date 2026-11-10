// The host configuration directory of a run (plan 03-43). RED stub: the behaviour is written in the next commit.
import type { AppDeps } from '../app/deps.ts';
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';

export function effectiveHostConfigDir(_env: NodeJS.ProcessEnv, _home: string): string {
  return '';
}

export function recordRunHostConfigDir(_deps: AppDeps, _runId: string, _env?: NodeJS.ProcessEnv): Result<void> {
  return ok(undefined);
}

export function recordedHostConfigDir(_deps: AppDeps, _runId: string): string | undefined {
  return undefined;
}

export function hostConfigDirProblem(_dir: string): string | undefined {
  return undefined;
}
