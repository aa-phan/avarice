// gsd-core discovery (stub until the GREEN commit of plan 01-09 Task 1).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface LocatedGsd {
  gsdCoreDir: string;
  version: string;
  packageName: string;
}

export function locateGsdCore(_env: NodeJS.ProcessEnv): Result<LocatedGsd> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
