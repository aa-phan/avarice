// Stage for `running` (plan 02-13; FR-2, FR-4, FR-6, AUT-7, RC-4, CON-2, OPS-2, D-03, D-17): one GSD unit (`/gsd-quick --validate --text`) per
// item attempt, judged by AVARICE from facts it measured, and committed by the supervisor.
//
//   context-pack  an index-first pack (intel, then graph) for the prompt; the step keeps item references and a digest, never text (S-41)
//   launch:run    attempt, item ready -> delegated, a snapshot of the clone, one contained invocation of the unit
//   classify      resultSeen, is_error, exit, signal, timeout, denials, clone HEAD before and after, a quick SUMMARY, in-scope changes since the
//                 snapshot, a structural pause signal, a hook loop-limit stop; model text decides nothing (AUT-7). A numbered choice that is another
//                 item's, in a unit that is verified and otherwise progressed, is attributed to that item and is no pause (plan 03-40; fails closed).
//                 Anything but `progressed` ends in a
//                 decision, except a crashed or timed-out unit with no moved HEAD: it is discarded to its snapshot and retried once (CON-16)
//   discard-attempt  the CON-16 recovery (discard.ts), then the retry attempt goes straight on to `launch:run`
//   gate:g2       scope, deletions, GSD verification status, overrides, PRUNE entries, and the required checks on the working tree
//   commit        quick records and GSD bookkeeping archived and taken out of the clone, then the supervisor commits only the in-scope paths
//                 with `Avarice-Run` and `Avarice-Attempt` trailers; the run moves to `running` again while another item remains (D-09), to
//                 `verifying` after the last
//
// A run has several work items (plan 03-14; D-08, D-09, AUT-3, AUT-16): the stage asks `runDisposition` (src/domain/work-items.ts) which item to
// continue or start, runs it through the steps above as its own unit with its own attempt, gate and commit, and then asks again. Items run one at a
// time, in dependency and declaration order. Nothing here reads the first item, the run's last attempt or a literal ID to mean the current item.
//
// The GSD records of the unit (`.planning/quick/**`, `.planning/STATE.md`) are artifacts (D-17): they never reach the review branch.
// The host's own outcome `kind` is not read here (spike S2-B: both live rounds ended `denied` on improvised shell lines, with the unit done).
import { randomUUID } from 'node:crypto';
import { digestOf, sha256Hex } from '../../domain/digest.ts';
import { baselineDelta, revisionOf } from '../../domain/evidence.ts';
import type { DeltaBlocking } from '../../domain/evidence.ts';
import { evaluateG1, evaluateG2, evaluateG3, g1PathBreaches, integrityFailures } from '../../domain/gates.ts';
import type { G1Facts, GateVerdict } from '../../domain/gates.ts';
import { matchesAny } from '../../domain/glob.ts';
import { hasOwnerChoice, itemChoiceOptions, sharedChoiceOptions } from '../../domain/item-scope.ts';
import { attributeNumberedChoice, choiceLines, classifyOutcome, detectPause } from '../../domain/outcome.ts';
import type { Attribution, ClassifiedKind, OutcomeFacts, PauseSignal } from '../../domain/outcome.ts';
import { countPruneEntries, parseQuickPlan, parseQuickVerification, quickRecordKind, storedText } from '../../domain/quick-record.ts';
import type { QuickPlan, QuickVerification } from '../../domain/quick-record.ts';
import { err, ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import { compareInventories } from '../../domain/test-inventory.ts';
import type { InventoryFailure } from '../../domain/test-inventory.ts';
import { planNamedSpec } from '../../domain/run-contract.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import { optionsOf } from '../../domain/decision-policy.ts';
import type { DecisionSignal } from '../../domain/decision-policy.ts';
import type { RunDisposition } from '../../domain/work-items.ts';
import type { InvocationOutcome } from '../../ports/agent-host.ts';
import type { AttemptRow, DecisionRow, RunRow, WorkItemRow } from '../../ports/ledger.ts';
import type { PathChange, WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { measureInventory, recordedInventory, runRequiredChecks } from '../checks.ts';
import type { CheckRunResult, InventoryMeasure } from '../checks.ts';
import { queryContext } from '../context.ts';
import { completeRunInvocation, prepareRunInvocation } from '../invocation.ts';
import { flushDueNotifications } from '../notify.ts';
import { faultPoint } from '../onboarding-service.ts';
import { RUN_GSD_SETTINGS, runResumePrompt, runUnitPrompt } from '../run-gsd-config.ts';
import type { RunPromptItem } from '../run-gsd-config.ts';
import { blockItem, blockRun, completeItemBlock, moveOn } from './blocked.ts';
import { discardAttempt } from './discard.ts';
import { latestParkOf, parkItem, parkStepOf } from './park.ts';
import type { ParkedItem } from './park.ts';
import { REPAIR_REASON, itemStartInventory, itemStartStatuses, recordReproducerStep, repairStepOf, repairUnit, repairsOf, reproducerFor, reproducerIssue, reproducerRefs } from './repair.ts';
import type { PreparedRepair, ReproducerSet } from './repair.ts';
import { scheduleOf } from './schedule.ts';
import type { RunStage, RunStageContext } from './stage.ts';

const GSD_CONFIG_PATH = '.planning/config.json';
const GSD_CONFIGURE_STEP = 'gsd:configure';
const RECORD_MAX_BYTES = 64 * 1024;
const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;
const PACK_BUDGET = 4000;
const MAX_IGNORED_STORED = 200;
const STORE = 'local';
const RUN_RETENTION = 'run';
const QUICK_RECORD_KIND = 'gsd-quick-record';
// The reason of the attempt that follows a discard (CON-16).
const RETRY_REASON = 'con16-retry';
// The step that names the attempt whose snapshot an item's work is measured against: its G2 and its commit read the changes since it, whatever repair
// units came after (plan 03-19). Written by every unit that is not a repair.
const ITEM_BASE_STEP = 'item:base';
// The reason of the first attempt of an item after its decision was answered (plan 03-18).
export const ANSWER_REASON = 'answer';
// The reason of the attempt that resumes the item's own paused session with the owner's answer (plan 03-22; D-08, D-16).
export const RESUME_REASON = 'resume';
// The checkpoint before the parked delta is put back on top of the current HEAD for a resumed unit, and the step that says an answered item gave up on its
// resume and runs a fresh unit with the answer instead (the host did not know the session, the resumed unit crashed, or the delta could not be unparked).
const UNPARK_CHECKPOINT = 'unpark';
const RESUME_FALLBACK_STEP = 'resume:fallback';
// A session ID the host accepts (the adapter refuses anything else): the ledger's value is checked again before it is put on a launch line (T-03-42).
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The question the owner answered, as the fresh unit's prompt repeats it (data, cut).
const QUESTION_PROMPT_CHARS = 600;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Everything one pass of the stage needs, read once.
interface Unit {
  ctx: RunStageContext;
  contract: RunContract;
  contractVersion: number;
  clone: string;
  item: WorkItemRow;
}

// The unit of one named work item (D-09): the stage and the resume reconcile both say which item they mean.
function loadUnit(ctx: RunStageContext, row: RunRow, itemId: string): Result<Unit> {
  const stored = ctx.deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  if (row.workspacePath === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
  const items = ctx.deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.itemId === itemId);
  if (item === undefined) return err({ kind: 'not_found', ref: `work item ${itemId} of run ${ctx.runId}` });
  return ok({ ctx, contract: stored.value.body as RunContract, contractVersion: stored.value.version, clone: row.workspacePath, item });
}

// What the scheduler says to do now: the run's items in declaration order (the ledger's row order) and its decisions, through the pure rule.
function schedule(ctx: RunStageContext): Result<{ items: WorkItemRow[]; decisions: DecisionRow[]; disposition: RunDisposition }> {
  return scheduleOf(ctx.deps, ctx.runId);
}

// The item as the unit prompt states it. A run with one item keeps the Phase 2 prompt (no item line); with several, each unit is told which
// item it is, its title, the criteria it owns and the files its spec names when the spec is explicit.
function promptItemOf(contract: RunContract, itemId: string): RunPromptItem | undefined {
  if (contract.intent.workItems.length <= 1) return undefined;
  const item = contract.intent.workItems.find((i) => i.id === itemId);
  if (item === undefined) return undefined;
  const owned = new Set(item.acceptance);
  const acceptance = contract.intent.acceptance.filter((c) => owned.has(c.id)).map((c) => `${c.id}: ${c.text}`);
  const explicit = !item.spec.derived.includes('files') && item.spec.files.length > 0;
  return { id: item.id, task: item.task, acceptance, ...(explicit ? { specFiles: item.spec.files } : {}) };
}

// The latest decision of the item, when the owner answered it: the item is the first of the decision's affected items. `firstUse` is false once a
// `launch:run` step of a unit that is not a resume names the decision (the answer was given to a fresh unit already), so only the first attempt after the answer
// is an `answer` attempt; a resume that was tried leaves it true, because a resume that fell back is followed by that fresh unit. `fellBack` is true once the
// item gave up on resuming for this decision (plan 03-22).
interface Answered {
  decision: DecisionRow;
  firstUse: boolean;
  fellBack: boolean;
}

function answeredDecisionOf(ctx: RunStageContext, itemId: string): Result<Answered | null> {
  const decisions = ctx.deps.ledger.listDecisions({ runId: ctx.runId });
  if (!decisions.ok) return decisions;
  const latest = decisions.value.filter((d) => d.affectedItems[0] === itemId).at(-1);
  if (latest === undefined || latest.state !== 'answered' || latest.answer === null) return ok(null);
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId, { itemId });
  if (!attempts.ok) return attempts;
  const resumes = new Set(attempts.value.filter((a) => a.reason === RESUME_REASON).map((a) => a.attemptId));
  const used = steps.value.some(
    (s) => s.step === 'launch:run' && isObject(s.result) && s.result['answeredDecisionId'] === latest.decisionId && !resumes.has(String(s.result['attemptId'])),
  );
  const fellBack = steps.value.some((s) => s.step === RESUME_FALLBACK_STEP && isObject(s.result) && s.result['itemId'] === itemId && s.result['decisionId'] === latest.decisionId);
  return ok({ decision: latest, firstUse: !used, fellBack });
}

// What a resume of the answered item needs: the session its paused unit ran under (the item's `gsd_session`, set when the unit was delegated, D-08) and the
// delta that unit left, which is put back before the host is called. An item with neither, or a session the host would refuse, runs a fresh unit with the
// answer instead (plan 03-18's path).
interface ResumePlan {
  sessionId: string;
  parked: ParkedItem;
}

function resumePlanOf(unit: Unit): Result<ResumePlan | null> {
  const session = unit.item.gsdSession;
  if (session === null || !SESSION_ID.test(session)) return ok(null);
  const parked = latestParkOf(unit.ctx, unit.item.itemId);
  if (!parked.ok) return parked;
  return ok(parked.value === null ? null : { sessionId: session, parked: parked.value });
}

// The item as a resume prompt names it: its title and criteria when the brief has several items, else the one item of the brief.
function resumeItemOf(contract: RunContract, itemId: string): RunPromptItem {
  const own = promptItemOf(contract, itemId);
  if (own !== undefined) return own;
  const item = contract.intent.workItems.find((i) => i.id === itemId);
  return { id: itemId, task: item?.task ?? contract.intent.title, acceptance: [] };
}

// The owner's answer as the resumed session reads it: a choice by its number and label (the session remembers asking), free text as typed.
function resumeAnswerText(decision: DecisionRow): string {
  const answer = (decision.answer ?? '').trim();
  const chosen = optionsOf(decision.options).find((o) => o.kind === 'choice' && o.key === answer);
  return chosen !== undefined ? `${chosen.key}. ${chosen.label}` : answer;
}

// What the fresh unit is told about the decision: the question it asked (a numbered choice answers by its number, so the number alone would say
// nothing to a unit that has no memory of asking) and the owner's answer, a choice by its label. Data under the fixed line of the prompt, never an
// instruction.
function ownerAnswerText(decision: DecisionRow): string {
  const answer = (decision.answer ?? '').trim();
  const chosen = optionsOf(decision.options).find((o) => o.kind === 'choice' && o.key === answer);
  const question = storedText(decision.issue, QUESTION_PROMPT_CHARS);
  return `Your question: ${question}\nThe owner's answer: ${chosen !== undefined ? `${chosen.key}. ${chosen.label}` : answer}`;
}

// The step result of this attempt, by the attempt ID every result carries.
function stepOfAttempt(ctx: RunStageContext, step: string, attemptId: string): Result<Record<string, unknown> | null> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const s of [...steps.value].reverse()) {
    if (s.step === step && s.status === 'completed' && isObject(s.result) && s.result['attemptId'] === attemptId) return ok(s.result);
  }
  return ok(null);
}

// The latest attempt of one item (an attempt that carries no item reads as the item the ledger calls A).
function latestAttemptOf(ctx: RunStageContext, itemId: string): Result<AttemptRow | null> {
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId, { itemId });
  if (!attempts.ok) return attempts;
  return ok(attempts.value.at(-1) ?? null);
}

// The latest attempt of the item whose unit progressed (its `classify` step says so): the one gate G2 and the commit judge. A repair attempt a kill left
// before its unit launched, or one that ended any other way, is not it.
function gatedAttemptOf(ctx: RunStageContext, itemId: string): Result<AttemptRow | null> {
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId, { itemId });
  if (!attempts.ok) return attempts;
  for (const attempt of [...attempts.value].reverse()) {
    const classified = stepOfAttempt(ctx, 'classify', attempt.attemptId);
    if (!classified.ok) return classified;
    if (classified.value?.['kind'] === 'progressed') return ok(attempt);
  }
  return ok(null);
}

// The snapshot an item's work is measured against: the one of the latest unit of the item that is not a repair (its `item:base` step). A run that predates
// the step, or an attempt with none, is measured against its own attempt's snapshot, which was the only one there was.
function itemBaseOf(ctx: RunStageContext, itemId: string, attemptId: string): Result<WorkspaceSnapshot> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const step of [...steps.value].reverse()) {
    if (step.step !== ITEM_BASE_STEP || step.status !== 'completed' || !isObject(step.result)) continue;
    if (step.result['itemId'] === itemId && typeof step.result['attemptId'] === 'string') return snapshotOf(ctx, step.result['attemptId']);
  }
  return snapshotOf(ctx, attemptId);
}

function recordStep(ctx: RunStageContext, step: string, attempt: number, result: Record<string, unknown>, startedMs: number): Result<unknown> {
  return ctx.deps.ledger.recordRunStep(ctx.runId, { step, attempt, status: 'completed', result, nowMs: startedMs, completedAtMs: ctx.deps.clock.nowMs() });
}

// ---- context pack ------------------------------------------------------------------------------------

// The prompt's pack and the step that records it. Intel items come before graph items (queryContext's order); the step keeps references,
// freshness, sizes and a digest of the pack, never an excerpt (S-41).
async function contextPack(unit: Unit, run: RunRow, attemptOrdinal: number): Promise<Result<string>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const startedMs = deps.clock.nowMs();
  const refs: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const lines: string[] = [];
  let usedTokens = 0;
  if (deps.context === undefined) {
    notes.push('no context sources are composed');
  } else {
    const report = await queryContext(deps, { projectId: run.projectId, term: contract.intent.title, budget: PACK_BUDGET });
    if (!report.ok) {
      notes.push(`the index cannot answer: ${report.error.kind}`);
    } else {
      usedTokens = report.value.usedTokens;
      notes.push(...report.value.notes.slice(0, 10).map((n) => storedText(n, 200)));
      report.value.items.forEach((item, index) => {
        refs.push({ source: item.source, id: item.ref.id, scope: item.ref.scope, revision: item.ref.revision ?? null, freshness: item.freshness, estTokens: item.estTokens, untrusted: item.untrusted === true });
        lines.push(`${index + 1}. [${item.source}] ${item.title} (${item.ref.scope} at ${item.ref.revision ?? 'an unknown revision'}, ${item.freshness})`);
        lines.push(...item.excerpt.split('\n').map((line) => `   ${line}`));
      });
    }
  }
  const text = lines.join('\n');
  const recorded = recordStep(ctx, 'context:pack', attemptOrdinal, { attemptId: null, items: refs, notes, usedTokens, digest: digestOf({ refs, text }) }, startedMs);
  return recorded.ok ? ok(text) : recorded;
}

// ---- classification ----------------------------------------------------------------------------------

interface Classified {
  kind: ClassifiedKind;
  headMoved: boolean;
  facts: OutcomeFacts;
  headNow: string;
  changes: PathChange[];
  verification: QuickVerification;
  pruneEntries: number;
  summaryPresent: boolean;
  inScope: number;
  pauseSignal: string | null;
  // A numbered choice the unit ended with, judged by attributeNumberedChoice: the signal, the item it was attributed to (null when it stays the unit's own
  // pause) and, when it was not attributed, a fixed reason. Null when the unit ended with no numbered choice. Never holds the question text.
  pauseAttribution: { signal: PauseSignal; attributedTo: string | null; reason?: string } | null;
  // The pause text the host captured, stored as data by the decision.
  question: string | undefined;
  hostError: PortError | undefined;
  // The hook stopped this invocation at a loop limit (CON-14): `loop.limit` event for it.
  loopLimit: { reason: string; count: number; limit: number } | null;
  // The host did not know the session a resume named (spike S3-A): a result event of subtype `error_during_execution`, an error, no turns, no cost and exit 1.
  // Only a resumed unit reads it; it is a structural fact, not a reading of any text (the adapter drops the host's own message).
  sessionGone: boolean;
}

const isInScope = (change: PathChange, contract: RunContract): boolean =>
  !matchesAny(change.path, contract.files.artifacts) &&
  !matchesAny(change.path, contract.files.protected) &&
  (change.status === 'deleted' ? matchesAny(change.path, contract.files.delete) : matchesAny(change.path, contract.files.write) || matchesAny(change.path, contract.files.create));

// The paths that break the contract, by the same rules as G2's scope and deletion checks (src/domain/gates.ts): the finding names them.
function breaches(changes: readonly PathChange[], contract: RunContract): string[] {
  const g = contract.files;
  return changes
    .filter((c) => {
      if (matchesAny(c.path, g.protected)) return true;
      if (c.status === 'modified') return !matchesAny(c.path, g.write) && !matchesAny(c.path, g.artifacts);
      if (c.status === 'added') return !matchesAny(c.path, g.create) && !matchesAny(c.path, g.artifacts);
      return !matchesAny(c.path, g.delete);
    })
    .map((c) => c.path);
}

// A record of at most 64 KiB; one that is larger or unreadable is treated as absent for the facts, which can only block (fail closed).
function readRecord(unit: Unit, rel: string | undefined): Result<string | null> {
  if (rel === undefined) return ok(null);
  const read = unit.ctx.deps.runWorkspace?.readText(unit.clone, rel, RECORD_MAX_BYTES);
  if (read === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  if (!read.ok && read.error.kind === 'invalid') return ok('---\nstatus: gaps_found\n---\n');
  return read;
}

// Whether a numbered choice the unit ended with is another item's (plan 03-40). The options each item owns come from the brief and from the run's open
// decisions; the rule itself is pure (attributeNumberedChoice) and fails closed, and so does this: decisions that cannot be read mean no attribution.
function attributionOf(unit: Unit, tail: string, verified: boolean): Attribution {
  const { ctx, contract } = unit;
  const decisions = ctx.deps.ledger.listDecisions({ runId: ctx.runId });
  if (!decisions.ok) return { attributedTo: null, reason: 'the decisions could not be read' };
  const itemIds = contract.intent.workItems.map((i) => i.id);
  const labelsOf = (id: string, wanted: (d: DecisionRow) => boolean): string[] =>
    decisions.value.filter((d) => d.affectedItems[0] === id && wanted(d)).flatMap((d) => optionsOf(d.options).filter((o) => o.kind === 'choice').map((o) => o.label));
  const own = unit.item.itemId;
  const optionsByItem: Record<string, string[]> = {};
  for (const id of itemIds) optionsByItem[id] = itemChoiceOptions(contract, id, labelsOf(id, (d) => d.state === 'open'));
  return attributeNumberedChoice({
    signal: 'numbered-choice',
    choiceLines: choiceLines(tail),
    ownItemId: own,
    itemIds,
    // The unit's own side counts the options of its decisions in every state: a choice it asked and was answered is still its own.
    ownOptions: itemChoiceOptions(contract, own, labelsOf(own, () => true)),
    sharedOptions: sharedChoiceOptions(contract.intent.behavior, itemIds),
    optionsByItem,
    ownerChoiceItems: itemIds.filter((id) => hasOwnerChoice(contract, id) || decisions.value.some((d) => d.state === 'open' && d.affectedItems[0] === id)),
    verified,
  });
}

function classify(unit: Unit, prepared: { request: { invocationId: string } }, outcome: Result<InvocationOutcome>, snapshot: WorkspaceSnapshot): Result<Classified> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const head = workspace.head(unit.clone);
  if (!head.ok) return head;
  const changed = workspace.changedSince(unit.clone, snapshot);
  if (!changed.ok) return changed;
  const changes = changed.value;

  const summaryPath = changes.find((c) => c.status !== 'deleted' && quickRecordKind(c.path) === 'summary')?.path;
  const verificationPath = changes.find((c) => c.status !== 'deleted' && quickRecordKind(c.path) === 'verification')?.path;
  const summaryText = readRecord(unit, summaryPath);
  if (!summaryText.ok) return summaryText;
  const verificationText = readRecord(unit, verificationPath);
  if (!verificationText.ok) return verificationText;
  const verification = parseQuickVerification(verificationText.value);
  const prune = countPruneEntries(summaryText.value) + countPruneEntries(verificationText.value);
  const inScope = changes.filter((c) => isInScope(c, contract)).length;
  const summaryPresent = summaryPath !== undefined;

  const hooks = deps.ledger.countHookDenials(prepared.request.invocationId);
  if (!hooks.ok) return hooks;
  const loopLimit = deps.ledger.findLoopLimit(prepared.request.invocationId);
  if (!loopLimit.ok) return loopLimit;
  const details = outcome.ok ? outcome.value.details : undefined;
  const question = outcome.ok ? outcome.value.question : undefined;
  const waitingJson = changes.some((c) => c.status !== 'deleted' && /(^|\/)WAITING\.json$/.test(c.path));
  const pause = detectPause({ waitingJson, verificationStatus: verification.status, ...(question !== undefined ? { finalTextTail: question } : {}) });

  const facts: OutcomeFacts = {
    // A host that reports no details, no result or no boolean is_error is never taken for a success (classifyOutcome fails closed).
    resultSeen: outcome.ok && (details?.resultSeen ?? false),
    ...(details?.isError !== undefined ? { isError: details.isError } : {}),
    ...(details?.subtype !== undefined ? { subtype: details.subtype } : {}),
    ...(details?.terminalReason !== undefined ? { terminalReason: details.terminalReason } : {}),
    permissionDenials: outcome.ok ? outcome.value.permissionDenials.length : 0,
    hookDenies: Math.max(details?.hookDenies ?? 0, hooks.value.total),
    hookBudgetDenies: Math.max(details?.hookBudgetDenies ?? 0, hooks.value.budget),
    timedOut: details?.timedOut ?? (!outcome.ok && outcome.error.kind === 'timeout'),
    exitCode: details?.exitCode ?? null,
    signal: details?.signal ?? null,
    headBefore: snapshot.head,
    headAfter: head.value,
    expectedFilesPresent: summaryPresent && inScope > 0,
    pauseSignal: pause.paused,
  };
  // A numbered choice that is another item's (plan 03-40): only the text shape is ever attributed, and only for a unit whose own work is verified and would
  // otherwise be progressed. An attributed choice changes this classification only; nothing is opened, answered or withdrawn by it.
  let pauseAttribution: Classified['pauseAttribution'] = null;
  if (pause.signal === 'numbered-choice' && question !== undefined) {
    const verified = verification.status === 'passed' && summaryPresent && inScope > 0 && classifyOutcome({ ...facts, pauseSignal: false }).kind === 'progressed';
    const attribution = attributionOf(unit, question, verified);
    pauseAttribution =
      attribution.attributedTo !== null
        ? { signal: 'numbered-choice', attributedTo: attribution.attributedTo }
        : { signal: 'numbered-choice', attributedTo: null, reason: attribution.reason };
    if (attribution.attributedTo !== null) facts.pauseSignal = false;
  }
  const attributed = pauseAttribution?.attributedTo != null;
  const cls = classifyOutcome(facts);
  return ok({
    kind: cls.kind,
    headMoved: cls.headMoved,
    facts,
    headNow: head.value,
    changes,
    verification,
    pruneEntries: prune,
    summaryPresent,
    inScope,
    pauseSignal: attributed ? null : pause.signal,
    pauseAttribution,
    question: attributed ? undefined : question,
    hostError: outcome.ok ? undefined : outcome.error,
    loopLimit: loopLimit.value,
    sessionGone:
      outcome.ok &&
      cls.kind === 'failed' &&
      details?.resultSeen === true &&
      details.isError === true &&
      details.subtype === 'error_during_execution' &&
      details.numTurns === 0 &&
      outcome.value.costUsd === 0 &&
      details.exitCode === 1,
  });
}

// ---- the stage ---------------------------------------------------------------------------------------

export const runningStage: RunStage = async (ctx, row) => {
  const scheduled = schedule(ctx);
  if (!scheduled.ok) return scheduled;
  const { items, disposition } = scheduled.value;
  if (disposition.kind === 'all-done') {
    // Every item is committed: the last attempt of the run names the revision that goes to verification.
    const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId);
    if (!attempts.ok) return attempts;
    const attempt = attempts.value.at(-1);
    if (row.workspacePath === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
    const head = ctx.deps.runWorkspace?.head(row.workspacePath);
    if (head === undefined || !head.ok) return head ?? err({ kind: 'internal', cause: 'the run workspace is not composed' });
    const itemId = attempt?.itemId ?? items.at(0)?.itemId;
    const moved = ctx.transition(row, 'verifying', 'verify:checks', {
      ...(attempt !== undefined ? { attemptId: attempt.attemptId } : {}),
      ...(itemId !== undefined ? { itemId } : {}),
      revision: `git:${head.value}`,
    });
    return moved.ok ? ok(undefined) : moved;
  }
  // Every remaining item waits on an open decision, or no remaining item can ever run (D-09, AUT-12): the run is visibly blocked (nothing polls; an
  // answer starts a supervisor again), or it ends failed with the undelivered items named.
  if (disposition.kind === 'blocked' || disposition.kind === 'undeliverable') {
    const moved = moveOn(ctx, row, disposition);
    return moved.ok ? ok(undefined) : moved;
  }

  const loaded = loadUnit(ctx, row, disposition.itemId);
  if (!loaded.ok) return loaded;
  const unit = loaded.value;
  switch (unit.item.state) {
    case 'ready':
      return attemptUnit(unit, row);
    case 'implemented': {
      // The attempt that is judged is the latest one whose unit progressed: a repair attempt that never launched has no classification and is not it.
      const attempt = gatedAttemptOf(ctx, unit.item.itemId);
      if (!attempt.ok) return attempt;
      if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is implemented but run ${ctx.runId} has no progressed attempt of it` });
      return gateUnit(unit, row, attempt.value.attemptId);
    }
    case 'gated': {
      const attempt = latestAttemptOf(ctx, unit.item.itemId);
      if (!attempt.ok) return attempt;
      if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is gated but run ${ctx.runId} has no attempt of it` });
      const base = itemBaseOf(ctx, unit.item.itemId, attempt.value.attemptId);
      if (!base.ok) return base;
      return commitUnit(unit, attempt.value.attemptId, base.value);
    }
    default:
      // delegated: an attempt was in flight when the supervisor stopped. Whether its host still runs and what it left is the recovery
      // plan's question (plans 02-16 and 02-17); relaunching blind would run a second unit beside a surviving first.
      return err({ kind: 'internal', cause: `item ${unit.item.itemId} of run ${ctx.runId} is ${unit.item.state}: an interrupted attempt is reconciled by resume, not relaunched by the stage` });
  }
};

// What reconcileItem did for an item that was in flight when the supervisor died (plan 02-17): `none` (the stage carries on from the item's state),
// `retry` (the attempt was discarded and the item is ready for its one retry), `committed` (the supervisor's own commit was found and recorded) or
// `blocked` (the run was moved to blocked_on_decision).
export type ItemReconcile = 'none' | 'retry' | 'committed' | 'blocked';

// Called by the supervisor's resume prelude (run-resume.ts) after every surviving host has been reaped, so nothing writes the clone while it is read.
// Only `delegated` and `gated` items can have been in flight; every other item state is continued by the stage as it is. The decisions rest on the
// ledger (the attempt, its snapshot and classify steps) and on git (the clone's HEAD and its trailers), never on anything the unit said.
export function reconcileItem(ctx: RunStageContext, row: RunRow, itemId: string): Result<ItemReconcile> {
  const loaded = loadUnit(ctx, row, itemId);
  if (!loaded.ok) return loaded;
  const unit = loaded.value;
  // An item block that was in progress (plan 03-18) is finished, not redone: its park step says the unit already ended asking.
  if (unit.item.state === 'delegated' || unit.item.state === 'implemented' || unit.item.state === 'gated') {
    const resumed = resumeBlock(unit);
    if (!resumed.ok) return resumed;
    if (resumed.value) return ok('blocked');
  }
  if (unit.item.state === 'delegated') return reconcileDelegated(unit);
  if (unit.item.state === 'gated') return reconcileGated(unit);
  if (unit.item.state === 'implemented') {
    // A repair attempt a kill left before its unit launched (the checkpoint and the attempt were written, the move to delegated was not): it ran nothing, so
    // it is ended and the item is gated again, which starts the repair again.
    const ended = endUnlaunchedRepair(unit);
    if (!ended.ok) return ended;
  }
  return ok('none');
}

// The latest attempt of the item when it is a repair whose unit never launched: ended `discarded`. Nothing else is touched.
function endUnlaunchedRepair(unit: Unit): Result<void> {
  const { ctx } = unit;
  const attempt = latestAttemptOf(ctx, unit.item.itemId);
  if (!attempt.ok) return attempt;
  if (attempt.value === null || attempt.value.reason !== REPAIR_REASON || attempt.value.endedAt !== null) return ok(undefined);
  const launched = launchedAttempts(ctx);
  if (!launched.ok) return launched;
  if (launched.value.has(attempt.value.attemptId)) return ok(undefined);
  const ended = ctx.deps.ledger.endRunAttempt(attempt.value.attemptId, { outcome: 'discarded', nowMs: ctx.deps.clock.nowMs() });
  return ended.ok || ended.error.kind === 'conflict' ? ok(undefined) : ended;
}

// The supervisor died inside an item block (blockItem): the park step of the item's latest attempt was recorded `started` (the delta may or may not be
// out of the tree yet) or `completed` (the decision may or may not be written). The park is repeated (the workspace returns the same record for the
// same content) and the decision half is written from the step. No second unit of the item runs. Returns whether a block was in progress.
function resumeBlock(unit: Unit): Result<boolean> {
  const { ctx } = unit;
  const attempt = latestAttemptOf(ctx, unit.item.itemId);
  if (!attempt.ok) return attempt;
  if (attempt.value === null) return ok(false);
  const step = parkStepOf(ctx, attempt.value.attemptId);
  if (!step.ok) return step;
  if (step.value === null) return ok(false);
  if (step.value.status === 'started') {
    // The delta that is parked is the item's whole work since its base, whichever unit (a repair included) the block ended in.
    const snapshot = itemBaseOf(ctx, unit.item.itemId, attempt.value.attemptId);
    if (!snapshot.ok) return snapshot;
    const parked = parkItem(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId: attempt.value.attemptId, ordinal: attempt.value.ordinal }, snapshot.value, step.value.block);
    if (!parked.ok) return parked;
  }
  const done = completeItemBlock(ctx, unit.item.itemId, attempt.value.attemptId);
  return done.ok ? ok(true) : done;
}

// The invocation budget the run was given: the limit a repeated failure reached, which the amend command raises by one.
function invocationsLimitOf(ctx: RunStageContext): number {
  const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
  return budgets.ok ? (budgets.value.find((b) => b.name === 'invocations')?.limit ?? -1) : -1;
}

// An attempt that was in flight (item `delegated`): its invocation was killed with the supervisor, or it had ended and the supervisor died before its
// classification was recorded, or the supervisor died inside the discard of a crashed unit. All are read as the attempt having ended `inconclusive` and
// take the CON-16 road: the clone goes back to the attempt's snapshot, and the item is retried once. The killed invocation stays charged (the next
// reservation turns its orphaned reservation into spent invocations); nothing is refunded.
function reconcileDelegated(unit: Unit): Result<ItemReconcile> {
  const { ctx } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const attempt = latestAttemptOf(ctx, unit.item.itemId);
  if (!attempt.ok) return attempt;
  if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is delegated but run ${ctx.runId} has no attempt of it` });
  const { attemptId, ordinal } = attempt.value;
  const common = { attemptId, itemId: unit.item.itemId } as const;

  const snapshotStep = stepOfAttempt(ctx, 'snapshot', attemptId);
  if (!snapshotStep.ok) return snapshotStep;
  if (snapshotStep.value === null) {
    // The supervisor died after it marked the item delegated and before it took the snapshot: no unit was launched, so the clone is as it was. The
    // item is ready again; an `initial` attempt that never started is adopted by the next pass, any other is ended so it is not left open.
    if (attempt.value.reason !== 'initial') {
      const ended = deps.ledger.endRunAttempt(attemptId, { outcome: 'discarded', nowMs: deps.clock.nowMs() });
      if (!ended.ok && ended.error.kind !== 'conflict') return ended;
    }
    // A repair that never started goes back to the item's work as it was (implemented, to be gated and repaired again); any other attempt, to ready.
    const repair = attempt.value.reason === REPAIR_REASON;
    const moved = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: repair ? 'implemented' : 'ready', nowMs: deps.clock.nowMs(), attemptId, data: { reconciled: true } });
    return moved.ok ? ok(repair ? 'none' : 'retry') : moved;
  }
  const snapshot = snapshotOf(ctx, attemptId);
  if (!snapshot.ok) return snapshot;
  const head = workspace.head(unit.clone);
  if (!head.ok) return head;

  // The classification: a unit that was classified before the kill keeps its record; one that was not is recorded here as inconclusive, which is what
  // the attempt history, the status and a second failure's decision read.
  const launched = launchedAttempts(ctx);
  if (!launched.ok) return launched;
  const ran = launched.value.has(attemptId);
  const classified = stepOfAttempt(ctx, 'classify', attemptId);
  if (!classified.ok) return classified;
  let kind = typeof classified.value?.['kind'] === 'string' ? classified.value['kind'] : 'inconclusive';
  // An attempt the supervisor died in before it launched the unit (no `launch:run` step names it) ran nothing: it is not classified, it does not use
  // the item's one retry, and there is nothing in the clone to undo beyond what the discard finds.
  if (ran && classified.value === null) {
    const recorded = recordStep(
      ctx,
      'classify',
      ordinal,
      { attemptId, kind: 'inconclusive', interrupted: true, headMoved: head.value !== snapshot.value.head, headBefore: snapshot.value.head, headAfter: head.value, resultSeen: false },
      deps.clock.nowMs(),
    );
    if (!recorded.ok) return recorded;
    kind = 'inconclusive';
  }

  // The supervisor alone commits, and it commits only an item that passed its gate: a HEAD that moved under a delegated item is a breach.
  if (head.value !== snapshot.value.head) {
    const blocked = blockRun(ctx, {
      reason: 'enforcement_failure',
      signal: { kind: 'enforcement', check: 'head-moved' },
      issue: 'the clone HEAD moved while the unit was in flight: the supervisor alone commits, so containment did not hold',
      finding: { check: 'head-moved' },
      data: { headBefore: snapshot.value.head.slice(0, 12), headAfter: head.value.slice(0, 12) },
      ...common,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }

  // A repair has no CON-16 retry: it is the one chance a newly failing check gets (plan 03-19).
  if (attempt.value.reason === REPAIR_REASON) return reconcileRepair(unit, attempt.value, ran, kind);
  // A resume is not retried as a resume either: see reconcileResume.
  if (attempt.value.reason === RESUME_REASON) return reconcileResume(unit, attempt.value, snapshot.value, ran);

  const history = attemptHistoryOf(unit, attemptId, kind);
  if (!history.ok) return history;
  const stored = deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  const retries = stored.value === null ? 0 : (stored.value.body as RunContract).budgets.retry;
  if (!ran) {
    // Nothing to count against the retry or the budget: the clone is put back to the snapshot (a no-op when the unit never ran) and the attempt is redone.
    const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal, snapshot: snapshot.value });
    if (!discarded.ok) return discarded;
    return ok(discarded.value.discarded ? 'retry' : 'blocked');
  }
  if (history.value.length >= 1 + retries) {
    // The interrupted attempt was itself the retry: the one chance is spent, and the owner decides (FR-4).
    const blocked = blockItem(ctx, {
      reason: 'decision',
      signal: { kind: 'repeated-failure', limit: invocationsLimitOf(ctx) },
      issue: `the unit was interrupted, again after a discard and retry: ${describeHistory(history.value)}`,
      data: { attempts: history.value.map((a) => a.attemptId).join(','), kinds: history.value.map((a) => a.kind).join(',') },
      base: snapshot.value,
      ...common,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }
  const budgets = deps.ledger.getBudgets(ctx.runId);
  if (!budgets.ok) return budgets;
  const invocations = budgets.value.find((b) => b.name === 'invocations');
  // The killed invocation's reservation counts here: it is spent by the next reservation, so the retry needs a unit beyond it.
  if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
    const blocked = blockRun(ctx, { reason: 'budget_exhausted', signal: { kind: 'budget', names: ['invocations'] }, issue: `the invocations budget is spent, so the interrupted unit (${describeHistory(history.value)}) was not retried`, data: { budget: 'invocations' }, ...common });
    return blocked.ok ? ok('blocked') : blocked;
  }

  const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal, snapshot: snapshot.value });
  if (!discarded.ok) return discarded;
  return ok(discarded.value.discarded ? 'retry' : 'blocked');
}

// A repair attempt that was in flight (the item is `delegated`). A repair that never launched its unit ran nothing, so it is ended and the item goes back to
// `implemented` to be gated, and repaired, again. One whose unit progressed before the kill goes on to its gate. One whose unit was interrupted, or ended any
// other way, has used the check's one repair: the item is parked and the owner decides, with the reproducer the repair was started with.
function reconcileRepair(unit: Unit, attempt: AttemptRow, ran: boolean, kind: string): Result<ItemReconcile> {
  const { ctx } = unit;
  const { deps } = ctx;
  const { attemptId } = attempt;
  const back = (): Result<ItemReconcile> => {
    const moved = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'implemented', nowMs: deps.clock.nowMs(), attemptId, data: { reconciled: true } });
    return moved.ok ? ok('none') : moved;
  };
  if (!ran) {
    const ended = deps.ledger.endRunAttempt(attemptId, { outcome: 'discarded', nowMs: deps.clock.nowMs() });
    if (!ended.ok && ended.error.kind !== 'conflict') return ended;
    return back();
  }
  if (kind === 'progressed') return back();

  const base = itemBaseOf(ctx, unit.item.itemId, attemptId);
  if (!base.ok) return base;
  const step = repairStepOf(ctx, attemptId);
  if (!step.ok) return step;
  const blocked = blockItem(ctx, {
    reason: 'decision',
    signal: { kind: 'repeated-failure', limit: invocationsLimitOf(ctx) },
    issue: `the repair unit was interrupted, and a check gets one repair${step.value !== null ? `: ${reproducerIssue(step.value)}` : ''}`,
    evidenceRefs: step.value !== null ? reproducerRefs(step.value) : [],
    base: base.value,
    attemptId,
    itemId: unit.item.itemId,
  });
  return blocked.ok ? ok('blocked') : blocked;
}

// A resume attempt that was in flight (the item is `delegated`, its delta may or may not be back in the tree). One that never launched its unit ran nothing:
// the clone goes back to the attempt's snapshot (which takes the delta out again) and the item resumes again from the start, which puts the delta back (unpark
// is idempotent, and so is the end state). One whose unit was interrupted, or ended any other way the supervisor did not record, has no session to trust: it
// takes the road of a resumed unit that crashed, the fresh unit with the owner's answer, unless the invocations budget is spent (plan 03-22).
function reconcileResume(unit: Unit, attempt: AttemptRow, snapshot: WorkspaceSnapshot, ran: boolean): Result<ItemReconcile> {
  const { ctx } = unit;
  const { deps } = ctx;
  const { attemptId, ordinal } = attempt;
  if (ran) {
    const budgets = deps.ledger.getBudgets(ctx.runId);
    if (!budgets.ok) return budgets;
    const invocations = budgets.value.find((b) => b.name === 'invocations');
    // The killed invocation's reservation counts here: it is spent by the next reservation, so the fresh unit needs one beyond it.
    if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
      const blocked = blockRun(ctx, {
        reason: 'budget_exhausted',
        signal: { kind: 'budget', names: ['invocations'] },
        issue: "the invocations budget is spent, so the interrupted resumed session was not followed by a fresh unit with the owner's answer",
        data: { budget: 'invocations' },
        attemptId,
        itemId: unit.item.itemId,
      });
      return blocked.ok ? ok('blocked') : blocked;
    }
    const recorded = recordResumeFallback(unit, attemptId, ordinal, 'interrupted');
    if (!recorded.ok) return recorded;
  }
  const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal, snapshot });
  if (!discarded.ok) return discarded;
  return ok(discarded.value.discarded ? 'retry' : 'blocked');
}

// An item that passed its gate (`gated`): the supervisor may have made its commit and died before it recorded it. A HEAD that moved is the item's own
// commit only when its message carries this run's ID and the open attempt's ID in its `Avarice-*` trailers (the supervisor writes both) and its single
// parent is the attempt's snapshot head; then the
// `commit` step is recorded with it, the item is done, and no second commit is made. Any other commit on the clone is not ours.
function reconcileGated(unit: Unit): Result<ItemReconcile> {
  const { ctx } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const attempt = latestAttemptOf(ctx, unit.item.itemId);
  if (!attempt.ok) return attempt;
  if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is gated but run ${ctx.runId} has no attempt of it` });
  const { attemptId, ordinal } = attempt.value;
  const snapshot = snapshotOf(ctx, attemptId);
  if (!snapshot.ok) return snapshot;
  const head = workspace.head(unit.clone);
  if (!head.ok) return head;
  // HEAD still at the snapshot: the commit was not made, and the stage makes it.
  if (head.value === snapshot.value.head) return ok('none');

  const trailers = workspace.headTrailers(unit.clone);
  if (!trailers.ok) return trailers;
  if (trailers.value.runId !== ctx.runId || trailers.value.attemptId !== attemptId) {
    const blocked = blockRun(ctx, {
      reason: 'enforcement_failure',
      signal: { kind: 'enforcement', check: 'head-moved' },
      issue: 'the clone HEAD moved to a commit the supervisor did not make for this attempt (its Avarice-Run and Avarice-Attempt trailers do not name it): containment did not hold',
      finding: { check: 'head-moved' },
      data: { headBefore: snapshot.value.head.slice(0, 12), headAfter: head.value.slice(0, 12) },
      attemptId,
      itemId: unit.item.itemId,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }
  // The trailers are text any commit can repeat. The supervisor's own commit sits directly on the attempt's snapshot (a single parent), which also
  // proves the moved range is that one commit.
  if (trailers.value.parents.length !== 1 || trailers.value.parents[0] !== snapshot.value.head) {
    const blocked = blockRun(ctx, {
      reason: 'enforcement_failure',
      signal: { kind: 'enforcement', check: 'head-moved' },
      issue: "the clone HEAD moved to a commit that carries this attempt's trailers but does not sit directly on the attempt's snapshot: containment did not hold",
      finding: { check: 'head-moved' },
      data: { headBefore: snapshot.value.head.slice(0, 12), headAfter: head.value.slice(0, 12) },
      attemptId,
      itemId: unit.item.itemId,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }
  const changed = workspace.diffCommits(unit.clone, snapshot.value.head, head.value);
  if (!changed.ok) return changed;
  const recorded = recordStep(ctx, 'commit', ordinal, { attemptId, commit: head.value, paths: changed.value.length, archived: 0, artifactsRemoved: 0, reconciled: true }, deps.clock.nowMs());
  if (!recorded.ok) return recorded;
  const done = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'done', nowMs: deps.clock.nowMs(), attemptId, data: { commit: head.value.slice(0, 12), reconciled: true } });
  if (!done.ok) return done;
  const unparked = dropItemPark(unit);
  return unparked.ok ? ok('committed') : unparked;
}

function snapshotOf(ctx: RunStageContext, attemptId: string): Result<WorkspaceSnapshot> {
  const step = stepOfAttempt(ctx, 'snapshot', attemptId);
  if (!step.ok) return step;
  const r = step.value;
  if (r === null || typeof r['head'] !== 'string' || typeof r['tree'] !== 'string') return err({ kind: 'internal', cause: `attempt ${attemptId} has no snapshot step` });
  return ok({ head: r['head'], tree: r['tree'], ignored: Array.isArray(r['ignored']) ? r['ignored'].filter((x): x is string => typeof x === 'string') : [] });
}

// The GSD settings (RC-4) for an item whose clone no longer has them: the commit of the item before it took `.planning/config.json` out (D-17), so
// `config-set` runs again (outside any invocation, RESEARCH Pitfall 2) and the item gets its own `gsd:configure` step. A clone that has the file
// (the first item, a retry of any item) is left alone, so a run of one item records the steps it always did.
async function reapplyGsdSettings(unit: Unit, ordinal: number, attemptId: string): Promise<Result<void>> {
  const { ctx } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const present = workspace.readText(unit.clone, GSD_CONFIG_PATH, RECORD_MAX_BYTES);
  // A file over the read limit is a file that is there.
  if (!present.ok && present.error.kind !== 'invalid') return present;
  if (!present.ok || present.value !== null) return ok(undefined);

  const gsd = deps.gsd;
  if (gsd === undefined) return err({ kind: 'unavailable', cause: deps.gsdProblem !== undefined ? `no admitted gsd-core: ${deps.gsdProblem.found}` : 'no admitted gsd-core' });
  const startedMs = deps.clock.nowMs();
  const applied = await gsd.configure(unit.clone, RUN_GSD_SETTINGS);
  if (!applied.ok) return applied;
  const recorded = recordStep(
    ctx,
    GSD_CONFIGURE_STEP,
    ordinal,
    { attemptId, itemId: unit.item.itemId, applied: applied.value.map((s) => ({ key: s.key, value: s.value })), settingsDigest: digestOf(RUN_GSD_SETTINGS), runId: ctx.runId },
    startedMs,
  );
  return recorded.ok ? ok(undefined) : recorded;
}

// item ready -> delegated -> (launch, classify) -> implemented -> (G2) -> gated -> (commit) -> done
async function attemptUnit(unit: Unit, row: RunRow, options: { retry?: boolean } = {}): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  // The ordinal is the run's own count (a step is keyed by it); the reason and the retry budget count this item's attempts only.
  const mine = deps.ledger.listRunAttempts(ctx.runId, { itemId: unit.item.itemId });
  if (!mine.ok) return mine;
  // The baseline opened the first attempt for the item that runs first (the evidence of a check names an attempt); that item adopts it while it has
  // not started. Any other attempt (another item's first, or a retry) is opened here.
  const last = mine.value.at(-1);
  let adopted: AttemptRow | undefined;
  if (last !== undefined && last.endedAt === null && last.reason === 'initial') {
    const started = stepOfAttempt(ctx, 'snapshot', last.attemptId);
    if (!started.ok) return started;
    if (started.value === null) adopted = last;
  }
  const ordinal = adopted?.ordinal ?? attempts.value.length + 1;

  // The CON-16 retry follows its `discard-attempt` checkpoint with `launch:run`: the pack is rebuilt for the prompt (the step is recorded again),
  // and the stage does not commit a second `context-pack` checkpoint between the discard and the launch.
  if (options.retry !== true) {
    const marked = ctx.checkpoint('context-pack', { itemId: unit.item.itemId });
    if (!marked.ok) return marked;
  }
  const pack = await contextPack(unit, row, ordinal);
  if (!pack.ok) return pack;

  // An item whose decision the owner answered runs again as a fresh unit that carries the answer (plan 03-18): its first attempt after the answer has
  // the reason `answer`, and every later attempt of it (a CON-16 retry) carries the answer too.
  const answered = answeredDecisionOf(ctx, unit.item.itemId);
  if (!answered.ok) return answered;
  // The first attempt after the answer resumes the item's own paused session when it can (plan 03-22; D-08, D-16): its delta is put back and the host is
  // called with `--resume`. An item that fell back, or has no session or no delta to put back, runs a fresh unit with the answer.
  let resume: ResumePlan | null = null;
  if (adopted === undefined && mine.value.length > 0 && answered.value !== null && answered.value.firstUse && !answered.value.fellBack) {
    const plan = resumePlanOf(unit);
    if (!plan.ok) return plan;
    resume = plan.value;
  }
  const reason = mine.value.length === 0 ? 'initial' : resume !== null ? RESUME_REASON : answered.value?.firstUse === true ? ANSWER_REASON : RETRY_REASON;
  const attempt = adopted !== undefined ? ok(adopted) : deps.ledger.recordRunAttempt(ctx.runId, { reason, itemId: unit.item.itemId, nowMs: deps.clock.nowMs() });
  if (!attempt.ok) return attempt;
  const attemptId = attempt.value.attemptId;
  // The session ID is chosen here so the work item carries it from the moment it is delegated (D-08, RC-8): a decision's answer resumes that session. A
  // resume keeps the session it resumes; every fresh unit, including the one a failed resume falls back to, has its own.
  const sessionId = resume?.sessionId ?? randomUUID();
  const delegated = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'delegated', nowMs: deps.clock.nowMs(), attemptId, gsdSession: sessionId });
  if (!delegated.ok) return delegated;
  return launchUnit(unit, row, { attemptId, ordinal, sessionId, pack: pack.value, answered: answered.value, ...(resume !== null ? { resume } : {}) });
}

// What a unit is launched with: its attempt, the pack, the owner's answer when the item asked, and for a repair the reproducer and the item's base.
interface Launch {
  attemptId: string;
  ordinal: number;
  sessionId: string;
  pack: string;
  answered: Answered | null;
  repair?: { text: string; base: WorkspaceSnapshot };
  // A resume of the item's own session: the plan says which session and which delta (plan 03-22).
  resume?: ResumePlan;
}

// The launch of one unit of an item that is `delegated`: the settings, the snapshot, the contained invocation, the classification, and then its gate, or its
// routing when it did not progress. A repair is launched the same way, on the work the item's first unit left in the clone (plan 03-19).
async function launchUnit(unit: Unit, row: RunRow, launch: Launch): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const { attemptId, ordinal, sessionId, pack, answered, repair, resume } = launch;

  // The previous item's commit took `.planning/config.json` out of the clone (D-17): this item's unit gets the GSD settings again, before its snapshot,
  // so the settings never count as its change.
  const configured = await reapplyGsdSettings(unit, ordinal, attemptId);
  if (!configured.ok) return configured;

  // The clone as it is right before the unit runs: the configure step's `.planning/config.json` is in it, so only what the unit changes counts.
  const startedMs = deps.clock.nowMs();
  const snapshot = workspace.snapshot(unit.clone);
  if (!snapshot.ok) return snapshot;
  const snapped = recordStep(ctx, 'snapshot', ordinal, { attemptId, head: snapshot.value.head, tree: snapshot.value.tree, ignored: snapshot.value.ignored.slice(0, MAX_IGNORED_STORED), ignoredCount: snapshot.value.ignored.length }, startedMs);
  if (!snapped.ok) return snapped;
  // A unit that is not a repair starts the item's work: what G2 and the commit measure it against is this snapshot, whatever repair follows.
  if (repair === undefined) {
    const based = recordStep(ctx, ITEM_BASE_STEP, ordinal, { attemptId, itemId: unit.item.itemId }, startedMs);
    if (!based.ok) return based;
  }
  // The snapshot a block of the item parks against, and the one a unit that did not progress is discarded to (a repair is never discarded). A resume's is
  // the clean tree it took before it put the parked delta back, so the item's work since its base is the delta and whatever the resumed unit adds.
  const itemBase = repair?.base ?? snapshot.value;

  // A resume puts the item's parked delta back on top of the current HEAD before the host is called. When it cannot (the delta no longer applies, or its ref is
  // gone), the item gives up on the resume and runs a fresh unit with the answer from the HEAD it has.
  if (resume !== undefined) {
    const restored = unparkDelta(unit, attemptId, snapshot.value, resume.parked);
    if (!restored.ok) return restored;
    if (restored.value !== 'applied') return fallBackToAnswer(unit, row, { attemptId, snapshot: snapshot.value, reason: restored.value, spentCheck: false });
  }

  const launching = ctx.checkpoint('launch:run', { attemptId, itemId: unit.item.itemId, revision: snapshot.value.head });
  if (!launching.ok) return launching;

  let prompt: string;
  try {
    prompt =
      resume !== undefined && answered !== null
        ? runResumePrompt(resumeAnswerText(answered.decision), resumeItemOf(contract, unit.item.itemId))
        : runUnitPrompt(contract, pack, promptItemOf(contract, unit.item.itemId), answered === null ? undefined : ownerAnswerText(answered.decision), repair?.text);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    const blocked = blockItem(ctx, { reason: 'decision', signal: { kind: 'pause' }, issue: `the brief is too long for the unit prompt: ${cause.message}`, attemptId, itemId: unit.item.itemId, base: itemBase });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const prepared = prepareRunInvocation(deps, current.value, prompt, {
    attemptId,
    itemId: unit.item.itemId,
    sessionId,
    ...(resume !== undefined ? { resumeSessionId: resume.sessionId } : {}),
    ...(answered !== null ? { answeredDecisionId: answered.decision.decisionId } : {}),
  });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) {
    const blocked = blockRun(ctx, {
      reason: 'budget_exhausted',
      signal: { kind: 'budget', names: [prepared.value.budget] },
      issue: `the ${prepared.value.budget} budget is spent, so the unit was not started`,
      attemptId,
      itemId: unit.item.itemId,
      data: { budget: prepared.value.budget },
    });
    return blocked.ok ? ok(undefined) : blocked;
  }
  // The attempt has started on the answer: the parked delta of the question is no longer needed, so its ref is dropped. A fresh unit does the work again; a
  // resume has the delta back in the tree already (and every road after the host is called, a fallback included, starts from the item's base, not from the
  // ref). The ref must go before the unit can block again, or the next park of the item would meet it. An absent ref is success, so a retry of this attempt
  // drops nothing twice.
  if (answered !== null) {
    const parked = latestParkOf(ctx, unit.item.itemId);
    if (!parked.ok) return parked;
    if (parked.value !== null) {
      const dropped = workspace.dropPark(unit.clone, parked.value.record.ref);
      if (!dropped.ok) return dropped;
    }
  }

  const outcome = await deps.host.invoke(prepared.value.prepared.request, ctx.signal);
  const completed = completeRunInvocation(deps, prepared.value.prepared, outcome);
  // The host's own error comes back unchanged and is judged below; any other failure is the bookkeeping's and stops the stage.
  if (!completed.ok && completed !== outcome) return completed;
  // The lease was lost during the unit: its host was ended and the invocation stays charged, but nothing is classified, discarded or retried under a
  // lease this supervisor no longer holds. The holder that took it over reconciles the attempt on its resume.
  if (ctx.signal.aborted) {
    // The abort was the owner's cancel (plan 03-24; AUT-12), not a lost lease: the attempt ends `cancelled`, nothing is classified, discarded, retried or routed,
    // and the invocation stays charged (it was settled above). The supervisor's loop sees the request and finishes the cancel.
    if (ctx.cancelRequested?.() === true) {
      const ended = deps.ledger.endRunAttempt(attemptId, { outcome: 'cancelled', nowMs: deps.clock.nowMs() });
      return ended.ok || ended.error.kind === 'conflict' ? ok(undefined) : ended;
    }
    return err({ kind: 'conflict', expected: `the run lease held by this supervisor (fence ${ctx.fence})`, actual: 'the run lease was lost during the unit' });
  }

  const classifying = ctx.checkpoint('classify', { attemptId, itemId: unit.item.itemId, revision: snapshot.value.head });
  if (!classifying.ok) return classifying;
  const classifyStarted = deps.clock.nowMs();
  const result = classify(unit, prepared.value.prepared, outcome, snapshot.value);
  if (!result.ok) return result;
  const c = result.value;
  const recorded = recordStep(
    ctx,
    'classify',
    ordinal,
    {
      attemptId,
      kind: c.kind,
      headMoved: c.headMoved,
      resultSeen: c.facts.resultSeen,
      isError: c.facts.isError ?? null,
      exitCode: c.facts.exitCode,
      signal: c.facts.signal,
      timedOut: c.facts.timedOut,
      permissionDenials: c.facts.permissionDenials,
      hookDenies: c.facts.hookDenies,
      hookBudgetDenies: c.facts.hookBudgetDenies,
      headBefore: c.facts.headBefore,
      headAfter: c.facts.headAfter,
      summaryPresent: c.summaryPresent,
      changedPaths: c.changes.length,
      inScopeChanges: c.inScope,
      verification: c.verification.status,
      overrides: c.verification.overrides,
      pruneEntries: c.pruneEntries,
      pauseSignal: c.pauseSignal,
      ...(c.pauseAttribution !== null ? { pauseAttribution: c.pauseAttribution } : {}),
      ...(c.pauseAttribution?.attributedTo != null ? { pauseAttributedTo: c.pauseAttribution.attributedTo } : {}),
      loopLimit: c.loopLimit === null ? null : c.loopLimit.reason,
      ...(c.hostError !== undefined ? { hostError: c.hostError.kind } : {}),
    },
    classifyStarted,
  );
  if (!recorded.ok) return recorded;

  // A unit the hook stopped at a loop limit is routed whatever else it did (CON-14): it is not committed.
  if (c.kind !== 'progressed' || c.loopLimit !== null) return routeOutcome(unit, row, attemptId, c, itemBase, repair !== undefined, resume !== undefined);

  const implemented = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'implemented', nowMs: deps.clock.nowMs(), attemptId });
  if (!implemented.ok) return implemented;
  return gateUnit(unit, row, attemptId);
}

// The repair of a newly failing check, launched: its attempt, the move to delegated and the reproducer step were written by `repairUnit`.
async function launchRepair(unit: Unit, row: RunRow, prepared: PreparedRepair, base: WorkspaceSnapshot): Promise<Result<void>> {
  const pack = await contextPack(unit, row, prepared.ordinal);
  if (!pack.ok) return pack;
  // The owner's answer, when the item asked: the repair is the same work item, and the unit that began it carried the answer.
  const answered = answeredDecisionOf(unit.ctx, unit.item.itemId);
  if (!answered.ok) return answered;
  return launchUnit(unit, row, { attemptId: prepared.attemptId, ordinal: prepared.ordinal, sessionId: prepared.sessionId, pack: pack.value, answered: answered.value, repair: { text: prepared.text, base } });
}

// The routing table of a unit that did not progress: classified kind -> (blocked reason, decision class). The CON-16 discard-and-retry sits
// before the `failed` and `inconclusive` fallbacks, and the loop-limit escalation (CON-14) ahead of the other kinds; a moved HEAD stays first,
// because it is a breach of containment and no recovery may touch a clone whose HEAD the supervisor did not move.
// `snapshot` is the item's base (what a block parks against, and what a unit that crashed is discarded to). A repair is the item's one chance at a check: it
// is never discarded and retried, and every ending that is not a result the gates can judge is a decision.
async function routeOutcome(unit: Unit, row: RunRow, attemptId: string, c: Classified, snapshot: WorkspaceSnapshot, repair = false, resumed = false): Promise<Result<void>> {
  const { ctx } = unit;
  const common = { attemptId, itemId: unit.item.itemId } as const;
  const done = (blocked: Result<RunRow>): Result<void> => (blocked.ok ? ok(undefined) : blocked);
  // An ending about this one item (block reason `decision`) stops the item and the run goes on (blockItem); every other ending is a state of the
  // whole run and stops it (blockRun). The decision policy says which (blockScope); the routing below names the structural signal of each ending.
  // The attempt has ended at an item boundary, so the batched banner is flushed when its window has passed.
  const blockThisItem = async (signal: DecisionSignal, issue: string, data?: Readonly<Record<string, unknown>>): Promise<Result<void>> => {
    // A decision about a repair cites the reproducer the repair was started with.
    let evidenceRefs: string[] = [];
    if (repair) {
      const step = repairStepOf(ctx, attemptId);
      if (step.ok && step.value !== null) evidenceRefs = reproducerRefs(step.value);
    }
    const blocked = blockItem(ctx, { reason: 'decision', signal, issue, ...(data !== undefined ? { data } : {}), ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}), base: snapshot, ...common });
    if (!blocked.ok) return blocked;
    await flushBatch(ctx);
    return ok(undefined);
  };
  const failure = (): DecisionSignal => ({ kind: 'repeated-failure', limit: invocationsLimitOf(ctx) });

  if (c.kind === 'failed' && c.headMoved) {
    return done(
      blockRun(ctx, {
        reason: 'enforcement_failure',
        signal: { kind: 'enforcement', check: 'head-moved' },
        issue: 'the clone HEAD moved during the unit: the supervisor alone commits, so containment did not hold',
        finding: { check: 'head-moved' },
        data: { headBefore: c.facts.headBefore.slice(0, 12), headAfter: c.facts.headAfter.slice(0, 12) },
        ...common,
      }),
    );
  }
  // A budget that ran out denies every call after it, so a long unit reaches the denial limit on the way: the spent budget is the cause and
  // is what the decision names, so `budget_exhausted` is routed before the loop limit.
  if (c.loopLimit !== null && c.kind !== 'budget_exhausted') {
    const what = c.loopLimit.reason === 'consecutive-denials' ? 'consecutive denials' : 'consecutive searches without a read';
    return blockThisItem(failure(), `loop limit: ${c.loopLimit.count} ${what}`, { loopLimit: c.loopLimit.reason, count: c.loopLimit.count, limit: c.loopLimit.limit });
  }
  if (c.kind === 'budget_exhausted') {
    const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
    const spent = budgets.ok ? budgets.value.filter((b) => b.used + b.reserved >= b.limit).map((b) => b.name) : [];
    if (spent.length === 0 && c.facts.subtype === 'error_max_budget_usd') spent.push('costUsd');
    const names = spent.length > 0 ? spent.join(', ') : 'a budget';
    return done(blockRun(ctx, { reason: 'budget_exhausted', signal: { kind: 'budget', names: spent }, issue: `the unit stopped: ${names} is spent`, data: { budgets: names }, ...common }));
  }
  if (c.kind === 'paused') {
    const issue = c.question !== undefined && c.question.trim() !== '' ? c.question : `the unit stopped to ask for a decision (${c.pauseSignal ?? 'pause'})`;
    const signal: DecisionSignal = {
      kind: 'pause',
      ...(c.pauseSignal !== null ? { pauseSignal: c.pauseSignal as PauseSignal } : {}),
      ...(c.question !== undefined ? { question: c.question } : {}),
    };
    return blockThisItem(signal, issue, { signal: c.pauseSignal ?? 'unknown' });
  }
  if (c.kind === 'denied') {
    return blockThisItem({ kind: 'permission' }, `the unit made no in-scope change; the host or the hook denied ${c.facts.permissionDenials + c.facts.hookDenies} call(s)`);
  }
  if (c.kind === 'no_progress') {
    return blockThisItem(failure(), 'the unit ended without a SUMMARY and an in-scope change');
  }

  // failed without a moved HEAD, and inconclusive
  // CON-16: a unit that crashed or was killed by the wall clock (no result, a non-zero exit or a signal), with no moved HEAD and no host refusal,
  // had no effect outside the machine in Phase 2: its clone is put back to the snapshot and the unit is tried once more. A unit that made
  // progress, paused, was denied or made no progress is never retried (FR-4), and neither is a host that refused to launch.
  const crashed = c.kind === 'inconclusive' || (c.kind === 'failed' && (c.facts.exitCode !== 0 || c.facts.signal !== null || !c.facts.resultSeen));
  const hostRefused = c.hostError !== undefined && c.hostError.kind !== 'timeout';
  // A resumed session that the host does not know, or whose unit crashed with no moved HEAD, is not a CON-16 retry of the resume: the parked delta is put
  // back to the item's base and the item runs a fresh unit with the owner's answer (plan 03-22, research Pitfall 4). That unit has its own retry.
  if (resumed && (c.sessionGone || crashed) && !hostRefused) {
    return fallBackToAnswer(unit, row, { attemptId, snapshot, reason: c.sessionGone ? 'session-gone' : 'crashed', spentCheck: true });
  }
  const history = attemptHistoryOf(unit, attemptId, c.kind);
  if (!history.ok) return history;
  const stored = ctx.deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  const retries = stored.value === null ? 0 : (stored.value.body as RunContract).budgets.retry;
  if (crashed && !hostRefused && !repair && history.value.length < 1 + retries) {
    const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
    if (!budgets.ok) return budgets;
    const invocations = budgets.value.find((b) => b.name === 'invocations');
    if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
      return done(
        blockRun(ctx, { reason: 'budget_exhausted', signal: { kind: 'budget', names: ['invocations'] }, issue: `the invocations budget is spent, so the crashed unit (${describeHistory(history.value)}) was not retried`, data: { budget: 'invocations' }, ...common }),
      );
    }
    const ordinal = ordinalOf(ctx, attemptId);
    if (!ordinal.ok) return ordinal;
    const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal: ordinal.value, snapshot });
    if (!discarded.ok) return discarded;
    if (!discarded.value.discarded) return ok(undefined);
    return attemptUnit(unit, row, { retry: true });
  }

  const why =
    c.hostError !== undefined
      ? `the host could not run the unit (${c.hostError.kind})`
      : c.kind === 'inconclusive'
        ? 'the unit ended without a final result or hit the wall clock'
        : 'the unit ended in error (non-zero exit, a signal or an error result)';
  // A host that refused to launch (no sandbox, a failed self-test) is a containment condition, not a model failure.
  const enforcement = c.hostError !== undefined && (c.hostError.kind === 'unavailable' || c.hostError.kind === 'denied');
  // A second failure names every attempt and what each ended as: the retry was the one chance (FR-4).
  const issue = repair ? `the repair of the failing check failed: ${why}` : history.value.length > 1 ? `${why}, again after a discard and retry: ${describeHistory(history.value)}` : why;
  const data = !repair && history.value.length > 1 ? { attempts: history.value.map((a) => a.attemptId).join(','), kinds: history.value.map((a) => a.kind).join(',') } : undefined;
  if (!enforcement) return blockThisItem(failure(), issue, data);
  return done(blockRun(ctx, { reason: 'enforcement_failure', signal: { kind: 'enforcement' }, issue, ...(data !== undefined ? { data } : {}), ...common }));
}

// ---- the resume of an answered item (plan 03-22) ----------------------------------------------------------------------------------------

// Puts the item's parked delta back on top of the current HEAD (AUT-3). The `unpark` checkpoint carries the lease fence, so a stale supervisor stops before it
// writes. `applied` also when the delta is already in the tree (the workspace leaves a path that holds the parked content as it is, so a second call changes
// nothing). A delta that no longer applies because another item committed a change to a parked path is a conflict: nothing was written, the event names the
// number of paths and never the paths, and the caller falls back to a fresh unit.
function unparkDelta(unit: Unit, attemptId: string, base: WorkspaceSnapshot, parked: ParkedItem): Result<'applied' | 'unpark-conflict' | 'park-missing'> {
  const { ctx } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const marked = ctx.checkpoint(UNPARK_CHECKPOINT, { itemId: unit.item.itemId, attemptId, revision: base.head });
  if (!marked.ok) return marked;
  const applied = workspace.unpark(unit.clone, parked.record);
  if (applied.ok) {
    faultPoint('mid-unpark');
    return ok('applied');
  }
  if (applied.error.kind === 'not_found') return ok('park-missing');
  if (applied.error.kind !== 'conflict') return applied;
  const head = workspace.head(unit.clone);
  const moved = head.ok ? workspace.diffCommits(unit.clone, parked.record.baseHead, head.value) : head;
  const parkedPaths = new Set(parked.record.paths);
  const count = moved.ok ? moved.value.filter((change) => parkedPaths.has(change.path)).length : 0;
  const event = deps.ledger.appendEvent({
    type: 'item.unpark_conflict',
    level: 'warn',
    runId: ctx.runId,
    attemptId,
    data: { runId: ctx.runId, itemId: unit.item.itemId, paths: Math.max(1, count) },
    nowMs: deps.clock.nowMs(),
  });
  if (!event.ok) return event;
  return ok('unpark-conflict');
}

// Says that the item gave up on resuming for the decision it answered, once: the next attempt of the item is a fresh unit with the answer (reason `answer`).
function recordResumeFallback(unit: Unit, attemptId: string, ordinal: number, reason: string): Result<void> {
  const { ctx } = unit;
  const answered = answeredDecisionOf(ctx, unit.item.itemId);
  if (!answered.ok) return answered;
  if (answered.value?.fellBack === true) return ok(undefined);
  const recorded = recordStep(ctx, RESUME_FALLBACK_STEP, ordinal, { attemptId, itemId: unit.item.itemId, decisionId: answered.value?.decision.decisionId ?? null, reason }, ctx.deps.clock.nowMs());
  return recorded.ok ? ok(undefined) : recorded;
}

interface Fallback {
  attemptId: string;
  // The item's base snapshot of the resume attempt: the clone goes back to it, which takes the unparked delta out again.
  snapshot: WorkspaceSnapshot;
  reason: 'unpark-conflict' | 'park-missing' | 'session-gone' | 'crashed';
  // The resumed unit was charged: a fresh one needs an invocation left, as the CON-16 retry does, or the owner is told the budget is spent.
  spentCheck: boolean;
}

// The resume could not happen, or crashed: the attempt is discarded to the item's base (which removes the unparked delta) and the item runs a fresh unit
// that carries the owner's answer, from the HEAD it has now. A delta that cannot be applied is dropped with its ref, so nothing of it is ever written over
// another item's change.
async function fallBackToAnswer(unit: Unit, row: RunRow, input: Fallback): Promise<Result<void>> {
  const { ctx } = unit;
  const { deps } = ctx;
  const ordinal = ordinalOf(ctx, input.attemptId);
  if (!ordinal.ok) return ordinal;
  if (input.spentCheck) {
    const budgets = deps.ledger.getBudgets(ctx.runId);
    if (!budgets.ok) return budgets;
    const invocations = budgets.value.find((b) => b.name === 'invocations');
    if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
      const blocked = blockRun(ctx, {
        reason: 'budget_exhausted',
        signal: { kind: 'budget', names: ['invocations'] },
        issue: `the invocations budget is spent, so the resumed session (${input.reason}) was not followed by a fresh unit with the owner's answer`,
        data: { budget: 'invocations' },
        attemptId: input.attemptId,
        itemId: unit.item.itemId,
      });
      return blocked.ok ? ok(undefined) : blocked;
    }
  }
  const recorded = recordResumeFallback(unit, input.attemptId, ordinal.value, input.reason);
  if (!recorded.ok) return recorded;
  if (input.reason === 'unpark-conflict') {
    const dropped = dropItemPark(unit);
    if (!dropped.ok) return dropped;
  }
  const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId: input.attemptId, ordinal: ordinal.value, snapshot: input.snapshot });
  if (!discarded.ok) return discarded;
  if (!discarded.value.discarded) return ok(undefined);
  return attemptUnit(unit, row, { retry: true });
}

// The item is committed, or its resume gave up on the delta: the park ref of the delta goes. An absent ref is success, so this is repeatable.
function dropItemPark(unit: Unit): Result<void> {
  const workspace = unit.ctx.deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const parked = latestParkOf(unit.ctx, unit.item.itemId);
  if (!parked.ok) return parked;
  return parked.value === null ? ok(undefined) : workspace.dropPark(unit.clone, parked.value.record.ref);
}

// The batched banner of decision notices (D-24), delivered at an item boundary when its window has passed. A notification never changes what a run
// does: a failure is said and the run goes on.
async function flushBatch(ctx: RunStageContext): Promise<void> {
  const flushed = await flushDueNotifications(ctx.deps, ctx.runId);
  if (!flushed.ok) ctx.note(`no banner raised at the item boundary: ${flushed.error.kind}`);
}

// The attempts of the run so far, oldest first, each with the kind it was classified as (this attempt's classification is `kind`; an earlier one is
// read from its `classify` step).
interface AttemptKind {
  attemptId: string;
  kind: string;
}

// The attempts that launched a unit: a `launch:run` step names the attempt it served, whatever became of it (`started` when the supervisor died inside it).
function launchedAttempts(ctx: RunStageContext): Result<Set<string>> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const launched = new Set<string>();
  for (const s of steps.value) {
    if (s.step === 'launch:run' && isObject(s.result) && typeof s.result['attemptId'] === 'string') launched.add(s.result['attemptId']);
  }
  return ok(launched);
}

// The run's own count of an attempt (the key of the steps it wrote).
function ordinalOf(ctx: RunStageContext, attemptId: string): Result<number> {
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  return ok(attempts.value.find((a) => a.attemptId === attemptId)?.ordinal ?? 1);
}

// This item's attempts only: its one CON-16 retry is its own, whatever the other items did.
function attemptHistoryOf(unit: Unit, attemptId: string, kind: string): Result<AttemptKind[]> {
  const attempts = unit.ctx.deps.ledger.listRunAttempts(unit.ctx.runId, { itemId: unit.item.itemId });
  if (!attempts.ok) return attempts;
  const launched = launchedAttempts(unit.ctx);
  if (!launched.ok) return launched;
  // An answer starts the item over: the attempts before the last `answer` attempt were about a question the owner has since settled, so the item
  // has its own retry again (the attempt that asked is not a failure of the unit that answers).
  const lastAnswer = attempts.value.map((a) => a.reason).lastIndexOf(ANSWER_REASON);
  const history: AttemptKind[] = [];
  for (const a of lastAnswer > 0 ? attempts.value.slice(lastAnswer) : attempts.value) {
    if (a.attemptId === attemptId) {
      history.push({ attemptId: a.attemptId, kind });
      continue;
    }
    // An attempt whose supervisor died before it launched a unit (a reconcile put it back) ran nothing: it is not a failure of the unit.
    if (!launched.value.has(a.attemptId)) continue;
    // A repair is the one chance of a failing check, never an attempt at the unit (it is not retried, and it does not spend the unit's retry).
    if (a.reason === REPAIR_REASON) continue;
    const classified = stepOfAttempt(unit.ctx, 'classify', a.attemptId);
    if (!classified.ok) return classified;
    history.push({ attemptId: a.attemptId, kind: typeof classified.value?.['kind'] === 'string' ? classified.value['kind'] : 'unknown' });
  }
  return ok(history);
}

const describeHistory = (history: readonly AttemptKind[]): string => history.map((a) => `attempt ${a.attemptId} ended ${a.kind}`).join('; ');

// G2 over the unit's changes (AUT-7): facts AVARICE measured. The required checks run on the working tree only when the unit already
// passes every other rule, so agent-changed code is not run for a unit that is already stopped.
//
// What the unit is judged against is the item's own start (plan 03-19; AUT-16, D-11): the changes since the item's base snapshot (the work of every unit
// of the item, a repair included), the test inventory and the check statuses the item began with (the item committed last, else the pin). A check that
// passed at the start and fails now is charged to this item; one that failed at the start and still fails is pre-existing. A newly failing check, with
// nothing else wrong, is repaired once (repair.ts) before the owner is asked.
async function gateUnit(unit: Unit, row: RunRow, attemptId: string): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const itemBase = itemBaseOf(ctx, unit.item.itemId, attemptId);
  if (!itemBase.ok) return itemBase;
  const snapshot = itemBase.value;
  const itemAttempts = deps.ledger.listRunAttempts(ctx.runId, { itemId: unit.item.itemId });
  if (!itemAttempts.ok) return itemAttempts;
  const attemptRow = itemAttempts.value.find((a) => a.attemptId === attemptId);
  if (attemptRow === undefined) return err({ kind: 'internal', cause: `attempt ${attemptId} is not an attempt of item ${unit.item.itemId} of run ${ctx.runId}` });
  // A repair attempt is judged by G2 as any unit is, against the item's own base, with the repair's own classification.
  const isRepair = attemptRow.reason === REPAIR_REASON;

  // G1 (D-02, D-07): the plan of the unit is judged before anything else is, so a plan that needs more than the contract gives (a path outside the write set, a
  // question it settled itself, a choice that was the owner's) stops the unit here. Its delta is parked and a decision opens; G2 never runs for it.
  const plan = judgePlan(unit, attemptRow);
  if (!plan.ok) return plan;
  if (!plan.value.verdict.passed) {
    const { signal, evidenceRefs } = g1Decision(plan.value.facts, plan.value.verdict);
    const integrity = integrityFailures({ G1: plan.value.verdict }, contract.verification.integrityGates);
    const blocked = blockItem(ctx, {
      reason: 'decision',
      signal,
      issue: `gate G1 failed: ${plan.value.verdict.failures.map((f) => f.detail).join('; ')}`,
      evidenceRefs,
      base: snapshot,
      attemptId,
      itemId: unit.item.itemId,
      data: { gate: 'G1', rules: plan.value.verdict.failures.map((f) => f.rule).join(','), ...(integrity.length > 0 ? { integrity: integrity.join(',') } : {}) },
    });
    if (!blocked.ok) return blocked;
    await flushBatch(ctx);
    return ok(undefined);
  }

  // G3 (AUT-10, D-11): a repair is judged on its own diff before G2 judges the whole item again. Both verdicts are recorded whatever either says, so a repair
  // that fails G3 and G2 leaves both rows; the item's decision names the failures of both. The inventory is measured once, here, and G2 reads it.
  let g3: GateVerdict | null = null;
  let measured: InventoryMeasure | null | undefined;
  if (isRepair) {
    const judged = await judgeRepair(unit, row, attemptRow);
    if (!judged.ok) return judged;
    g3 = judged.value.verdict;
    measured = judged.value.inventory;
  }

  const marked = ctx.checkpoint('gate:g2', { attemptId, itemId: unit.item.itemId, revision: snapshot.head });
  if (!marked.ok) return marked;

  const changed = workspace.changedSince(unit.clone, snapshot);
  if (!changed.ok) return changed;
  const changes = changed.value;
  const classified = stepOfAttempt(ctx, 'classify', attemptId);
  if (!classified.ok) return classified;
  const c = classified.value;
  if (c === null) return err({ kind: 'internal', cause: `attempt ${attemptId} has no classify step` });
  const verification: 'passed' | 'gaps_found' | 'human_needed' | 'missing' =
    c['verification'] === 'passed' || c['verification'] === 'human_needed' || c['verification'] === 'missing' ? c['verification'] : 'gaps_found';

  const facts = {
    outcome: typeof c['kind'] === 'string' ? c['kind'] : 'unknown',
    changes: changes.map((x) => ({ path: x.path, status: x.status })),
    globs: { write: contract.files.write, create: contract.files.create, artifacts: contract.files.artifacts, delete: contract.files.delete, protected: contract.files.protected },
    verification,
    newOverrides: typeof c['overrides'] === 'number' ? c['overrides'] : 0,
    pruneEntries: typeof c['pruneEntries'] === 'number' ? c['pruneEntries'] : 0,
  };
  let inventory: InventoryFailure[] = [];
  let verdict: GateVerdict = evaluateG2({ ...facts, inventory, delta: [] });
  let failingEvidence: string[] = [];
  // The checks that blocked against the item's start, and the runs of the ones that failed (a newly failing check is what a repair is for).
  let blocking: DeltaBlocking[] = [];
  let failingRuns: CheckRunResult[] = [];
  if (verdict.passed) {
    // AUT-9: the inventory after the unit, measured now that the invocation has ended and its process group is gone, against the one measured
    // at the pin. A contract that declares no inventory has nothing to compare. Only a unit that already passes every other rule has its
    // repository's list command run.
    // The item starts from the inventory the item committed last ended with, else from the one measured at the pin (the first item).
    const before = itemStartInventory(ctx, unit.item.itemId);
    if (!before.ok) return before;
    const after: Result<InventoryMeasure | null> = measured !== undefined ? ok(measured) : await measureInventory(deps, row, contract, unit.clone, { phase: 'item', attemptId, contractVersion: unit.contractVersion, itemId: unit.item.itemId });
    if (!after.ok) return after;
    if (after.value !== null) {
      if (before.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} declares a test inventory but none was recorded at base` });
      inventory = compareInventories(before.value.snapshot, after.value.snapshot);
      verdict = evaluateG2({ ...facts, inventory, delta: [] });
    }
  }
  if (verdict.passed) {
    // D-12, AUT-16: the unit is judged against what the checks said when the item began (the G2 result of the item committed last, else what the baseline
    // measured at the pin), not against an assumed green base: a check that failed then and fails now is pre-existing, one that passed then is charged here.
    const start = itemStartStatuses(ctx, unit.item.itemId);
    if (!start.ok) return start;
    const ran = await runRequiredChecks(deps, row, contract, { cwd: unit.clone, attemptId, phase: 'item', contractVersion: unit.contractVersion, itemId: unit.item.itemId, base: start.value });
    if (!ran.ok) return ran;
    const delta = baselineDelta({
      base: start.value,
      head: ran.value.map((r) => ({ name: r.name, status: r.status, evidenceId: r.evidenceId })),
      required: contract.verification.requiredChecks,
      targets: contract.verification.targetChecks,
    });
    verdict = evaluateG2({ ...facts, inventory, delta: delta.blocking });
    blocking = delta.blocking;
    const blockingNames = new Set(delta.blocking.map((b) => b.name));
    failingRuns = ran.value.filter((r) => r.status !== 'passed' && blockingNames.has(r.name));
    failingEvidence = failingRuns.map((r) => r.evidenceId);
  }

  const head = workspace.head(unit.clone);
  if (!head.ok) return head;
  const tree = workspace.snapshot(unit.clone);
  if (!tree.ok) return tree;
  const revision = revisionOf({ head: head.value, clean: false, treeDigest: sha256Hex(`git-tree:${tree.value.tree}`) });
  if (!revision.ok) return revision;
  const gate = deps.ledger.recordGateResult({
    runId: ctx.runId,
    gate: 'G2',
    workItem: unit.item.itemId,
    attemptId,
    contractVersion: unit.contractVersion,
    policyRevision: contract.policyRevision,
    revision: revision.value,
    passed: verdict.passed,
    failures: verdict.failures,
    nowMs: deps.clock.nowMs(),
  });
  if (!gate.ok) return gate;

  const g3Failed = g3 !== null && !g3.passed;
  if (!verdict.passed || g3Failed) {
    const rules = verdict.failures.map((f) => f.rule);
    const g3Rules = g3 !== null && g3Failed ? g3.failures.map((f) => f.rule) : [];
    // A failure of G3 names the gate of each rule; a failure of G2 alone keeps the names it always had.
    const named = g3Failed ? [...g3Rules.map((r) => `G3:${r}`), ...rules.map((r) => `G2:${r}`)] : rules;
    const integrity = integrityFailures({ G2: verdict, ...(g3 !== null ? { G3: g3 } : {}) }, contract.verification.integrityGates);
    const common = { attemptId, itemId: unit.item.itemId, data: { gate: g3Failed ? 'G3' : 'G2', rules: named.join(','), ...(integrity.length > 0 ? { integrity: integrity.join(',') } : {}) } } as const;
    // Only a check that failed (it ran and said so) has an output to reproduce; a check that did not run, or ran inconclusively, has none.
    const checksOnly = rules.length > 0 && rules.every((r) => r === 'checks-delta');
    const failedRuns = checksOnly ? failingRuns.filter((r) => r.status === 'failed') : [];

    // AUT-10, D-11: a check that passed when the item began and fails now, with nothing else wrong, gets one repair unit on the same item before the owner is
    // asked. A check that failed at the start too, one that could not run, a repair that failed G3, and every other failure goes straight to the decision below.
    const newlyFailing = !g3Failed && checksOnly && blocking.length > 0 && blocking.every((b) => b.reason === 'regressed') && failedRuns.length === blocking.length;
    if (newlyFailing) {
      const offered = await offerRepair(unit, row, { attemptId, base: snapshot, failing: failedRuns, evidence: failingEvidence });
      if (offered !== null) return offered;
    }

    const details = [...(g3 !== null && g3Failed ? [`gate G3 failed: ${g3.failures.map((f) => f.detail).join('; ')}`] : []), ...(verdict.passed ? [] : [`gate G2 failed: ${verdict.failures.map((f) => f.detail).join('; ')}`])];
    let issue = details.join(' | ');
    let evidenceRefs = failingEvidence;
    if (failedRuns.length === 0 && isRepair) {
      // A repair that was judged on something other than a failing check (it weakened the test, it added an override) still cites the reproducer it was started with.
      const step = repairStepOf(ctx, attemptId);
      if (!step.ok) return step;
      if (step.value !== null) {
        issue = `${issue} | reproducer: ${reproducerIssue(step.value)} | the check gets one repair, and it failed`;
        evidenceRefs = [...new Set([...failingEvidence, ...reproducerRefs(step.value)])];
      }
    }
    if (failedRuns.length > 0) {
      // The smallest reproducer of the failing checks: in the issue, in the evidence the decision cites, and in a `repair:reproducer` step.
      const inventory = repairInventoryOf(unit);
      if (!inventory.ok) return inventory;
      const set = reproducerFor(ctx, unit.clone, failedRuns, snapshot, inventory.value);
      if (!set.ok) return set;
      const recordedSet = recordReproducerStep(ctx, attemptRow, unit.item.itemId, set.value);
      if (!recordedSet.ok) return recordedSet;
      issue = `${issue} | reproducer: ${reproducerIssue(set.value)}${isRepair ? ' | the check gets one repair, and it failed' : ''}`;
      evidenceRefs = [...new Set([...failingEvidence, ...reproducerRefs(set.value)])];
    }
    // A breach of the write scope is a state of the whole run; any other failure is about this one item, whose delta is parked (blockItem).
    const blocked =
      rules.includes('scope-conformance') || rules.includes('deletion-scope')
        ? blockRun(ctx, {
            reason: 'enforcement_failure',
            signal: { kind: 'enforcement', check: 'scope-of-writes' },
            issue,
            finding: { check: 'scope-of-writes', paths: breaches(changes, contract) },
            ...common,
          })
        : blockItem(ctx, {
            reason: 'decision',
            signal: checksOnly || isRepair ? { kind: 'repeated-failure', limit: invocationsLimitOf(ctx) } : { kind: 'pause' },
            issue,
            evidenceRefs,
            base: snapshot,
            ...common,
          });
    if (!blocked.ok) return blocked;
    await flushBatch(ctx);
    return ok(undefined);
  }

  // A repair can put the work back to the pin: the item then has nothing in scope to commit, which is a decision and never an empty commit.
  if (changes.every((c) => !isInScope(c, contract))) {
    const blocked = blockItem(ctx, {
      reason: 'decision',
      signal: { kind: 'repeated-failure', limit: invocationsLimitOf(ctx) },
      issue: 'every gate passed, but no change of the item is left to commit: the repair undid the work of the unit before it',
      base: snapshot,
      attemptId,
      itemId: unit.item.itemId,
      data: { gate: 'G2', rules: 'nothing-to-commit' },
    });
    if (!blocked.ok) return blocked;
    await flushBatch(ctx);
    return ok(undefined);
  }

  const gated = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'gated', nowMs: deps.clock.nowMs(), attemptId });
  if (!gated.ok) return gated;
  return commitUnit(unit, attemptId, snapshot);
}

// ---- gate G1: the plan of a unit that progressed ----------------------------------------------------------------------------------------------------

const PLAN_READ_BYTES = 64 * 1024;
// The tags a decision G1 opened carries in its evidence references: which owner choices its answer settled, and that a plan checkpoint settles none.
const G1_OWNER_CHOICE_TAG = 'g1:owner-choice:';
const G1_CHECKPOINT_TAG = 'g1:checkpoint';
const G1_SCOPE_TAG = 'g1:scope';

// The quick PLAN of the unit, read from its clone as data (64 KiB, the cut parseQuickPlan applies): every PLAN file the unit wrote, merged into one plan. A
// plan that is absent, or too large to read, is null, which G1 fails closed. `text` is what the spec:plan step reads names from.
function readPlan(unit: Unit, own: WorkspaceSnapshot): Result<{ plan: QuickPlan | null; text: string }> {
  const workspace = unit.ctx.deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const changed = workspace.changedSince(unit.clone, own);
  if (!changed.ok) return changed;
  const paths = changed.value.filter((c) => c.status !== 'deleted' && quickRecordKind(c.path) === 'plan').map((c) => c.path).sort();
  const plans: QuickPlan[] = [];
  const texts: string[] = [];
  for (const path of paths) {
    const read = workspace.readText(unit.clone, path, PLAN_READ_BYTES);
    if (!read.ok) {
      // A plan over the limit is not read at all, and a gate that cannot read the plan does not pass it.
      if (read.error.kind === 'invalid') return ok({ plan: null, text: '' });
      return read;
    }
    if (read.value === null) continue;
    const parsed = parseQuickPlan(read.value);
    if (parsed === null) continue;
    plans.push(parsed);
    texts.push(read.value);
  }
  if (plans.length === 0) return ok({ plan: null, text: '' });
  const union = (lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())];
  return ok({
    plan: {
      filesModified: union(plans.map((p) => p.filesModified)),
      taskFiles: union(plans.map((p) => p.taskFiles)),
      decisionCheckpoints: plans.flatMap((p) => p.decisionCheckpoints),
      acceptanceRefs: union(plans.map((p) => p.acceptanceRefs)),
    },
    text: texts.join('\n'),
  });
}

// The owner choices of the item (D-02): each `decision:<key>` its acceptance criteria name, and whether the owner has been asked. A decision the owner
// answered settles a choice when it is the unit's own question (it carries no tag), or when G1 opened it for exactly that choice; the answer to a decision G1 opened
// for a plan checkpoint settles none.
function ownerChoicesOf(unit: Unit): Result<G1Facts['ownerChoices']> {
  const { ctx, contract } = unit;
  const decisions = ctx.deps.ledger.listDecisions({ runId: ctx.runId, state: 'answered' });
  if (!decisions.ok) return decisions;
  let all = false;
  const settled = new Set<string>();
  for (const d of decisions.value) {
    if (d.affectedItems[0] !== unit.item.itemId || d.class !== 'acceptance') continue;
    const tags = d.evidenceRefs.filter((ref) => ref.startsWith('g1:'));
    if (tags.length === 0) all = true;
    for (const tag of tags) if (tag.startsWith(G1_OWNER_CHOICE_TAG)) settled.add(tag.slice(G1_OWNER_CHOICE_TAG.length));
  }
  const item = contract.intent.workItems.find((i) => i.id === unit.item.itemId);
  const owned = new Set(item?.acceptance ?? contract.intent.acceptance.map((a) => a.id));
  const choices: G1Facts['ownerChoices'][number][] = [];
  for (const criterion of contract.intent.acceptance) {
    if (!owned.has(criterion.id)) continue;
    for (const ref of criterion.verifiedBy) {
      if (!ref.startsWith('decision:')) continue;
      const key = ref.slice('decision:'.length);
      choices.push({ acceptanceId: criterion.id, key, answered: all || settled.has(`${criterion.id}:${key}`) });
    }
  }
  return ok(choices);
}

interface PlanJudgement {
  verdict: GateVerdict;
  facts: G1Facts;
}

// G1 on the plan of a unit that progressed (D-02, D-07 stage 2): the checkpoint, the plan read as data, the item's spec and the contract's globs as the facts,
// the verdict recorded as a G1 row (an advisory beside a passing verdict is stored in it, marked), and what the plan names for the spec fields the item left to
// derivation recorded in a `spec:plan` step (RC-7). The contract is never changed by what a plan says.
function judgePlan(unit: Unit, attempt: AttemptRow): Result<PlanJudgement> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const own = snapshotOf(ctx, attempt.attemptId);
  if (!own.ok) return own;
  const marked = ctx.checkpoint('gate:g1', { attemptId: attempt.attemptId, itemId: unit.item.itemId, revision: own.value.head });
  if (!marked.ok) return marked;

  const classified = stepOfAttempt(ctx, 'classify', attempt.attemptId);
  if (!classified.ok) return classified;
  const read = readPlan(unit, own.value);
  if (!read.ok) return read;
  const choices = ownerChoicesOf(unit);
  if (!choices.ok) return choices;
  const item = contract.intent.workItems.find((i) => i.id === unit.item.itemId);
  const facts: G1Facts = {
    plan: read.value.plan,
    globs: { write: contract.files.write, create: contract.files.create, protected: contract.files.protected },
    // An item the contract does not list (a run stored before items) is judged by the write set alone.
    itemSpec: { files: item?.spec.files ?? [], derived: item?.spec.derived ?? ['files'] },
    outcome: typeof classified.value?.['kind'] === 'string' ? classified.value['kind'] : 'unknown',
    ownerChoices: choices.value,
    itemAcceptance: item?.acceptance ?? contract.intent.acceptance.map((a) => a.id),
  };
  const verdict = evaluateG1(facts);
  const recorded = recordGateRow(unit, attempt.attemptId, 'G1', verdict);
  if (!recorded.ok) return recorded;

  if (read.value.plan !== null && item !== undefined) {
    const named = planNamedSpec(read.value.text, item.spec, [...contract.files.write, ...contract.files.create]);
    const fields = (['symbols', 'configKeys', 'references'] as const).filter((field) => named[field].length > 0);
    if (fields.length > 0) {
      const now = deps.clock.nowMs();
      const step = recordStep(ctx, 'spec:plan', attempt.ordinal, { attemptId: attempt.attemptId, itemId: unit.item.itemId, source: 'plan', derivedFrom: 'plan', fields, symbols: named.symbols, configKeys: named.configKeys, references: named.references }, now);
      if (!step.ok) return step;
    }
  }
  return ok({ verdict, facts });
}

// The signal a failed G1 opens its decision with (D-02, D-07): a plan path outside the contract is a scope_expansion whose amend command names those paths; a plan
// checkpoint the unit resolved is an acceptance decision with the plan's options; an owner choice nobody asked is an acceptance decision that allows free text;
// a plan that cannot be read is a question the owner answers in words. The tags say what the answer settles.
function g1Decision(facts: G1Facts, verdict: GateVerdict): { signal: DecisionSignal; evidenceRefs: string[] } {
  const rules = new Set(verdict.failures.map((f) => f.rule));
  if (rules.has('plan-within-write-scope') || rules.has('plan-within-spec')) {
    return { signal: { kind: 'g1-scope', paths: g1PathBreaches(facts).scope }, evidenceRefs: [G1_SCOPE_TAG] };
  }
  if (rules.has('decision-checkpoint-unresolved')) {
    const open = facts.plan?.decisionCheckpoints.find((c) => !c.hasAutoSelect);
    return { signal: { kind: 'g1-checkpoint', options: (open?.optionIds ?? []).map((id) => ({ id })) }, evidenceRefs: [G1_CHECKPOINT_TAG] };
  }
  if (rules.has('owner-choice-unasked')) {
    const unasked = facts.ownerChoices.filter((c) => !c.answered).sort((a, b) => (a.acceptanceId + a.key < b.acceptanceId + b.key ? -1 : 1));
    const first = unasked[0];
    return {
      signal: first === undefined ? { kind: 'pause' } : { kind: 'g1-owner-choice', acceptanceId: first.acceptanceId, key: first.key },
      evidenceRefs: unasked.map((c) => `${G1_OWNER_CHOICE_TAG}${c.acceptanceId}:${c.key}`),
    };
  }
  return { signal: { kind: 'pause' }, evidenceRefs: [] };
}

// The gate row of G1 or G3: the revision is the clone's HEAD and a digest of its working tree, as G2's is. A finding that did not fail the gate (G1's advisory
// that a plan cites no acceptance ID) is stored beside the failures, each entry marked `advisory`, and never counts against the verdict.
function recordGateRow(unit: Unit, attemptId: string, gate: 'G1' | 'G3', verdict: GateVerdict): Result<void> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const head = workspace.head(unit.clone);
  if (!head.ok) return head;
  const tree = workspace.snapshot(unit.clone);
  if (!tree.ok) return tree;
  const revision = revisionOf({ head: head.value, clean: false, treeDigest: sha256Hex(`git-tree:${tree.value.tree}`) });
  if (!revision.ok) return revision;
  return deps.ledger.recordGateResult({
    runId: ctx.runId,
    gate,
    workItem: unit.item.itemId,
    attemptId,
    contractVersion: unit.contractVersion,
    policyRevision: contract.policyRevision,
    revision: revision.value,
    passed: verdict.passed,
    failures: [...verdict.failures, ...(verdict.advisories ?? []).map((a) => ({ ...a, advisory: true }))],
    nowMs: deps.clock.nowMs(),
  });
}

// Gate G3 on a repair attempt (AUT-10, D-11). The facts are what AVARICE measured: how many repairs the failing checks had before this one, the failing test IDs
// the reproducer named (resolved to the inventory's IDs), the inventory measured on the repaired tree, the files that hold the failing tests, and the paths the
// repair itself changed (since its own snapshot, not the item's base). No amendment can authorize a change to the failing test yet, so the authorized list is empty.
async function judgeRepair(unit: Unit, row: RunRow, attempt: AttemptRow): Promise<Result<{ verdict: GateVerdict; inventory: InventoryMeasure | null }>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const own = snapshotOf(ctx, attempt.attemptId);
  if (!own.ok) return own;
  const marked = ctx.checkpoint('gate:g3', { attemptId: attempt.attemptId, itemId: unit.item.itemId, revision: own.value.head });
  if (!marked.ok) return marked;

  const step = repairStepOf(ctx, attempt.attemptId);
  if (!step.ok) return step;
  const launched = launchedAttempts(ctx);
  if (!launched.ok) return launched;
  const earlier = repairsOf(ctx, unit.item.itemId, launched.value, attempt.attemptId);
  if (!earlier.ok) return earlier;
  const before = Math.max(0, ...(step.value?.repairFor ?? []).map((name) => earlier.value.get(name) ?? 0));
  const inventory = await measureInventory(deps, row, contract, unit.clone, { phase: 'item', attemptId: attempt.attemptId, contractVersion: unit.contractVersion, itemId: unit.item.itemId });
  if (!inventory.ok) return inventory;
  const changed = workspace.changedSince(unit.clone, own.value);
  if (!changed.ok) return changed;

  const verdict = evaluateG3({
    repairAttempts: before,
    limit: contract.budgets.repairAttemptsPerCheck,
    failingTests: step.value?.failingTestIds ?? [],
    inventoryAfter: inventory.value?.snapshot.ids ?? [],
    testFilesOfFailing: step.value?.testFiles ?? [],
    changes: changed.value.map((c) => ({ path: c.path, status: c.status })),
    authorizedTestPaths: [],
  });
  const recorded = recordGateRow(unit, attempt.attemptId, 'G3', verdict);
  if (!recorded.ok) return recorded;
  return ok({ verdict, inventory: inventory.value });
}

// The test IDs a repair's failing test names are resolved against (the inventory the item began with and the one its first unit left) and the globs of the
// test files: what gate G3 reads. Empty when the contract declares no inventory, and then there is nothing G3 can judge but the repair limit.
function repairInventoryOf(unit: Unit): Result<{ ids: string[]; globs: string[] }> {
  const { ctx, contract } = unit;
  const globs = contract.verification.testInventory?.globs ?? [];
  if (contract.verification.testInventory === null) return ok({ ids: [], globs: [] });
  const started = itemStartInventory(ctx, unit.item.itemId);
  if (!started.ok) return started;
  const latest = recordedInventory(ctx.deps, ctx.runId, 'item', { workItem: unit.item.itemId });
  if (!latest.ok) return latest;
  return ok({ ids: [...new Set([...(started.value?.snapshot.ids ?? []), ...(latest.value?.snapshot.ids ?? [])])], globs: [...globs] });
}

// One repair of the checks that newly failed, when each has had fewer repairs than the contract allows and the invocations budget has room for the unit.
// Null when no repair is offered (the limit is reached): the failure becomes a decision. A spent budget is a decision of its own, naming the budget.
async function offerRepair(unit: Unit, row: RunRow, input: { attemptId: string; base: WorkspaceSnapshot; failing: CheckRunResult[]; evidence: string[] }): Promise<Result<void> | null> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const launched = launchedAttempts(ctx);
  if (!launched.ok) return launched;
  const used = repairsOf(ctx, unit.item.itemId, launched.value);
  if (!used.ok) return used;
  const limit = contract.budgets.repairAttemptsPerCheck;
  if (!input.failing.every((f) => (used.value.get(f.name) ?? 0) < limit)) return null;

  const budgets = deps.ledger.getBudgets(ctx.runId);
  if (!budgets.ok) return budgets;
  const invocations = budgets.value.find((b) => b.name === 'invocations');
  if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
    const names = input.failing.map((f) => f.name).sort().join(', ');
    const blocked = blockRun(ctx, {
      reason: 'budget_exhausted',
      signal: { kind: 'budget', names: ['invocations'] },
      issue: `the invocations budget is spent, so the repair of the failing check (${names}) was not started`,
      evidenceRefs: input.evidence,
      data: { budget: 'invocations' },
      attemptId: input.attemptId,
      itemId: unit.item.itemId,
    });
    return blocked.ok ? ok(undefined) : blocked;
  }

  const inventory = repairInventoryOf(unit);
  if (!inventory.ok) return inventory;
  const prepared = repairUnit(ctx, { clone: unit.clone, itemId: unit.item.itemId, failedAttemptId: input.attemptId, base: input.base, failing: input.failing, inventory: inventory.value });
  if (!prepared.ok) return prepared;
  return launchRepair(unit, row, prepared.value, input.base);
}

// Archives the GSD records and takes them, and the GSD bookkeeping files, out of the clone (D-17), then commits the in-scope paths.
async function commitUnit(unit: Unit, attemptId: string, snapshot: WorkspaceSnapshot): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const marked = ctx.checkpoint('commit', { attemptId, itemId: unit.item.itemId, revision: snapshot.head });
  if (!marked.ok) return marked;
  const startedMs = deps.clock.nowMs();

  const changed = workspace.changedSince(unit.clone, snapshot);
  if (!changed.ok) return changed;
  const artifactChanges = changed.value.filter((x) => matchesAny(x.path, contract.files.artifacts));

  // Archive first: the records are the only copy of what the unit wrote about itself.
  let archived = 0;
  for (const change of artifactChanges) {
    if (change.status === 'deleted') continue;
    const text = workspace.readText(unit.clone, change.path, ARCHIVE_MAX_BYTES);
    if (!text.ok) return text;
    if (text.value === null) continue;
    const stored = deps.artifacts.put(new TextEncoder().encode(text.value), { kind: QUICK_RECORD_KIND, runId: ctx.runId });
    if (!stored.ok) return stored;
    const recorded = deps.ledger.recordArtifact({ digest: stored.value.digest, size: stored.value.size, kind: QUICK_RECORD_KIND, runId: ctx.runId, retention: RUN_RETENTION, store: STORE, nowMs: deps.clock.nowMs() });
    if (!recorded.ok) return recorded;
    archived += 1;
  }

  // Take every artifact path out of the clone: the unit's records and any GSD bookkeeping (`.planning/STATE.md`, `.planning/config.json`)
  // go back to HEAD, or are removed when HEAD does not have them. What the clone keeps is the in-scope change and nothing else.
  const status = workspace.status(unit.clone);
  if (!status.ok) return status;
  const leftovers = status.value.filter((x) => matchesAny(x.path, contract.files.artifacts));
  const restore = leftovers.filter((x) => x.status !== 'added').map((x) => x.path);
  const remove = leftovers.filter((x) => x.status === 'added').map((x) => x.path);
  if (restore.length > 0) {
    const done = workspace.restorePaths(unit.clone, restore);
    if (!done.ok) return done;
  }
  if (remove.length > 0) {
    const done = workspace.removeUntracked(unit.clone, remove);
    if (!done.ok) return done;
  }

  const remaining = workspace.changedSince(unit.clone, snapshot);
  if (!remaining.ok) return remaining;
  const paths = remaining.value.filter((x) => isInScope(x, contract)).map((x) => x.path);
  const strays = remaining.value.filter((x) => !isInScope(x, contract) && !matchesAny(x.path, contract.files.artifacts));
  if (strays.length > 0) return err({ kind: 'internal', cause: `G2 passed but ${strays.length} changed path(s) are outside the commit set: ${strays.slice(0, 3).map((x) => x.path).join(', ')}` });

  // The subject is the item's own title (AUT-16); a brief without items has one item A whose title is the brief's.
  const itemTitle = contract.intent.workItems.find((i) => i.id === unit.item.itemId)?.task ?? contract.intent.title;
  const subject = storedText(itemTitle, 200).replace(/\s+/g, ' ').trim().slice(0, 72);
  const commit = workspace.commit(unit.clone, {
    paths,
    message: subject === '' ? 'AVARICE run change' : subject,
    trailers: [`Avarice-Run: ${ctx.runId}`, `Avarice-Attempt: ${attemptId}`],
  });
  if (!commit.ok) return commit;
  faultPoint('mid-commit');

  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const ordinal = attempts.value.find((a) => a.attemptId === attemptId)?.ordinal ?? 1;
  const recorded = recordStep(ctx, 'commit', ordinal, { attemptId, commit: commit.value, paths: paths.length, archived, artifactsRemoved: restore.length + remove.length }, startedMs);
  if (!recorded.ok) return recorded;

  const done = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'done', nowMs: deps.clock.nowMs(), attemptId, data: { commit: commit.value.slice(0, 12) } });
  if (!done.ok) return done;
  // The item's work is committed: a delta that was parked for its question (and put back for its resume) has no use left, so its ref goes.
  const unparked = dropItemPark(unit);
  if (!unparked.ok) return unparked;
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;

  // The next step is the scheduler's: another item to start (the run moves running -> running, its next action the item's pack), or verification
  // when every item is committed. An item's attempt ends with its commit unless it is the last one: the last attempt ends with the hand-off.
  const next = schedule(ctx);
  if (!next.ok) return next;
  const after = next.value.disposition;
  if (after.kind === 'all-done') {
    const moved = ctx.transition(current.value, 'verifying', 'verify:checks', { attemptId, itemId: unit.item.itemId, revision: `git:${commit.value}` });
    return moved.ok ? ok(undefined) : moved;
  }
  const ended = deps.ledger.endRunAttempt(attemptId, { outcome: 'committed', nowMs: deps.clock.nowMs() });
  if (!ended.ok && ended.error.kind !== 'conflict') return ended;
  // The item boundary: the batched banner of the decisions queued so far goes out when its window has passed, before the next item starts (D-24).
  await flushBatch(ctx);
  // The next item to start (the run moves running -> running), or, with no item ready, the wait on the open decisions (blocked_on_decision) or the end
  // of a run that can deliver nothing more (failed): a decision that is open keeps its item and the items that depend on it out of the run.
  const moved = moveOn(ctx, current.value, after, { itemId: unit.item.itemId, revision: `git:${commit.value}` });
  return moved.ok ? ok(undefined) : moved;
}
