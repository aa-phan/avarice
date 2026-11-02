// Pure decision over normalized tool calls for AVARICE's PreToolUse hook (CON-2, CON-3, ONB-3, ONB-4).
// STUB (RED): every call is refused until the decision is implemented.
import type { BashStrategy, InvocationPurpose } from './invocation-scope.ts';

export type NormalizedToolCall =
  | { kind: 'file-write'; tool: string; paths: string[] }
  | { kind: 'file-read'; tool: string; paths: string[] }
  | { kind: 'search'; tool: string; path: string }
  | { kind: 'shell'; command: string; background: boolean; cwd: string }
  | { kind: 'subagent'; subagentType: string | null }
  | { kind: 'web'; tool: string }
  | { kind: 'meta'; tool: string }
  | { kind: 'other'; tool: string };

export interface HookPolicy {
  schema: 1;
  onboardingId: string;
  runId: string;
  invocationId: string;
  purpose: InvocationPurpose;
  ledgerPath: string;
  stagingPath: string;
  writeRoots: string[];
  denyRead: string[];
  allowRead: string[];
  denyReadGlobs: string[];
  commands: {
    strategy: BashStrategy;
    readOnly: string[];
    gsdReadVerbs: string[];
    deniedPrefixes: string[];
    preambleSha256?: string;
    preambleLength?: number;
  };
  subagentTypes: string[];
}

export interface HookDecision {
  decision: 'allow' | 'deny';
  rule: string;
  budget?: 'toolCalls' | 'subagentsTotal';
  explicit?: boolean;
}

export type NormalizeResult = { ok: true; call: NormalizedToolCall } | { ok: false; reason: string };
export type PolicyResult = { ok: true; policy: HookPolicy } | { ok: false; reason: string };

export function decideToolCall(_call: NormalizedToolCall, _policy: HookPolicy, _canon: (path: string) => string | null): HookDecision {
  return { decision: 'deny', rule: 'stub' };
}

export function normalizeToolCall(_tool: string, _input: Record<string, unknown>, _cwd: string): NormalizeResult {
  return { ok: false, reason: 'stub' };
}

export function parseHookPolicy(_raw: unknown): PolicyResult {
  return { ok: false, reason: 'stub' };
}
