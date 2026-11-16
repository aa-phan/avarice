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
import { normalizeChoice } from './item-scope.ts';

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
function trailingChoices(tail: string): string[] {
  const lines = tail.slice(-TAIL_CAP).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  let first = lines.length;
  while (first > 0 && CHOICE_LINE.test(lines[first - 1] as string)) first -= 1;
  const choices = lines.slice(first);
  if (choices.length < 2 || first === 0) return [];
  for (let i = 0; i < choices.length; i += 1) {
    if (Number((CHOICE_LINE.exec(choices[i] as string) as RegExpExecArray)[1]) !== i + 1) return [];
  }
  return (lines[first - 1] as string).endsWith('?') ? choices : [];
}

const endsInNumberedChoice = (tail: string): boolean => trailingChoices(tail).length > 0;

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

// The trailing choice lines of a final text that ends in a numbered choice (the shape detectPause reads), as the trimmed lines; empty when the text does not end in one.
export function choiceLines(tail: string): string[] {
  return trailingChoices(tail);
}

// Plan 03-40 (AUT-3; exit run 1). A unit of item A that finished its own verified work and then printed the numbered choice that belongs to item B
// (it had read B's paragraph of the brief) was parked on it as its own pause, and A's work was never committed. The rule below says when a numbered
// choice is another item's. It fails closed: anything it cannot establish means "not attributed", and the unit pauses as before.
//
// The caller passes the options as normalized by src/domain/item-scope.ts:
//   ownOptions        the options of the unit's own item, including those of its own decisions
//   sharedOptions     the numbered lines of the Behavior paragraphs no item is labelled for
//   optionsByItem     the options each item owns (its labelled paragraphs, its `decision:` criteria, its open decisions)
//   ownerChoiceItems  the items with a `decision:` criterion or an open decision
//   verified          the unit's VERIFICATION passed, a SUMMARY is present, it changed something in scope, and it classifies progressed without the pause
export interface AttributionInput {
  signal: PauseSignal | null;
  choiceLines: readonly string[];
  ownItemId: string;
  itemIds: readonly string[];
  ownOptions: readonly string[];
  sharedOptions: readonly string[];
  optionsByItem: Readonly<Record<string, readonly string[]>>;
  ownerChoiceItems: readonly string[];
  verified: boolean;
}

export type Attribution = { attributedTo: string } | { attributedTo: null; reason: string };

export function attributeNumberedChoice(input: AttributionInput): Attribution {
  const no = (reason: string): Attribution => ({ attributedTo: null, reason });
  // A structural pause signal is the unit's own, and only the text shape is ever attributed.
  if (input.signal !== 'numbered-choice') return no('the signal is not a numbered choice');
  if (!input.verified) return no('the unit is not verified');
  if (input.itemIds.length < 2 || !input.itemIds.includes(input.ownItemId)) return no('the run does not have this item among several');
  const lines = input.choiceLines.map(normalizeChoice);
  if (lines.length === 0 || lines.some((line) => line === '')) return no('a choice line is empty');

  const optionsOf = (id: string): ReadonlySet<string> => new Set(input.optionsByItem[id] ?? []);
  const ownSide = new Set([...input.ownOptions, ...optionsOf(input.ownItemId), ...input.sharedOptions]);
  if (lines.some((line) => ownSide.has(line))) return no("a choice line is the unit's own or shared");

  const others = input.itemIds.filter((id) => id !== input.ownItemId);
  const owners = others.filter((id) => lines.every((line) => optionsOf(id).has(line)));
  if (owners.length === 0) return no('no other item owns every choice line');
  if (owners.length > 1) return no('more than one other item owns the choice lines');
  const owner = owners[0] as string;
  if (others.some((id) => id !== owner && lines.some((line) => optionsOf(id).has(line)))) return no("a choice line is also another item's option");
  if (!input.ownerChoiceItems.includes(owner)) return no('the item has no owner choice or open decision');
  return { attributedTo: owner };
}
