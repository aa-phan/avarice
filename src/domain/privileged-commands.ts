// Privileged shell forms (plan 04-19; FR-12, FR-14, ADR-005). Pure. Skeleton: no behavior yet.
export interface PrivilegedCommand {
  action: string;
  params: Record<string, string>;
}

export const PRIVILEGED_COMMAND_FORMS: readonly string[] = [];

export function classifyShellCommand(_words: readonly string[]): PrivilegedCommand | null {
  return null;
}

export function classifyCommandLine(_command: string): PrivilegedCommand | null {
  return null;
}
