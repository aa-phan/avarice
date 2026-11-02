// Allowlisted invocation environment (STUB: implemented in the GREEN step).
export interface InvocationEnvOptions {
  gsdCoreBin: string;
  onboardingId: string;
  extraPath?: readonly string[];
}

export function buildInvocationEnv(_parent: NodeJS.ProcessEnv, _options: InvocationEnvOptions): Record<string, string> {
  return {};
}
