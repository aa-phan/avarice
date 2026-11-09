// Which signal becomes a decision, and what the record holds (AUT-1, AUT-2; 03-RESEARCH Pattern 3).
//
// AUT-1: only structural signals are inputs. A pause is a fact AVARICE measured (a waiting file, a verification status, the
// numbered-choice shape of the final text); what the model wrote in that text is data. It can open a decision, never close
// one: model confidence, a model-written claim that a choice is routine, and the end of a stage are not inputs and have no
// field here, so no text can make a consequential choice proceed without a human.
//
// AUT-2: a record carries the issue, evidence references, the options, a recommendation, a consequence for each option, the
// affected items (the item and its transitive dependents) and the authorized default, only when the contract names one. The
// unit's recommendation is stored as data and is never a default.
//
// Pure: no I/O, no clock. Imports domain files only.
import type { PauseSignal } from './outcome.ts';
import { storedText } from './quick-record.ts';
import type { RunContract } from './run-contract.ts';

export interface DecisionOption {
  key: string;
  label: string;
  kind: 'choice' | 'text' | 'withdraw';
}

// The structural facts a caller measured. `pause` is the only kind the first tracer handles; the rest are added with their class.
export type DecisionSignal = { kind: 'pause'; pauseSignal?: PauseSignal; question?: string };

export type DecisionClassName = 'acceptance' | 'scope_expansion' | 'permission' | 'repeated_failure' | 'budget';
export type DecisionAuthority = 'human' | 'prohibited' | 'default' | 'delegated';

export interface DecisionClassification {
  // `assumption`: a routine, reversible or contract-authorized choice is logged and opens no decision row.
  record: 'decision' | 'assumption';
  class: DecisionClassName;
  authority: DecisionAuthority;
  urgency: 'blocking';
  options: DecisionOption[];
  // The key of the option the unit marked as recommended. Data for the owner to read; never applied.
  recommended?: string;
  authorizedDefault?: string;
}

export interface AmendConsequence {
  command: string;
  request: { addWrite?: string[]; budgets?: Record<string, number> };
}

export type DecisionConsequences = Record<string, string | AmendConsequence>;

export interface DecisionRecordDraft {
  class: DecisionClassName;
  authority: DecisionAuthority;
  issue: string;
  recommendation?: string;
  options: DecisionOption[];
  consequences: DecisionConsequences;
  evidenceRefs: string[];
  affectedItems: string[];
  authorizedDefault?: string;
  urgency: 'blocking';
}

export const ISSUE_MAX_CHARS = 1000;
export const OPTION_LABEL_MAX_CHARS = 200;
export const MAX_OPTIONS = 9;
const NO_REASON_ISSUE = 'the run stopped and gave no reason';

// The line shape of detectPause (src/domain/outcome.ts), reading the same last 2000 characters of the final text.
const TAIL_CAP = 2000;
const CHOICE_LINE = /^(\d+)\.\s+(\S.*)$/;
const RECOMMENDED_MARKER = /\s*\(\s*recommended\s*\)\s*$/i;
const LINE_MAX_CHARS = 10_000;

const TEXT_OPTION: DecisionOption = { key: 'text', label: 'free text', kind: 'text' };

// A final text that ends in a question line and at least two choice lines numbered 1, 2, ... gives the choices, in order, at
// most MAX_OPTIONS of them. A label is stored text: control characters stripped, cut to OPTION_LABEL_MAX_CHARS. A trailing
// `(Recommended)` marker is removed from its label and names `recommended`, only when exactly one choice carries it.
export function parseNumberedOptions(text: string): { choices: DecisionOption[]; recommended?: string } {
  const lines = text.slice(-TAIL_CAP).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  let first = lines.length;
  while (first > 0 && CHOICE_LINE.test(lines[first - 1] as string)) first -= 1;
  const raw = lines.slice(first);
  if (raw.length < 2 || first === 0) return { choices: [] };
  for (let i = 0; i < raw.length; i += 1) {
    if (Number((CHOICE_LINE.exec(raw[i] as string) as RegExpExecArray)[1]) !== i + 1) return { choices: [] };
  }
  if (!(lines[first - 1] as string).endsWith('?')) return { choices: [] };

  const choices: DecisionOption[] = [];
  const marked: string[] = [];
  for (const line of raw.slice(0, MAX_OPTIONS)) {
    const key = String(choices.length + 1);
    let label = storedText((CHOICE_LINE.exec(line) as RegExpExecArray)[2] as string, LINE_MAX_CHARS).trim();
    if (RECOMMENDED_MARKER.test(label)) {
      label = label.replace(RECOMMENDED_MARKER, '');
      marked.push(key);
    }
    label = storedText(label, OPTION_LABEL_MAX_CHARS).trim();
    choices.push({ key, label: label === '' ? `option ${key}` : label, kind: 'choice' });
  }
  return marked.length === 1 ? { choices, recommended: marked[0] as string } : { choices };
}

// One signal, one classification. `decisions` is the contract's own list: it is what makes a choice delegated or defaulted,
// never anything the model wrote.
export function classifyDecision(signal: DecisionSignal, _decisions: RunContract['decisions']): DecisionClassification {
  const parsed = signal.question === undefined ? { choices: [] as DecisionOption[] } : parseNumberedOptions(signal.question);
  const options = parsed.choices.length > 0 ? parsed.choices : [{ ...TEXT_OPTION }];
  return {
    record: 'decision',
    class: 'acceptance',
    authority: 'human',
    urgency: 'blocking',
    options,
    ...('recommended' in parsed && parsed.recommended !== undefined ? { recommended: parsed.recommended } : {}),
  };
}

export interface DecisionRecordInput {
  signal: DecisionSignal;
  classification: DecisionClassification;
  itemId: string;
  // The item's transitive dependents, computed by the caller (transitiveDependents in work-items.ts).
  dependents: readonly string[];
  runId: string;
  issue: string;
  evidenceRefs: readonly string[];
  decisions: RunContract['decisions'];
}

function consequenceFor(option: DecisionOption, itemId: string): string {
  return option.kind === 'text' ? `item ${itemId} resumes with your text answer` : `item ${itemId} resumes with this answer`;
}

export function buildDecisionRecord(input: DecisionRecordInput): DecisionRecordDraft {
  const { classification, itemId } = input;
  const issue = storedText(input.issue, ISSUE_MAX_CHARS);
  const options: DecisionOption[] = classification.options.slice(0, MAX_OPTIONS).map((option) => ({
    key: option.key,
    label: storedText(option.label, OPTION_LABEL_MAX_CHARS),
    kind: option.kind,
  }));
  const consequences: DecisionConsequences = {};
  for (const option of options) consequences[option.key] = consequenceFor(option, itemId);
  const affectedItems = [itemId, ...input.dependents.filter((id) => id !== itemId)].filter((id, i, all) => all.indexOf(id) === i);
  const recommended = classification.recommended !== undefined && options.some((o) => o.key === classification.recommended) ? classification.recommended : undefined;
  return {
    class: classification.class,
    authority: classification.authority,
    issue: issue === '' ? NO_REASON_ISSUE : issue,
    ...(recommended !== undefined ? { recommendation: `the unit recommended option ${recommended}` } : {}),
    options,
    consequences,
    evidenceRefs: [...input.evidenceRefs],
    affectedItems,
    urgency: 'blocking',
  };
}
