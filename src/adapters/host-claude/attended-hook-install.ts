// The attended PreToolUse hook entry in a Claude settings.json (plan 04-19; FR-12, T-04-52). Skeleton: no behavior yet.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

// The argument that marks the entry as AVARICE's: settings JSON has no comment field, so the marker is part of the command string.
export const ATTENDED_HOOK_MARKER = '--avarice-attended-hook';

export type AttendedHookStatus = 'installed' | 'unchanged' | 'updated';

export interface AttendedHookInstall {
  status: AttendedHookStatus;
  path: string;
  digest: string;
}

export function installAttendedHook(_configDir: string, _options: { hookEntry: string; dataRoot: string }): Result<AttendedHookInstall> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
