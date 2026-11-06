// `resume` for a run (plan 02-17; FR-7, NFR-6, CON-13, CON-16): continue a run whose supervisor died, from what the ledger and git recorded, never from
// chat history. The supervisor that `resume` spawns runs `reconcileRun` under the lease before its stage loop, in this order:
//
//   1. reap       every `launch:*` step left `started` is a host that may still be running (it is detached, in its own process group, and outlives a
//                 killed supervisor): it is ended by the session ID its step recorded. Every reap completes before any row is marked or anything is
//                 read from the clone, and a reap that fails stops the resume with every row still `started` (T-02-56, FR-7).
//   2. reconcile  by the run's state: a `running` run whose item was in flight is put back to its attempt's snapshot and retried once (CON-16) or, when
//                 the supervisor's own commit was made, the commit is recognised by its `Avarice-Attempt` trailer (T-02-57); a `verifying` run is shown
//                 `paused (verification interrupted)`, the checks of the interrupted final pass that never finished get `inconclusive` evidence (T-02-58),
//                 and the run goes back to `verifying`, which re-verifies on the current revision.
//   3. the stage loop continues from the committed state.
//
// Nothing is claimed that was not measured: an interrupted invocation is `inconclusive` (the conservative reading of the recovery table), and the
// budgets it was charged stay charged (the next reservation turns the orphaned one into spent invocations; nothing is refunded, CON-13).
import { cloneRevision, cachedVerdicts, checksToRun } from './checks.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import { isRunResumable, isRunStopState } from '../domain/run-lifecycle.ts';
import type { RunRow, RunStepRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { getRunStatuses } from './run-status.ts';
import { reconcileItem } from './run-stages/item.ts';
import type { RunStageContext } from './run-stages/stage.ts';

const LAUNCH_PREFIX = 'launch:';
// The run step that records why a resume could not go on (read by `avarice resume --wait` to tell a failed resume from a killed supervisor).
export const RECONCILE_STEP = 'resume:reconcile';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const leaseIsLive = (run: RunRow, nowMs: number): boolean => run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;

// ---- resumeRun: what `avarice resume <run_id>` decides before it spawns a supervisor ---------------------------------------------------

export type ResumeDecision =
  // Nothing to continue: the run is in a stop state (or waits for a person), and no lease is taken.
  | { kind: 'stopped'; run: RunRow }
  // The run is continued by a new supervisor. `nextAction`, `attemptId` and `step` are what `status` shows as interrupted.
  | { kind: 'spawn'; run: RunRow; nextAction: string | null; attemptId: string | null; step: string | null };

export function resumeRun(deps: AppDeps, runId: string): Result<ResumeDecision> {
  const found = deps.ledger.getRun(runId);
  if (!found.ok) return found;
  const run = found.value;
  if (isRunStopState(run.state) || !isRunResumable(run.state)) return ok({ kind: 'stopped', run });
  const nowMs = deps.clock.nowMs();
  // The lease of a live supervisor is never taken: the stage loop fences it out only once it has lapsed.
  if (leaseIsLive(run, nowMs)) {
    return err({ kind: 'conflict', expected: 'a free or lapsed run lease', actual: `held by ${run.leaseHolder ?? 'another supervisor'} until ${run.leaseExpiresAt ?? 'later'}` });
  }
  const latest = deps.ledger.latestRunCheckpoint(runId);
  if (!latest.ok) return latest;
  const statuses = getRunStatuses(deps.ledger, run.projectId, nowMs);
  if (!statuses.ok) return statuses;
  const interrupted = statuses.value.find((s) => s.runId === runId)?.interrupted;
  return ok({
    kind: 'spawn',
    run,
    nextAction: latest.value === null ? null : latest.value.nextAction,
    attemptId: interrupted?.attemptId ?? null,
    step: interrupted?.step ?? null,
  });
}

// ---- reconcileRun: the supervisor's prelude -----------------------------------------------------------------------------------------------

// Ends the host of every `launch:*` step the previous holder left `started`, then marks those steps `interrupted`. Every reap completes before any
// row is marked, so a reap that fails leaves every row `started` and the next resume tries again.
async function reapStartedLaunches(ctx: RunStageContext): Promise<Result<void>> {
  const { deps, runId } = ctx;
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return steps;
  const started = steps.value.filter((s) => s.step.startsWith(LAUNCH_PREFIX) && s.status === 'started');
  if (started.length === 0) return ok(undefined);

  for (const launch of started) {
    const body = isObject(launch.result) ? launch.result : {};
    const sessionId = body['sessionId'];
    if (deps.host.reap === undefined || typeof sessionId !== 'string' || sessionId === '') continue;
    const reaped = await deps.host.reap({ sessionId });
    if (!reaped.ok) return reaped;
    if (reaped.value.terminated === 0) continue;
    const invocationId = body['invocationId'];
    const event = deps.ledger.appendEvent({
      type: 'invocation.reaped',
      level: 'warn',
      runId,
      ...(typeof invocationId === 'string' ? { invocationId } : {}),
      ...(typeof body['attemptId'] === 'string' ? { attemptId: body['attemptId'] } : {}),
      data: { runId, ...(typeof invocationId === 'string' ? { invocationId } : {}), terminated: reaped.value.terminated },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
  }

  for (const launch of started) {
    const body = isObject(launch.result) ? launch.result : {};
    const marked = deps.ledger.recordRunStep(runId, {
      step: launch.step,
      attempt: launch.attempt,
      status: 'interrupted',
      result: body,
      nowMs: Date.parse(launch.startedAt),
      completedAtMs: deps.clock.nowMs(),
    });
    if (!marked.ok) return marked;
    // The budget's `invocation.orphan-charged` event cannot name the invocation (it is written by the next reservation, which has only a count),
    // so the interrupted invocation is named here.
    const invocationId = body['invocationId'];
    const event = deps.ledger.appendEvent({
      type: 'invocation.interrupted',
      level: 'warn',
      runId,
      ...(typeof invocationId === 'string' ? { invocationId } : {}),
      ...(typeof body['attemptId'] === 'string' ? { attemptId: body['attemptId'] } : {}),
      data: { runId, step: launch.step, ...(typeof invocationId === 'string' ? { invocationId } : {}) },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
  }
  return ok(undefined);
}

// The latest checkpoint action that is not the closing `none` or this reconcile's own, for the transition that puts a paused run back.
function lastAction(ctx: RunStageContext, fallback: string): Result<string> {
  const checkpoints = ctx.deps.ledger.listRunCheckpoints(ctx.runId);
  if (!checkpoints.ok) return checkpoints;
  for (let i = checkpoints.value.length - 1; i >= 0; i -= 1) {
    const action = (checkpoints.value[i] as { nextAction: string }).nextAction;
    if (action !== 'none' && action !== 'reconcile') return ok(action);
  }
  return ok(fallback);
}

const evidencePhaseOf = (environment: Readonly<Record<string, unknown>>): unknown => environment['phase'];

// Inserts `inconclusive` evidence for every check of the interrupted final pass that has no completed row (T-02-58): the pass began at the latest
// `verify:checks` checkpoint, and a check that finished since has its own row. Rows are insert-only, so what the interrupted pass did record stays
// as it is, and the re-verification adds the rows that count. Returns how many rows were inserted.
function markInterruptedChecks(ctx: RunStageContext, row: RunRow, contract: RunContract, contractVersion: number, head: string): Result<number> {
  const { deps } = ctx;
  const checkpoints = deps.ledger.listRunCheckpoints(ctx.runId);
  if (!checkpoints.ok) return checkpoints;
  const began = [...checkpoints.value].reverse().find((c) => c.nextAction === 'verify:checks');
  if (began === undefined) return ok(0);
  // A pass that reached its gate (or the hand-off) ran every check: nothing is missing, and nothing is inserted.
  const after = checkpoints.value.filter((c) => c.seq > began.seq).map((c) => c.nextAction);
  if (after.includes('gate:g4') || after.includes('handoff:fetch')) return ok(0);

  const workspace = deps.runWorkspace;
  if (workspace === undefined || row.workspacePath === null) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const where = cloneRevision(deps, row.workspacePath);
  if (!where.ok) return where;
  const evidence = deps.ledger.listEvidence(ctx.runId);
  if (!evidence.ok) return evidence;
  const finished = new Set(
    evidence.value
      .filter((e) => e.kind === 'check' && evidencePhaseOf(e.environment) === 'final' && e.revision === where.value.revision && e.createdAt >= began.createdAt)
      .map((e) => e.name),
  );
  const verdicts = cachedVerdicts(deps, row, contract);
  if (!verdicts.ok) return verdicts;
  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const attempt = attempts.value.at(-1);
  if (attempt === undefined) return err({ kind: 'internal', cause: `run ${ctx.runId} is verifying but has no attempt` });

  let inserted = 0;
  for (const { spec } of checksToRun(contract)) {
    // The pass runs only checks that passed validation (ONB-10): one that was never going to run is not an interrupted check.
    if (verdicts.value.get(spec.name)?.verdict !== 'active' || finished.has(spec.name)) continue;
    const recorded = deps.ledger.recordEvidence({
      attemptId: attempt.attemptId,
      workItem: 'A',
      kind: 'check',
      name: spec.name,
      status: 'inconclusive',
      revision: where.value.revision,
      clean: where.value.clean,
      treeDigest: where.value.treeDigest,
      environment: { kind: contract.execution.environment, sandbox: 'seatbelt', label: 'final', phase: 'final', interrupted: true, reason: 'verification interrupted', head: head.slice(0, 12) },
      contractVersion,
      policyRevision: contract.policyRevision,
      independence: 'deterministic',
      acceptance: contract.intent.acceptance.filter((a) => a.verifiedBy.includes(`check:${spec.name}`)).map((a) => a.id),
      command: spec.argv,
      nowMs: deps.clock.nowMs(),
    });
    if (!recorded.ok) return recorded;
    inserted += 1;
  }
  return ok(inserted);
}

// A `verifying` run (or a `paused` one that was on its way back to verifying): shown paused with the reason, its interrupted checks marked, then
// back to `verifying` with the action it resumes at: the hand-off when G4 already passed for this very commit, else the checks.
function reconcileVerifying(ctx: RunStageContext, run: RunRow): Result<void> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  if (run.workspacePath === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
  const stored = deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  const contract = stored.value.body as RunContract;

  const head = workspace.head(run.workspacePath);
  if (!head.ok) return head;
  const revision = `git:${head.value}`;
  const steps = deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const gates = deps.ledger.listGateResults(ctx.runId);
  if (!gates.ok) return gates;
  const passedG4 = gates.value.some((g) => g.gate === 'G4' && g.passed && g.revision === revision);
  const handedOff = steps.value.some((s: RunStepRow) => s.step === 'handoff:fetch' && s.status === 'completed' && isObject(s.result) && s.result['commit'] === head.value);
  const next = passedG4 || handedOff ? 'handoff:fetch' : 'verify:checks';

  let current = run;
  if (current.state === 'verifying') {
    const paused = ctx.transition(current, 'paused', 'reconcile', { data: { reason: 'verification interrupted' } });
    if (!paused.ok) return paused;
    current = paused.value;
  }
  const inserted = markInterruptedChecks(ctx, current, contract, stored.value.version, head.value);
  if (!inserted.ok) return inserted;
  const event = deps.ledger.appendEvent({
    type: 'verification.interrupted',
    level: 'warn',
    runId: ctx.runId,
    data: { runId: ctx.runId, inconclusive: inserted.value, resumeAt: next },
    nowMs: deps.clock.nowMs(),
  });
  if (!event.ok) return event;
  const resumed = ctx.transition(current, 'verifying', next, { data: { reconciled: true, inconclusive: inserted.value } });
  return resumed.ok ? ok(undefined) : resumed;
}

// A `running` run (or a `paused` one on its way back to running): the item that was in flight is reconciled by item.ts, which owns what an attempt
// leaves behind; the run is paused around a reconcile of a delegated item (reason `interrupted`) and put back to `running` afterwards.
function reconcileRunning(ctx: RunStageContext, run: RunRow): Result<void> {
  const { deps } = ctx;
  const items = deps.ledger.listWorkItems(ctx.runId);
  if (!items.ok) return items;
  const item = items.value[0];
  const inFlight = item !== undefined && (item.state === 'delegated' || item.state === 'gated');

  let current = run;
  if (item?.state === 'delegated' && current.state === 'running') {
    const paused = ctx.transition(current, 'paused', 'reconcile', { data: { reason: 'interrupted' } });
    if (!paused.ok) return paused;
    current = paused.value;
  }
  let outcome: string = 'none';
  if (inFlight) {
    const reconciled = reconcileItem(ctx, current);
    if (!reconciled.ok) return reconciled;
    outcome = reconciled.value;
    // A reconcile that blocked the run has already moved it to blocked_on_decision.
    if (outcome === 'blocked') return ok(undefined);
  }
  if (current.state !== 'paused') return ok(undefined);
  const latest = deps.ledger.getRun(ctx.runId);
  if (!latest.ok) return latest;
  // A retry starts again at `context-pack` (the stage's ready branch); any other outcome continues at the action it had reached.
  let to = 'context-pack';
  if (outcome !== 'retry') {
    const last = lastAction(ctx, 'context-pack');
    if (!last.ok) return last;
    to = last.value;
  }
  const resumed = ctx.transition(latest.value, 'running', to, { data: { reconciled: true, outcome } });
  return resumed.ok ? ok(undefined) : resumed;
}

async function reconcile(ctx: RunStageContext): Promise<Result<void>> {
  const reaped = await reapStartedLaunches(ctx);
  if (!reaped.ok) return reaped;

  const current = ctx.deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  const run = current.value;
  if (run.state === 'verifying') return reconcileVerifying(ctx, run);
  if (run.state === 'running') return reconcileRunning(ctx, run);
  if (run.state === 'paused') {
    // A previous reconcile paused the run and was killed before it put it back: the item's state says which way back it was going.
    const items = ctx.deps.ledger.listWorkItems(ctx.runId);
    if (!items.ok) return items;
    return items.value[0]?.state === 'done' ? reconcileVerifying(ctx, run) : reconcileRunning(ctx, run);
  }
  // contract_ready: the stage repeats the actions whose step is not recorded, and a fresh run has nothing to reap.
  return ok(undefined);
}

// The prelude the supervisor always runs under the lease. A failure is recorded as a failed `resume:reconcile` step (the resume reports it) and
// stops the supervisor, with the rows it could not settle left as they were.
export async function reconcileRun(ctx: RunStageContext): Promise<Result<void>> {
  const done = await reconcile(ctx);
  if (done.ok) return done;
  const { deps } = ctx;
  const earlier = deps.ledger.getRunSteps(ctx.runId);
  const attempt = earlier.ok ? earlier.value.filter((s) => s.step === RECONCILE_STEP).length + 1 : 1;
  const nowMs = deps.clock.nowMs();
  const detail = 'cause' in done.error && typeof done.error.cause === 'string' ? done.error.cause : '';
  deps.ledger.recordRunStep(ctx.runId, {
    step: RECONCILE_STEP,
    attempt,
    status: 'failed',
    result: { error: done.error.kind, detail: detail.slice(0, 300) },
    nowMs,
    completedAtMs: nowMs,
  });
  return done;
}
