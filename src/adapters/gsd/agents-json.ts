// --agents JSON from GSD agent markdown (STUB: implemented in the GREEN step).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export function buildAgentsJson(_agentsDir: string, _names: readonly string[], _outFile: string): Result<{ file: string; agents: string[] }> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
