// Which signal becomes a decision, and what the record holds (AUT-1, AUT-2; 03-RESEARCH Pattern 3).
//
// AUT-1: only structural signals are inputs. A pause is a fact AVARICE measured (a waiting file, a verification status, the
// numbered-choice shape of the final text); what the model wrote in that text is data. It can open a decision, never close
// one: model confidence, a model-written claim that a choice is routine, and the end of a stage are not inputs and have no
// field here, so no text can make a consequential choice proceed without a human. A choice is routine only when the contract
// lists it as delegated, or the plan declared an auto_select for it.
//
// AUT-2: a record carries the issue, evidence references, the options, a recommendation, a consequence for each option, the
// affected items (the item and its transitive dependents) and the authorized default, only when the contract names one. The
// unit's recommendation is stored as data and is never a default.
//
// Owner decision 2: a decision that is not a pause (repeated_failure, permission, budget, scope_expansion) offers only
// `withdraw`. `decide` never widens anything (D-17), so the record prints the `avarice contract amend` command that would, as one
// value shared with the terminal chain that pre-fills the amendment.
//
// Pure: no I/O, no clock. Imports domain files only.
import type { PauseSignal } from './outcome.ts';
import { storedText } from './quick-record.ts';
import type { RunContract } from './run-contract.ts';
import type { RunBlockedReason } from './run-lifecycle.ts';

export interface DecisionOption {
  key: string;
  label: string;
  kind: 'choice' | 'text' | 'withdraw';
}

// The structural facts a caller measured, one kind per row of the classifier table.
export type DecisionSignal =
  // A clean, finished run that stopped to ask. `question` is the end of the final text, read only as data.
  | { kind: 'pause'; pauseSignal?: PauseSignal; question?: string }
  // G1: the plan has a checkpoint:decision with no auto_select that the unit then resolved. `options` are the plan's option ids.
  | { kind: 'g1-checkpoint'; question?: string; options: ReadonlyArray<{ id: string; label?: string }> }
  // A plan checkpoint with a declared auto_select: the unit proceeds on it and the choice is logged.
  | { kind: 'auto-select'; autoSelect: string }
  // A choice the caller names by category; delegated only when the contract lists that category.
  | { kind: 'delegated'; choice: string }
  // G1: a plan path outside the item spec or write scope.
  | { kind: 'g1-scope'; paths: readonly string[] }
  // G1: an acceptance criterion that leaves a user-visible choice to the owner.
  | { kind: 'g1-owner-choice'; acceptanceId: string; key?: string }
  | { kind: 'permission'; check?: string }
  // `values` holds what the run measured for a name it spent (a budget name from the contract, such as costUsd).
  | { kind: 'budget'; names: readonly string[]; values?: Readonly<Record<string, number>> }
  // Repair exhausted: `limit` is the invocation budget the run reached.
  | { kind: 'repeated-failure'; limit: number }
  | { kind: 'enforcement'; check?: string };

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
  // The contract's own default for this class. Present only with authority `default`.
  authorizedDefault?: string;
  // What an assumption took (the plan's auto_select, the delegated category), for the run's assumption log.
  assumed?: string;
}

export interface AmendConsequence {
  command: string;
  request: { addWrite?: string[]; budgets?: Record<string, number> };
}

export type DecisionConsequences = Record<string, string | AmendConsequence>;

export interface DecisionRecordDraft {
  class: DecisionClassName;
  // Not a ledger column: the caller keeps it for the assumption log and the notification text.
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
export const DECISION_ID_PLACEHOLDER = '<decision-id>';
const NO_REASON_ISSUE = 'the run stopped and gave no reason';
const OPTION_KEY_MAX_CHARS = 50;
const MAX_AMEND_PATHS = 10;
const AMEND_PATH_MAX_CHARS = 200;

// The line shape of detectPause (src/domain/outcome.ts), reading the same last 2000 characters of the final text.
const TAIL_CAP = 2000;
const CHOICE_LINE = /^(\d+)\.\s+(\S.*)$/;
const RECOMMENDED_MARKER = /\s*\(\s*recommended\s*\)\s*$/i;
const LINE_MAX_CHARS = 10_000;

const TEXT_OPTION: DecisionOption = { key: 'text', label: 'free text', kind: 'text' };
const WITHDRAW_OPTION: DecisionOption = { key: 'withdraw', label: 'withdraw', kind: 'withdraw' };
const OPTION_KINDS: readonly string[] = ['choice', 'text', 'withdraw'];

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

function textOptions(): DecisionOption[] {
  return [{ ...TEXT_OPTION }];
}

function withdrawOptions(): DecisionOption[] {
  return [{ ...WITHDRAW_OPTION }];
}

function normalized(text: string): string {
  return storedText(text, OPTION_LABEL_MAX_CHARS).trim().toLowerCase();
}

// A decision a human answers, with the options as given or free text when none. A class the contract lists in `defaults` gets
// authority `default` and that default, but only while the decision offers a real answer: a withdraw-only decision and a
// prohibited class are never lifted by a default.
function humanDecision(options: DecisionOption[], decisions: RunContract['decisions'], recommended?: string): DecisionClassification {
  const base: DecisionClassification = {
    record: 'decision',
    class: 'acceptance',
    authority: 'human',
    urgency: 'blocking',
    options: options.length > 0 ? options : textOptions(),
    ...(recommended !== undefined ? { recommended } : {}),
  };
  const named = decisions.defaults.find((d) => d.class === base.class && d.default !== '');
  return named === undefined ? base : { ...base, authority: 'default', authorizedDefault: named.default };
}

function assumption(authority: 'default' | 'delegated', assumed: string): DecisionClassification {
  return { record: 'assumption', class: 'acceptance', authority, urgency: 'blocking', options: [], assumed };
}

function withdrawOnly(cls: DecisionClassName, authority: 'human' | 'prohibited'): DecisionClassification {
  return { record: 'decision', class: cls, authority, urgency: 'blocking', options: withdrawOptions() };
}

function planOptions(options: ReadonlyArray<{ id: string; label?: string }>): DecisionOption[] {
  const out: DecisionOption[] = [];
  for (const option of options) {
    const key = storedText(option.id, OPTION_KEY_MAX_CHARS).trim();
    if (key === '' || out.some((o) => o.key === key) || key === TEXT_OPTION.key || key === WITHDRAW_OPTION.key) continue;
    const label = storedText(option.label ?? key, OPTION_LABEL_MAX_CHARS).trim();
    out.push({ key, label: label === '' ? key : label, kind: 'choice' });
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

// One signal, one classification. `decisions` is the contract's own list: it is what makes a choice delegated or defaulted,
// never anything the model wrote.
export function classifyDecision(signal: DecisionSignal, decisions: RunContract['decisions']): DecisionClassification {
  switch (signal.kind) {
    case 'pause': {
      // An unclassifiable pause is consequential (docs/autonomy-and-decisions.md): no question text still opens a decision.
      const parsed = signal.question === undefined ? { choices: [] as DecisionOption[] } : parseNumberedOptions(signal.question);
      return humanDecision(parsed.choices, decisions, 'recommended' in parsed ? parsed.recommended : undefined);
    }
    case 'g1-checkpoint':
      return humanDecision(planOptions(signal.options), decisions);
    case 'g1-owner-choice':
      return humanDecision(textOptions(), decisions);
    case 'auto-select': {
      const chosen = storedText(signal.autoSelect, OPTION_LABEL_MAX_CHARS).trim();
      // An auto_select that names nothing is not declared.
      return chosen === '' ? humanDecision(textOptions(), decisions) : assumption('default', chosen);
    }
    case 'delegated': {
      const choice = normalized(signal.choice);
      const human = decisions.human.some((entry) => normalized(entry) === choice);
      const delegated = decisions.delegated.some((entry) => normalized(entry) === choice);
      // A category the contract lists for a human is never delegated, even when it is also listed as delegated.
      if (choice !== '' && delegated && !human) return assumption('delegated', storedText(signal.choice, OPTION_LABEL_MAX_CHARS).trim());
      return humanDecision(textOptions(), decisions);
    }
    case 'g1-scope':
      return withdrawOnly('scope_expansion', 'human');
    case 'repeated-failure':
      return withdrawOnly('repeated_failure', 'human');
    case 'budget':
      return withdrawOnly('budget', 'prohibited');
    case 'permission':
    case 'enforcement':
      return withdrawOnly('permission', 'prohibited');
  }
}

// The contract's budget names to the flag `contract amend --budget` takes.
const BUDGET_FLAG: Readonly<Record<string, string>> = { costUsd: 'costUsdPerRun' };
const BUDGET_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function amendPaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const path = storedText(raw.replace(/[\r\n]/g, ''), AMEND_PATH_MAX_CHARS).trim();
    if (path !== '' && !out.includes(path)) out.push(path);
    if (out.length === MAX_AMEND_PATHS) break;
  }
  return out;
}

// The one value behind both the command a record prints and the request a terminal chain pre-fills (D-17, D-18). The flags never
// go past what the signal measured: the paths it named, the value it spent, the limit it reached. A value the signal did not
// measure prints as `<value>` and is left out of the request. Null when there is nothing to amend (a permission refusal is not
// answered by widening).
export function amendCommandFor(signal: DecisionSignal, runId: string, decisionId: string): AmendConsequence | null {
  const id = SAFE_ID.test(decisionId) ? decisionId : DECISION_ID_PLACEHOLDER;
  const head = `avarice contract amend ${runId} --decision ${id} --reason "<why>"`;
  switch (signal.kind) {
    case 'g1-scope': {
      const paths = amendPaths(signal.paths);
      if (paths.length === 0) return null;
      return { command: head + paths.map((p) => ` --add-write ${shellQuote(p)}`).join(''), request: { addWrite: paths } };
    }
    case 'budget': {
      const flags: string[] = [];
      const budgets: Record<string, number> = {};
      let command = head;
      for (const name of signal.names) {
        const flag = Object.hasOwn(BUDGET_FLAG, name) ? (BUDGET_FLAG[name] as string) : name;
        if (!BUDGET_NAME.test(name) || flags.includes(flag)) continue;
        flags.push(flag);
        const measured = signal.values?.[name];
        if (typeof measured === 'number' && Number.isFinite(measured) && measured >= 0) {
          budgets[flag] = measured;
          command += ` --budget ${flag}=${measured}`;
        } else {
          command += ` --budget ${flag}=<value>`;
        }
      }
      if (flags.length === 0) return null;
      return { command, request: Object.keys(budgets).length > 0 ? { budgets } : {} };
    }
    case 'repeated-failure': {
      if (!Number.isInteger(signal.limit) || signal.limit < 0) return null;
      const raised = signal.limit + 1;
      return { command: `${head} --budget invocations=${raised}`, request: { budgets: { invocations: raised } } };
    }
    default:
      return null;
  }
}

// An item blocks on a decision; every other blocked reason is a state of the whole run (containment, budget, credentials, the
// source ref), so the run stops with it.
export function blockScope(reason: RunBlockedReason): 'item' | 'run' {
  return reason === 'decision' ? 'item' : 'run';
}

// The options of a stored decision. A Phase 2 decision stored `[]`, and a value that is not a list is not options: both offer
// withdraw only, so the owner is never left with a decision that cannot be closed.
export function optionsOf(stored: unknown): DecisionOption[] {
  if (!Array.isArray(stored)) return withdrawOptions();
  const options: DecisionOption[] = [];
  for (const entry of stored) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, label, kind } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || key === '' || typeof label !== 'string' || typeof kind !== 'string' || !OPTION_KINDS.includes(kind)) continue;
    options.push({ key, label, kind: kind as DecisionOption['kind'] });
  }
  return options.length > 0 ? options : withdrawOptions();
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
  // Known only after the ledger assigns it; the printed command carries a placeholder until then.
  decisionId?: string;
}

function consequenceFor(option: DecisionOption, itemId: string, dependents: readonly string[]): string {
  if (option.kind === 'withdraw') {
    const who = dependents.length > 0 ? `item ${itemId} and its dependents (${dependents.join(', ')}) are` : `item ${itemId} is`;
    return `the decision closes with nothing applied; ${who} not delivered, and the run ends failed once every other ready item has finished`;
  }
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
  const dependents = input.dependents.filter((id, i, all) => id !== itemId && all.indexOf(id) === i);

  const consequences: DecisionConsequences = {};
  for (const option of options) consequences[option.key] = consequenceFor(option, itemId, dependents);
  const amend = amendCommandFor(input.signal, input.runId, input.decisionId ?? DECISION_ID_PLACEHOLDER);
  if (amend !== null) consequences.amend = amend;

  // The contract is the only source of a default: a classification that claims one the contract does not name is read as a
  // decision for a human (AUT-2).
  const offersAnAnswer = options.some((o) => o.kind !== 'withdraw');
  const named =
    classification.authority === 'default' && offersAnAnswer
      ? input.decisions.defaults.find((d) => d.class === classification.class && d.default !== '' && d.default === classification.authorizedDefault)
      : undefined;
  const authority: DecisionAuthority = classification.authority === 'default' && named === undefined ? 'human' : classification.authority;

  const recommended = classification.recommended !== undefined && options.some((o) => o.key === classification.recommended) ? classification.recommended : undefined;
  return {
    class: classification.class,
    authority,
    issue: issue === '' ? NO_REASON_ISSUE : issue,
    ...(recommended !== undefined ? { recommendation: `the unit recommended option ${recommended}` } : {}),
    options,
    consequences,
    evidenceRefs: [...input.evidenceRefs],
    affectedItems: [itemId, ...dependents],
    ...(named !== undefined ? { authorizedDefault: named.default } : {}),
    urgency: 'blocking',
  };
}
