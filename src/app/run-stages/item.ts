// Stage for `running` (plan 02-13; FR-2, FR-4, FR-6, AUT-7, RC-4, CON-2, OPS-2, D-03, D-17): one GSD unit (`/gsd-quick --validate --text`) per
// item attempt, judged by AVARICE from facts it measured, and committed by the supervisor.
//
//   context-pack  an index-first pack (intel, then graph) for the prompt; the step keeps item references and a digest, never text (S-41)
//   launch:run    attempt, item ready -> delegated, a snapshot of the clone, one contained invocation of the unit
//   classify      resultSeen, is_error, exit, signal, timeout, denials, clone HEAD before and after, a quick SUMMARY, in-scope changes since the
//                 snapshot, a structural pause signal, a hook loop-limit stop; model text decides nothing (AUT-7). Anything but `progressed` ends in a
//                 decision, except a crashed or timed-out unit with no moved HEAD: it is discarded to its snapshot and retried once (CON-16)
//   discard-attempt  the CON-16 recovery (discard.ts), then the retry attempt goes straight on to `launch:run`
//   gate:g2       scope, deletions, GSD verification status, overrides, PRUNE entries, and the required checks on the working tree
//   commit        quick records and GSD bookkeeping archived and taken out of the clone, then the supervisor commits only the in-scope paths
//                 with `Avarice-Run` and `Avarice-Attempt` trailers; the run moves to `verifying`
//
// The GSD records of the unit (`.planning/quick/**`, `.planning/STATE.md`) are artifacts (D-17): they never reach the review branch.
// The host's own outcome `kind` is not read here (spike S2-B: both live rounds ended `denied` on improvised shell lines, with the unit done).
import { digestOf, sha256Hex } from '../../domain/digest.ts';
import { baselineDelta, revisionOf } from '../../domain/evidence.ts';
import { evaluateG2 } from '../../domain/gates.ts';
import type { GateVerdict } from '../../domain/gates.ts';
import { matchesAny } from '../../domain/glob.ts';
import { classifyOutcome, detectPause } from '../../domain/outcome.ts';
import type { ClassifiedKind, OutcomeFacts } from '../../domain/outcome.ts';
import { countPruneEntries, parseQuickVerification, quickRecordKind, storedText } from '../../domain/quick-record.ts';
import type { QuickVerification } from '../../domain/quick-record.ts';
import { err, ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import { compareInventories } from '../../domain/test-inventory.ts';
import type { InventoryFailure } from '../../domain/test-inventory.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import type { InvocationOutcome } from '../../ports/agent-host.ts';
import type { AttemptRow, RunRow, WorkItemRow } from '../../ports/ledger.ts';
import type { PathChange, WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { measureInventory, recordedBase, recordedInventory, runRequiredChecks } from '../checks.ts';
import { queryContext } from '../context.ts';
import { completeRunInvocation, prepareRunInvocation } from '../invocation.ts';
import { faultPoint } from '../onboarding-service.ts';
import { runUnitPrompt } from '../run-gsd-config.ts';
import { blockRun } from './blocked.ts';
import { discardAttempt } from './discard.ts';
import type { RunStage, RunStageContext } from './stage.ts';

const RECORD_MAX_BYTES = 64 * 1024;
const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;
const PACK_BUDGET = 4000;
const MAX_IGNORED_STORED = 200;
const STORE = 'local';
const RUN_RETENTION = 'run';
const QUICK_RECORD_KIND = 'gsd-quick-record';
// The reason of the attempt that follows a discard (CON-16).
const RETRY_REASON = 'con16-retry';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Everything one pass of the stage needs, read once.
interface Unit {
  ctx: RunStageContext;
  contract: RunContract;
  contractVersion: number;
  clone: string;
  item: WorkItemRow;
}

function loadUnit(ctx: RunStageContext, row: RunRow): Result<Unit> {
  const stored = ctx.deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  if (row.workspacePath === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
  const items = ctx.deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  if (items.value.length !== 1) return err({ kind: 'internal', cause: `run ${ctx.runId} has ${items.value.length} work items; a Phase 2 run has exactly one` });
  return ok({ ctx, contract: stored.value.body as RunContract, contractVersion: stored.value.version, clone: row.workspacePath, item: items.value[0] as WorkItemRow });
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

function latestAttempt(ctx: RunStageContext): Result<AttemptRow | null> {
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  return ok(attempts.value.at(-1) ?? null);
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
  // The pause text the host captured, stored as data by the decision.
  question: string | undefined;
  hostError: PortError | undefined;
  // The hook stopped this invocation at a loop limit (CON-14): `loop.limit` event for it.
  loopLimit: { reason: string; count: number; limit: number } | null;
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
    pauseSignal: pause.signal,
    question,
    hostError: outcome.ok ? undefined : outcome.error,
    loopLimit: loopLimit.value,
  });
}

// ---- the stage ---------------------------------------------------------------------------------------

export const runningStage: RunStage = async (ctx, row) => {
  const loaded = loadUnit(ctx, row);
  if (!loaded.ok) return loaded;
  const unit = loaded.value;
  switch (unit.item.state) {
    case 'ready':
      return attemptUnit(unit, row);
    case 'implemented': {
      const attempt = latestAttempt(ctx);
      if (!attempt.ok) return attempt;
      if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is implemented but run ${ctx.runId} has no attempt` });
      const snapshot = snapshotOf(ctx, attempt.value.attemptId);
      if (!snapshot.ok) return snapshot;
      return gateUnit(unit, row, attempt.value.attemptId, snapshot.value);
    }
    case 'gated': {
      const attempt = latestAttempt(ctx);
      if (!attempt.ok) return attempt;
      if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is gated but run ${ctx.runId} has no attempt` });
      const snapshot = snapshotOf(ctx, attempt.value.attemptId);
      if (!snapshot.ok) return snapshot;
      return commitUnit(unit, attempt.value.attemptId, snapshot.value);
    }
    case 'done': {
      const attempt = latestAttempt(ctx);
      if (!attempt.ok) return attempt;
      const head = ctx.deps.runWorkspace?.head(unit.clone);
      if (head === undefined || !head.ok) return head ?? err({ kind: 'internal', cause: 'the run workspace is not composed' });
      const moved = ctx.transition(row, 'verifying', 'verify:checks', { ...(attempt.value !== null ? { attemptId: attempt.value.attemptId } : {}), itemId: unit.item.itemId, revision: `git:${head.value}` });
      return moved.ok ? ok(undefined) : moved;
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
export function reconcileItem(ctx: RunStageContext, row: RunRow): Result<ItemReconcile> {
  const loaded = loadUnit(ctx, row);
  if (!loaded.ok) return loaded;
  const unit = loaded.value;
  if (unit.item.state === 'delegated') return reconcileDelegated(unit);
  if (unit.item.state === 'gated') return reconcileGated(unit);
  return ok('none');
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
  const attempt = latestAttempt(ctx);
  if (!attempt.ok) return attempt;
  if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is delegated but run ${ctx.runId} has no attempt` });
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
    const moved = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'ready', nowMs: deps.clock.nowMs(), attemptId, data: { reconciled: true } });
    return moved.ok ? ok('retry') : moved;
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
      decisionClass: 'permission',
      issue: 'the clone HEAD moved while the unit was in flight: the supervisor alone commits, so containment did not hold',
      finding: { check: 'head-moved' },
      data: { headBefore: snapshot.value.head.slice(0, 12), headAfter: head.value.slice(0, 12) },
      ...common,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }

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
    const blocked = blockRun(ctx, {
      reason: 'decision',
      decisionClass: 'repeated_failure',
      issue: `the unit was interrupted, again after a discard and retry: ${describeHistory(history.value)}`,
      data: { attempts: history.value.map((a) => a.attemptId).join(','), kinds: history.value.map((a) => a.kind).join(',') },
      ...common,
    });
    return blocked.ok ? ok('blocked') : blocked;
  }
  const budgets = deps.ledger.getBudgets(ctx.runId);
  if (!budgets.ok) return budgets;
  const invocations = budgets.value.find((b) => b.name === 'invocations');
  // The killed invocation's reservation counts here: it is spent by the next reservation, so the retry needs a unit beyond it.
  if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
    const blocked = blockRun(ctx, { reason: 'budget_exhausted', decisionClass: 'permission', issue: `the invocations budget is spent, so the interrupted unit (${describeHistory(history.value)}) was not retried`, data: { budget: 'invocations' }, ...common });
    return blocked.ok ? ok('blocked') : blocked;
  }

  const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal, snapshot: snapshot.value });
  if (!discarded.ok) return discarded;
  return ok(discarded.value.discarded ? 'retry' : 'blocked');
}

// An item that passed its gate (`gated`): the supervisor may have made its commit and died before it recorded it. A HEAD that moved is the item's own
// commit only when its message carries this run's ID and the open attempt's ID in its `Avarice-*` trailers (the supervisor writes both); then the
// `commit` step is recorded with it, the item is done, and no second commit is made. Any other commit on the clone is not ours.
function reconcileGated(unit: Unit): Result<ItemReconcile> {
  const { ctx } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const attempt = latestAttempt(ctx);
  if (!attempt.ok) return attempt;
  if (attempt.value === null) return err({ kind: 'internal', cause: `item ${unit.item.itemId} is gated but run ${ctx.runId} has no attempt` });
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
      decisionClass: 'permission',
      issue: 'the clone HEAD moved to a commit the supervisor did not make for this attempt (its Avarice-Run and Avarice-Attempt trailers do not name it): containment did not hold',
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
  return done.ok ? ok('committed') : done;
}

function snapshotOf(ctx: RunStageContext, attemptId: string): Result<WorkspaceSnapshot> {
  const step = stepOfAttempt(ctx, 'snapshot', attemptId);
  if (!step.ok) return step;
  const r = step.value;
  if (r === null || typeof r['head'] !== 'string' || typeof r['tree'] !== 'string') return err({ kind: 'internal', cause: `attempt ${attemptId} has no snapshot step` });
  return ok({ head: r['head'], tree: r['tree'], ignored: Array.isArray(r['ignored']) ? r['ignored'].filter((x): x is string => typeof x === 'string') : [] });
}

// item ready -> delegated -> (launch, classify) -> implemented -> (G2) -> gated -> (commit) -> done
async function attemptUnit(unit: Unit, row: RunRow, options: { retry?: boolean } = {}): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  // The baseline opened the first attempt (the evidence of a check names an attempt); the unit adopts it while it has not started. Any
  // other attempt (a retry) is opened here.
  const last = attempts.value.at(-1);
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

  const attempt = adopted !== undefined ? ok(adopted) : deps.ledger.recordRunAttempt(ctx.runId, { reason: ordinal === 1 ? 'initial' : RETRY_REASON, nowMs: deps.clock.nowMs() });
  if (!attempt.ok) return attempt;
  const attemptId = attempt.value.attemptId;
  const delegated = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'delegated', nowMs: deps.clock.nowMs(), attemptId });
  if (!delegated.ok) return delegated;

  // The clone as it is right before the unit runs: the configure step's `.planning/config.json` is in it, so only what the unit changes counts.
  const startedMs = deps.clock.nowMs();
  const snapshot = workspace.snapshot(unit.clone);
  if (!snapshot.ok) return snapshot;
  const snapped = recordStep(ctx, 'snapshot', ordinal, { attemptId, head: snapshot.value.head, tree: snapshot.value.tree, ignored: snapshot.value.ignored.slice(0, MAX_IGNORED_STORED), ignoredCount: snapshot.value.ignored.length }, startedMs);
  if (!snapped.ok) return snapped;

  const launching = ctx.checkpoint('launch:run', { attemptId, itemId: unit.item.itemId, revision: snapshot.value.head });
  if (!launching.ok) return launching;

  let prompt: string;
  try {
    prompt = runUnitPrompt(contract, pack.value);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    const blocked = blockRun(ctx, { reason: 'decision', decisionClass: 'acceptance', issue: `the brief is too long for the unit prompt: ${cause.message}`, attemptId, itemId: unit.item.itemId });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const prepared = prepareRunInvocation(deps, current.value, prompt, { attemptId, itemId: unit.item.itemId });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) {
    const blocked = blockRun(ctx, { reason: 'budget_exhausted', decisionClass: 'permission', issue: `the ${prepared.value.budget} budget is spent, so the unit was not started`, attemptId, itemId: unit.item.itemId, data: { budget: prepared.value.budget } });
    return blocked.ok ? ok(undefined) : blocked;
  }

  const outcome = await deps.host.invoke(prepared.value.prepared.request, ctx.signal);
  const completed = completeRunInvocation(deps, prepared.value.prepared, outcome);
  // The host's own error comes back unchanged and is judged below; any other failure is the bookkeeping's and stops the stage.
  if (!completed.ok && completed !== outcome) return completed;
  // The lease was lost during the unit: its host was ended and the invocation stays charged, but nothing is classified, discarded or retried under a
  // lease this supervisor no longer holds. The holder that took it over reconciles the attempt on its resume.
  if (ctx.signal.aborted) return err({ kind: 'conflict', expected: `the run lease held by this supervisor (fence ${ctx.fence})`, actual: 'the run lease was lost during the unit' });

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
      loopLimit: c.loopLimit === null ? null : c.loopLimit.reason,
      ...(c.hostError !== undefined ? { hostError: c.hostError.kind } : {}),
    },
    classifyStarted,
  );
  if (!recorded.ok) return recorded;

  // A unit the hook stopped at a loop limit is routed whatever else it did (CON-14): it is not committed.
  if (c.kind !== 'progressed' || c.loopLimit !== null) return routeOutcome(unit, row, attemptId, c, snapshot.value);

  const implemented = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'implemented', nowMs: deps.clock.nowMs(), attemptId });
  if (!implemented.ok) return implemented;
  return gateUnit(unit, row, attemptId, snapshot.value);
}

// The routing table of a unit that did not progress: classified kind -> (blocked reason, decision class). The CON-16 discard-and-retry sits
// before the `failed` and `inconclusive` fallbacks, and the loop-limit escalation (CON-14) ahead of the other kinds; a moved HEAD stays first,
// because it is a breach of containment and no recovery may touch a clone whose HEAD the supervisor did not move.
async function routeOutcome(unit: Unit, row: RunRow, attemptId: string, c: Classified, snapshot: WorkspaceSnapshot): Promise<Result<void>> {
  const { ctx } = unit;
  const common = { attemptId, itemId: unit.item.itemId } as const;
  const done = (blocked: Result<RunRow>): Result<void> => (blocked.ok ? ok(undefined) : blocked);

  if (c.kind === 'failed' && c.headMoved) {
    return done(
      blockRun(ctx, {
        reason: 'enforcement_failure',
        decisionClass: 'permission',
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
    return done(blockRun(ctx, { reason: 'decision', decisionClass: 'repeated_failure', issue: `loop limit: ${c.loopLimit.count} ${what}`, data: { loopLimit: c.loopLimit.reason, count: c.loopLimit.count, limit: c.loopLimit.limit }, ...common }));
  }
  if (c.kind === 'budget_exhausted') {
    const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
    const spent = budgets.ok ? budgets.value.filter((b) => b.used + b.reserved >= b.limit).map((b) => b.name) : [];
    if (spent.length === 0 && c.facts.subtype === 'error_max_budget_usd') spent.push('costUsd');
    const names = spent.length > 0 ? spent.join(', ') : 'a budget';
    return done(blockRun(ctx, { reason: 'budget_exhausted', decisionClass: 'permission', issue: `the unit stopped: ${names} is spent`, data: { budgets: names }, ...common }));
  }
  if (c.kind === 'paused') {
    const issue = c.question !== undefined && c.question.trim() !== '' ? c.question : `the unit stopped to ask for a decision (${c.pauseSignal ?? 'pause'})`;
    return done(blockRun(ctx, { reason: 'decision', decisionClass: 'acceptance', issue, data: { signal: c.pauseSignal ?? 'unknown' }, ...common }));
  }
  if (c.kind === 'denied') {
    return done(blockRun(ctx, { reason: 'decision', decisionClass: 'permission', issue: `the unit made no in-scope change; the host or the hook denied ${c.facts.permissionDenials + c.facts.hookDenies} call(s)`, ...common }));
  }
  if (c.kind === 'no_progress') {
    return done(blockRun(ctx, { reason: 'decision', decisionClass: 'repeated_failure', issue: 'the unit ended without a SUMMARY and an in-scope change', ...common }));
  }

  // failed without a moved HEAD, and inconclusive
  // CON-16: a unit that crashed or was killed by the wall clock (no result, a non-zero exit or a signal), with no moved HEAD and no host refusal,
  // had no effect outside the machine in Phase 2: its clone is put back to the snapshot and the unit is tried once more. A unit that made
  // progress, paused, was denied or made no progress is never retried (FR-4), and neither is a host that refused to launch.
  const crashed = c.kind === 'inconclusive' || (c.kind === 'failed' && (c.facts.exitCode !== 0 || c.facts.signal !== null || !c.facts.resultSeen));
  const hostRefused = c.hostError !== undefined && c.hostError.kind !== 'timeout';
  const history = attemptHistoryOf(unit, attemptId, c.kind);
  if (!history.ok) return history;
  const stored = ctx.deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  const retries = stored.value === null ? 0 : (stored.value.body as RunContract).budgets.retry;
  if (crashed && !hostRefused && history.value.length < 1 + retries) {
    const budgets = ctx.deps.ledger.getBudgets(ctx.runId);
    if (!budgets.ok) return budgets;
    const invocations = budgets.value.find((b) => b.name === 'invocations');
    if (invocations !== undefined && invocations.used + invocations.reserved + 1 > invocations.limit) {
      return done(
        blockRun(ctx, { reason: 'budget_exhausted', decisionClass: 'permission', issue: `the invocations budget is spent, so the crashed unit (${describeHistory(history.value)}) was not retried`, data: { budget: 'invocations' }, ...common }),
      );
    }
    const discarded = discardAttempt(ctx, { clone: unit.clone, itemId: unit.item.itemId, attemptId, ordinal: history.value.length, snapshot });
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
  const issue = history.value.length > 1 ? `${why}, again after a discard and retry: ${describeHistory(history.value)}` : why;
  return done(
    blockRun(ctx, {
      reason: enforcement ? 'enforcement_failure' : 'decision',
      decisionClass: enforcement ? 'permission' : 'repeated_failure',
      issue,
      ...(history.value.length > 1 ? { data: { attempts: history.value.map((a) => a.attemptId).join(','), kinds: history.value.map((a) => a.kind).join(',') } } : {}),
      ...common,
    }),
  );
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

function attemptHistoryOf(unit: Unit, attemptId: string, kind: string): Result<AttemptKind[]> {
  const attempts = unit.ctx.deps.ledger.listRunAttempts(unit.ctx.runId);
  if (!attempts.ok) return attempts;
  const launched = launchedAttempts(unit.ctx);
  if (!launched.ok) return launched;
  const history: AttemptKind[] = [];
  for (const a of attempts.value) {
    if (a.attemptId === attemptId) {
      history.push({ attemptId: a.attemptId, kind });
      continue;
    }
    // An attempt whose supervisor died before it launched a unit (a reconcile put it back) ran nothing: it is not a failure of the unit.
    if (!launched.value.has(a.attemptId)) continue;
    const classified = stepOfAttempt(unit.ctx, 'classify', a.attemptId);
    if (!classified.ok) return classified;
    history.push({ attemptId: a.attemptId, kind: typeof classified.value?.['kind'] === 'string' ? classified.value['kind'] : 'unknown' });
  }
  return ok(history);
}

const describeHistory = (history: readonly AttemptKind[]): string => history.map((a) => `attempt ${a.attemptId} ended ${a.kind}`).join('; ');

// G2 over the unit's changes (AUT-7): facts AVARICE measured. The required checks run on the working tree only when the unit already
// passes every other rule, so agent-changed code is not run for a unit that is already stopped.
async function gateUnit(unit: Unit, row: RunRow, attemptId: string, snapshot: WorkspaceSnapshot): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

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
  if (verdict.passed) {
    // AUT-9: the inventory after the unit, measured now that the invocation has ended and its process group is gone, against the one measured
    // at the pin. A contract that declares no inventory has nothing to compare. Only a unit that already passes every other rule has its
    // repository's list command run.
    const before = recordedInventory(deps, ctx.runId, 'base');
    if (!before.ok) return before;
    const after = await measureInventory(deps, row, contract, unit.clone, { phase: 'item', attemptId, contractVersion: unit.contractVersion, itemId: unit.item.itemId });
    if (!after.ok) return after;
    if (after.value !== null) {
      if (before.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} declares a test inventory but none was recorded at base` });
      inventory = compareInventories(before.value.snapshot, after.value.snapshot);
      verdict = evaluateG2({ ...facts, inventory, delta: [] });
    }
  }
  if (verdict.passed) {
    // D-12: the unit is judged against what the checks did at the pin, measured by the baseline action, not against an assumed green base.
    const base = recordedBase(deps, ctx.runId);
    if (!base.ok) return base;
    const ran = await runRequiredChecks(deps, row, contract, { cwd: unit.clone, attemptId, phase: 'item', contractVersion: unit.contractVersion, itemId: unit.item.itemId, base: base.value });
    if (!ran.ok) return ran;
    const delta = baselineDelta({
      base: base.value,
      head: ran.value.map((r) => ({ name: r.name, status: r.status, evidenceId: r.evidenceId })),
      required: contract.verification.requiredChecks,
      targets: contract.verification.targetChecks,
    });
    verdict = evaluateG2({ ...facts, inventory, delta: delta.blocking });
    const blockingNames = new Set(delta.blocking.map((b) => b.name));
    failingEvidence = ran.value.filter((r) => r.status !== 'passed' && blockingNames.has(r.name)).map((r) => r.evidenceId);
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

  if (!verdict.passed) {
    const rules = verdict.failures.map((f) => f.rule);
    const common = { attemptId, itemId: unit.item.itemId, data: { gate: 'G2', rules: rules.join(',') } } as const;
    const blocked =
      rules.includes('scope-conformance') || rules.includes('deletion-scope')
        ? blockRun(ctx, {
            reason: 'enforcement_failure',
            decisionClass: 'permission',
            issue: `gate G2 failed: ${verdict.failures.map((f) => f.detail).join('; ')}`,
            finding: { check: 'scope-of-writes', paths: breaches(changes, contract) },
            ...common,
          })
        : rules.every((r) => r === 'checks-delta')
          ? blockRun(ctx, { reason: 'decision', decisionClass: 'repeated_failure', issue: `gate G2 failed: ${verdict.failures.map((f) => f.detail).join('; ')}`, evidenceRefs: failingEvidence, ...common })
          : blockRun(ctx, { reason: 'decision', decisionClass: 'acceptance', issue: `gate G2 failed: ${verdict.failures.map((f) => f.detail).join('; ')}`, evidenceRefs: failingEvidence, ...common });
    return blocked.ok ? ok(undefined) : blocked;
  }

  const gated = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'gated', nowMs: deps.clock.nowMs(), attemptId });
  if (!gated.ok) return gated;
  return commitUnit(unit, attemptId, snapshot);
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

  const subject = storedText(contract.intent.title, 200).replace(/\s+/g, ' ').trim().slice(0, 72);
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
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const moved = ctx.transition(current.value, 'verifying', 'verify:checks', { attemptId, itemId: unit.item.itemId, revision: `git:${commit.value}` });
  return moved.ok ? ok(undefined) : moved;
}
