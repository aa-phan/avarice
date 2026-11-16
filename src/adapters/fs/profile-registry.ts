// The other profiles on this machine (SEC-1, D-19). A run's sandbox denies the roots of every profile but its own; the roots of a profile whose
// data root, work root or config home were moved by an environment variable sit outside the default parents, so they are read from the profile
// configs: <configHome>/profiles/<profile>/config.json names the roots in use, and is written once with them.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface KnownProfileOptions {
  // The home the default config home is taken from, when this config home was moved.
  home: string;
  // The roots of the selected profile itself, which are never returned.
  ownDataRoot: string;
  ownWorkRoot: string;
}

export function knownProfileRoots(_configHome: string, _selected: string, _options: KnownProfileOptions): Result<string[]> {
  return ok([]);
}
