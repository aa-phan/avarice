// Fail-closed launch readiness check (STUB: implemented in the GREEN step).
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export const ADMITTED_CLAUDE_VERSIONS: readonly string[] = [];

export interface LaunchReadyInput {
  settingsFile: string;
  claudeBin: string;
  sandboxProbe?: readonly string[];
  timeoutMs?: number;
}

export function checkLaunchReady(_input: LaunchReadyInput): Result<{ claudeVersion: string }> {
  return ok({ claudeVersion: '' });
}
