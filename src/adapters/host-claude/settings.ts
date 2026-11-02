// Claude Code settings renderer (STUB: implemented in the GREEN step).
import type { InvocationScope } from '../../domain/invocation-scope.ts';

export interface HookCommand {
  command: string;
  args: string[];
}

export interface RenderOptions {
  hook: HookCommand;
  policyFile: string;
  gsdHooks?: ReadonlyArray<HookCommand & { matcher?: string }>;
  skillsAllowed?: readonly string[];
}

export function renderClaudeSettings(_scope: InvocationScope, _options: RenderOptions): Record<string, unknown> {
  return {};
}

export function avariceHookCommand(_entry: string): HookCommand {
  return { command: '', args: [] };
}

export function gsdSecretReadGuardHook(_configDir: string): (HookCommand & { matcher: string }) | null {
  return null;
}
