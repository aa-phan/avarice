// Launch argv builder and refusal (STUB: implemented in the GREEN step).
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface LaunchArgsInput {
  prompt: string;
  settingsFile: string;
  pluginDir: string;
  agentsFile: string;
  mcpFile: string;
  model: string;
  costCapUsd: number;
  sessionId: string;
  agent?: string;
}

export function buildLaunchArgs(_input: LaunchArgsInput): string[] {
  return [];
}

export function assertLaunchArgsSafe(_argv: readonly string[]): Result<void> {
  return ok(undefined);
}
