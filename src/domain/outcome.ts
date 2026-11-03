// Deterministic outcome classification for one contained host invocation (ONB-3, ONB-12; 01-RESEARCH Pitfall 10).
// Pure: the kind comes from facts the host and AVARICE measured (the final result event, the process exit, the
// staging HEAD, AVARICE's own hook events), never from what the model wrote. A fact that says nothing about the
// work (a result with no is_error, a subtype that reads "success") is never taken for a success.
//
// Order of the rules (the first that applies decides):
//   1. staging HEAD moved                      -> failed, headMoved (a containment finding; the invocation may
//                                                 not move the branch, whatever else happened)
//   2. no result event, or the wall clock hit  -> inconclusive
//   3. budget: error_max_budget_usd, terminal reason budget_exhausted, or a hook budget_exhausted deny
//                                              -> budget_exhausted
//   4. is_error is not false, a non-zero exit or a signal -> failed
//   5. the expected files are there            -> progressed
//   6. any deny (host permission denial or hook deny) -> denied
//   7. otherwise                               -> no_progress
//
// `paused` is not derived here: Phase 1 does no heuristic question detection (01-RESEARCH).
export type ClassifiedKind = 'progressed' | 'denied' | 'budget_exhausted' | 'failed' | 'no_progress' | 'inconclusive';

export interface OutcomeFacts {
  // A `result` event was printed.
  resultSeen: boolean;
  // `is_error` of the result; absent when the result had no boolean field.
  isError?: boolean;
  subtype?: string;
  terminalReason?: string;
  // Entries in the result's permission_denials plus system/permission_denied events.
  permissionDenials: number;
  // AVARICE hook deny events recorded for this invocation, and how many of them were budget_exhausted.
  hookDenies: number;
  hookBudgetDenies: number;
  // AVARICE hit the wall clock and terminated the process group.
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  headBefore: string;
  headAfter: string;
  // Every file the invocation was expected to leave is present in staging.
  expectedFilesPresent: boolean;
}

export interface OutcomeClassification {
  kind: ClassifiedKind;
  headMoved: boolean;
}

const BUDGET_SUBTYPE = 'error_max_budget_usd';
const BUDGET_TERMINAL_REASON = 'budget_exhausted';

export function classifyOutcome(facts: OutcomeFacts): OutcomeClassification {
  // An unknown HEAD (empty) is not a moved HEAD.
  const headMoved = facts.headBefore !== '' && facts.headAfter !== '' && facts.headBefore !== facts.headAfter;
  const result = (kind: ClassifiedKind): OutcomeClassification => ({ kind, headMoved });

  if (headMoved) return result('failed');
  if (!facts.resultSeen || facts.timedOut) return result('inconclusive');
  if (facts.subtype === BUDGET_SUBTYPE || facts.terminalReason === BUDGET_TERMINAL_REASON || facts.hookBudgetDenies > 0) {
    return result('budget_exhausted');
  }
  if (facts.isError !== false || facts.signal !== null || facts.exitCode !== 0) return result('failed');
  if (facts.expectedFilesPresent) return result('progressed');
  if (facts.permissionDenials > 0 || facts.hookDenies > 0) return result('denied');
  return result('no_progress');
}
