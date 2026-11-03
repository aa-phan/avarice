// Deterministic outcome classification for one contained host invocation (ONB-3, ONB-12; Pitfall 10).
// STUB for the RED commit of plan 01-15: every call answers `inconclusive`.
export type ClassifiedKind = 'progressed' | 'denied' | 'budget_exhausted' | 'failed' | 'no_progress' | 'inconclusive';

export interface OutcomeFacts {
  resultSeen: boolean;
  isError?: boolean;
  subtype?: string;
  terminalReason?: string;
  permissionDenials: number;
  hookDenies: number;
  hookBudgetDenies: number;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  headBefore: string;
  headAfter: string;
  expectedFilesPresent: boolean;
}

export function classifyOutcome(_facts: OutcomeFacts): { kind: ClassifiedKind; headMoved: boolean } {
  return { kind: 'inconclusive', headMoved: false };
}
