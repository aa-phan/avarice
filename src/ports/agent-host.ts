// AgentHost port (docs/contracts-and-state.md "AgentHost"; SKELETON.md "Ports"). The host runs one
// contained agent invocation. Plan 01-15 extends InvocationRequest with `scope` and `extensions`.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

export type InvocationPurpose = 'map' | 'intel' | 'knowledge';

export interface InvocationRequest {
  onboardingId: string;
  runId: string;
  invocationId: string;
  purpose: InvocationPurpose;
  contractVersion: number;
  contractDigest: string;
  prompt: string;
  // Working directory of the invocation: the staging copy, never the user's checkout.
  cwd: string;
  model: string;
  costCapUsd: number;
  wallClockMs: number;
}

export type InvocationOutcomeKind =
  | 'progressed'
  | 'paused'
  | 'denied'
  | 'budget_exhausted'
  | 'failed'
  | 'no_progress'
  | 'inconclusive';

export interface PermissionDenial {
  tool: string;
  reason: string;
}

export interface InvocationOutcome {
  sessionId: string;
  kind: InvocationOutcomeKind;
  permissionDenials: PermissionDenial[];
  costUsd: number;
  durationMs: number;
  headBefore: string;
  headAfter: string;
  // Digest of the stored transcript artifact.
  transcriptArtifact?: string;
  // Captured GSD pause text, to be treated as data.
  question?: string;
}

export interface AgentHost {
  readonly descriptor: CapabilityDescriptor;
  invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>>;
}
