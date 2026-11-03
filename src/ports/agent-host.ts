// AgentHost port (docs/contracts-and-state.md "AgentHost"; SKELETON.md "Ports"). The host runs one
// contained agent invocation. The request carries the vendor-neutral InvocationScope; the adapter turns it into
// its own settings (plan 01-15).
import type { InvocationScope } from '../domain/invocation-scope.ts';
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
  // What the invocation may write, read and run (ONB-3, ONB-4, CON-2); `scope.cwd` equals `cwd`.
  scope: InvocationScope;
  // The skills and agents this invocation may load, by name; the adapter builds its plugin directory and agents
  // file from exactly these.
  extensions: { skills: string[]; agents: string[] };
  // Named agent for the session (the intel seam).
  agentName?: string;
  // Staging-relative files the invocation is expected to leave; an outcome is `progressed` only when all exist.
  expectedFiles: string[];
  // The session the host runs under, chosen by the caller so it can be recorded before launch (a resume can then
  // find a process that outlived its supervisor). The adapter generates one when absent.
  sessionId?: string;
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
  // Counts and codes only (no text): what an `invocation.finished` event may carry.
  details?: InvocationDetails;
}

export interface InvocationDetails {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  headMoved: boolean;
  // Size of the stored (redacted) transcript, in bytes.
  transcriptBytes: number;
  // Hook deny events recorded for the invocation, and how many were budget_exhausted.
  hookDenies: number;
  hookBudgetDenies: number;
  numTurns: number;
  // The host's own result fields, when it printed one.
  subtype?: string;
  terminalReason?: string;
  subagentsSpawned?: number;
}

// A process that carries an invocation's session ID.
export interface ReapRequest {
  sessionId: string;
}

export interface AgentHost {
  readonly descriptor: CapabilityDescriptor;
  invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>>;
  // Terminates any process still carrying the invocation's session ID: a supervisor killed mid-invocation leaves its
  // host running, and a resume must end it before it reconciles. `terminated` counts the processes ended.
  reap?(request: ReapRequest): Promise<Result<{ terminated: number }>>;
}
