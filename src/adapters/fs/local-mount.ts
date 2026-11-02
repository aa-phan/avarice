// Local-mount check for the data root (ADR-003). Stub: the parser arrives with the GREEN commit.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface MountEntry {
  device: string;
  mountPoint: string;
  fstype: string;
  flags: string[];
  local: boolean;
}

export function parseMountOutput(_text: string): MountEntry[] {
  return [];
}

export function mountFor(_entries: readonly MountEntry[], _path: string): MountEntry | undefined {
  return undefined;
}

export function isLocalMount(_path: string): Result<boolean> {
  return ok(true);
}
