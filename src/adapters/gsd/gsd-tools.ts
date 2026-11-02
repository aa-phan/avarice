// gsd-tools runner (stub until the GREEN commit of plan 01-09 Task 1).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface RunGsdOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export function runGsd(_gsdCoreDir: string, _args: readonly string[], _options: RunGsdOptions): Promise<Result<unknown>> {
  return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
}
