// Stage for `running` (plan 02-13; FR-2, FR-4, FR-6, AUT-7, RC-4, CON-2, OPS-2, D-03, D-17): one GSD unit (`/gsd-quick --validate --text`) per
// item attempt, judged by AVARICE from facts it measured, and committed by the supervisor.
//
//   context-pack  an index-first pack (intel, then graph) for the prompt; the step keeps item references and a digest, never text (S-41)
//   launch:run    attempt, item ready -> delegated, a snapshot of the clone, one contained invocation of the unit
//   classify      resultSeen, is_error, exit, signal, timeout, denials, clone HEAD before and after, a quick SUMMARY, in-scope changes since the
//                 snapshot, a structural pause signal; model text decides nothing (AUT-7). Anything but `progressed` ends in a decision.
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
import type { RunContract } from '../../domain/run-contract.ts';
import type { InvocationOutcome } from '../../ports/agent-host.ts';
import type { AttemptRow, RunRow, WorkItemRow } from '../../ports/ledger.ts';
import type { PathChange, WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { runRequiredChecks, checksToRun } from '../checks.ts';
import { queryContext } from '../context.ts';
import { completeRunInvocation, prepareRunInvocation } from '../invocation.ts';
import { faultPoint } from '../onboarding-service.ts';
import { runUnitPrompt } from '../run-gsd-config.ts';
import { blockRun } from './blocked.ts';
import type { RunStage, RunStageContext } from './stage.ts';

const RECORD_MAX_BYTES = 64 * 1024;
const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;
const PACK_BUDGET = 4000;
const MAX_IGNORED_STORED = 200;
const STORE = 'local';
const RUN_RETENTION = 'run';
const QUICK_RECORD_KIND = 'gsd-quick-record';

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

function snapshotOf(ctx: RunStageContext, attemptId: string): Result<WorkspaceSnapshot> {
  const step = stepOfAttempt(ctx, 'snapshot', attemptId);
  if (!step.ok) return step;
  const r = step.value;
  if (r === null || typeof r['head'] !== 'string' || typeof r['tree'] !== 'string') return err({ kind: 'internal', cause: `attempt ${attemptId} has no snapshot step` });
  return ok({ head: r['head'], tree: r['tree'], ignored: Array.isArray(r['ignored']) ? r['ignored'].filter((x): x is string => typeof x === 'string') : [] });
}

// item ready -> delegated -> (launch, classify) -> implemented -> (G2) -> gated -> (commit) -> done
async function attemptUnit(unit: Unit, row: RunRow): Promise<Result<void>> {
  const { ctx, contract } = unit;
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const ordinal = attempts.value.length + 1;

  const marked = ctx.checkpoint('context-pack', { itemId: unit.item.itemId });
  if (!marked.ok) return marked;
  const pack = await contextPack(unit, row, ordinal);
  if (!pack.ok) return pack;

  const attempt = deps.ledger.recordRunAttempt(ctx.runId, { reason: ordinal === 1 ? 'initial' : 'retry', nowMs: deps.clock.nowMs() });
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

  const outcome = await deps.host.invoke(prepared.value.prepared.request, new AbortController().signal);
  const completed = completeRunInvocation(deps, prepared.value.prepared, outcome);
  // The host's own error comes back unchanged and is judged below; any other failure is the bookkeeping's and stops the stage.
  if (!completed.ok && completed !== outcome) return completed;

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
      ...(c.hostError !== undefined ? { hostError: c.hostError.kind } : {}),
    },
    classifyStarted,
  );
  if (!recorded.ok) return recorded;

  if (c.kind !== 'progressed') return routeOutcome(unit, attemptId, c);

  const implemented = deps.ledger.transitionWorkItem(ctx.runId, unit.item.itemId, { fence: ctx.fence }, { to: 'implemented', nowMs: deps.clock.nowMs(), attemptId });
  if (!implemented.ok) return implemented;
  return gateUnit(unit, row, attemptId, snapshot.value);
}

// The routing table of a unit that did not progress: classified kind -> (blocked reason, decision class). Plan 02-16 inserts the CON-16
// discard-and-retry before the `failed` and `inconclusive` fallbacks.
function routeOutcome(unit: Unit, attemptId: string, c: Classified): Result<void> {
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
  const why =
    c.hostError !== undefined
      ? `the host could not run the unit (${c.hostError.kind})`
      : c.kind === 'inconclusive'
        ? 'the unit ended without a final result or hit the wall clock'
        : 'the unit ended in error (non-zero exit, a signal or an error result)';
  // A host that refused to launch (no sandbox, a failed self-test) is a containment condition, not a model failure.
  const enforcement = c.hostError !== undefined && (c.hostError.kind === 'unavailable' || c.hostError.kind === 'denied');
  return done(blockRun(ctx, { reason: enforcement ? 'enforcement_failure' : 'decision', decisionClass: enforcement ? 'permission' : 'repeated_failure', issue: why, ...common }));
}

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
    // Measured when plan 02-14 adds the inventory; a contract that declares none has nothing to compare.
    inventory: [],
    verification,
    newOverrides: typeof c['overrides'] === 'number' ? c['overrides'] : 0,
    pruneEntries: typeof c['pruneEntries'] === 'number' ? c['pruneEntries'] : 0,
  };
  let verdict: GateVerdict = evaluateG2({ ...facts, delta: [] });
  let failingEvidence: string[] = [];
  if (verdict.passed) {
    const ran = await runRequiredChecks(deps, row, contract, { cwd: unit.clone, attemptId, label: 'g2', contractVersion: unit.contractVersion, itemId: unit.item.itemId });
    if (!ran.ok) return ran;
    // Until plan 02-14 measures a baseline, every required check is taken to pass at base: stricter than D-12, it can only block more.
    const delta = baselineDelta({
      base: checksToRun(contract).map((x) => ({ name: x.spec.name, status: 'passed' as const })),
      head: ran.value.map((r) => ({ name: r.name, status: r.status, evidenceId: r.evidenceId })),
      required: contract.verification.requiredChecks,
      targets: contract.verification.targetChecks,
    });
    verdict = evaluateG2({ ...facts, delta: delta.blocking });
    failingEvidence = ran.value.filter((r) => r.status !== 'passed').map((r) => r.evidenceId);
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
