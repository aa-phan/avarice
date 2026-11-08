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
//   5. a structural pause signal               -> paused (a clean, finished run that stopped to ask; it never
//                                                 passes a gate, it routes to a decision)
//   6. the expected files are there            -> progressed
//   7. any deny (host permission denial or hook deny) -> denied
//   8. otherwise                               -> no_progress
//
// `paused` is driven only by `pauseSignal`, a structural fact the caller derives with detectPause from a
// waiting-JSON file, a GSD VERIFICATION status of human_needed, a STATE that needs a human, or the numbered-choice
// shape of the final text (02-RESEARCH Pitfall 11). With pauseSignal absent every outcome is as in Phase 1.
export type ClassifiedKind = 'progressed' | 'denied' | 'budget_exhausted' | 'failed' | 'no_progress' | 'inconclusive' | 'paused';

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
  // A structural pause signal was found (see detectPause). Absent means no signal.
  pauseSignal?: boolean;
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
  if (facts.pauseSignal === true) return result('paused');
  if (facts.expectedFilesPresent) return result('progressed');
  if (facts.permissionDenials > 0 || facts.hookDenies > 0) return result('denied');
  return result('no_progress');
}

export type PauseSignal = 'waiting-json' | 'verification-human-needed' | 'state-needs-human' | 'numbered-choice';

export interface PauseInput {
  // A GSD waiting JSON file exists in the run's workspace.
  waitingJson?: boolean;
  // Status read from the unit's VERIFICATION file.
  verificationStatus?: string;
  // The unit's STATE says it needs a human.
  stateNeedsHuman?: boolean;
  // The end of the model's final text. Data, read only for the numbered-choice shape.
  finalTextTail?: string;
}

export interface PauseDetection {
  paused: boolean;
  signal: PauseSignal | null;
}

const TAIL_CAP = 2000;
const CHOICE_LINE = /^(\d+)\.\s+\S/;

// The final text ends in a question line followed by at least two `N. ` choice lines numbered 1, 2, ...
function endsInNumberedChoice(tail: string): boolean {
  const lines = tail.slice(-TAIL_CAP).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  let first = lines.length;
  while (first > 0 && CHOICE_LINE.test(lines[first - 1] as string)) first -= 1;
  const choices = lines.slice(first);
  if (choices.length < 2 || first === 0) return false;
  for (let i = 0; i < choices.length; i += 1) {
    if (Number((CHOICE_LINE.exec(choices[i] as string) as RegExpExecArray)[1]) !== i + 1) return false;
  }
  return (lines[first - 1] as string).endsWith('?');
}

// Pure over structural facts. The structural signals are checked first, in a fixed order; the text shape is the
// last resort. A pause only ever blocks (it routes to a decision), so a crafted text can cost a needless decision
// record at worst, never pass a gate (T-02-14).
export function detectPause(input: PauseInput): PauseDetection {
  if (input.waitingJson === true) return { paused: true, signal: 'waiting-json' };
  if (input.verificationStatus === 'human_needed') return { paused: true, signal: 'verification-human-needed' };
  if (input.stateNeedsHuman === true) return { paused: true, signal: 'state-needs-human' };
  if (input.finalTextTail !== undefined && endsInNumberedChoice(input.finalTextTail)) return { paused: true, signal: 'numbered-choice' };
  return { paused: false, signal: null };
}
