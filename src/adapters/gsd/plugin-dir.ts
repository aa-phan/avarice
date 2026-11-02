// Generated plugin with symlinked skills (STUB: implemented in the GREEN step).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { InvocationPurpose } from '../../domain/invocation-scope.ts';

export const PURPOSE_EXTENSIONS: Readonly<Record<InvocationPurpose, { skills: readonly string[]; agents: readonly string[] }>> = {
  map: { skills: [], agents: [] },
  intel: { skills: [], agents: [] },
  knowledge: { skills: [], agents: [] },
};

export function buildPluginDir(_outDir: string, _skillsRoot: string, _names: readonly string[]): Result<{ dir: string; skills: string[] }> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
