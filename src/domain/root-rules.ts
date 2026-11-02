// Root placement rules (SKELETON.md "Roots"). Stub: the rules arrive with the GREEN commit.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export interface RootInputs {
  home: string;
  claudeConfigDirReal: string;
  dataRoot: string;
  workRoot: string;
}

export function checkRoots(_inputs: RootInputs): Result<void> {
  return ok(undefined);
}
