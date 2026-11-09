// Run supervisor (plan 02-12; FR-2, FR-7, D-18): the lease-holding stage loop of one run, the run counterpart of runOnboarding.
// runSupervisor takes the run lease (free, or strictly expired), renews it every ttl/3 while stages run, runs the stage for the
// run's state until a stop state, and releases the lease on the way out. A stage never advances a run without the fence: its
// context presents the lease fence on every checkpoint and transition, and the context fires the generic kill points
// `after-checkpoint:<action>` and `after-transition:<state>` through the one fault mechanism (faultPoint of onboarding-service.ts).
//
// The owner's cancel (plan 03-24; AUT-12): the lease timer also reads the run row, and a cancel request aborts the unit in flight (the unit ends its attempt `cancelled`
// and is neither classified nor retried). The loop looks for a request before each stage and after each one returns (before the no-progress check) and, when it finds
// one, finishes the cancel through its fenced context and stops; a supervisor that starts on a run with a request standing cancels it before any stage; and after it
// has released its lease it looks once more, so a request that landed in the last moment is never left with nobody to carry it out.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../domain/digest.ts';
import { err, ok } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import { isRunStopState } from '../domain/run-lifecycle.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import { cancelUnderLease, completeCancel, finishCancel, isCancelPending } from './cancel.ts';
import type { AppDeps } from './deps.ts';
import { faultPoint, leaseTtlMs } from './onboarding-service.ts';
import { holderId, makeRunContext } from './run-context.ts';
import { writeContractFile } from './run-start.ts';
import { runningStage } from './run-stages/item.ts';
import { isBlockedRunContinuable } from './run-stages/schedule.ts';
import { verifyingStage } from './run-stages/finish.ts';
import { contractReadyStage } from './run-stages/prepare.ts';
import type { RunRow } from '../ports/ledger.ts';
import type { RunStage, RunStageContext } from './run-stages/stage.ts';

export interface RunOutcome {
  runId: string;
  state: RunState;
  reason: RunBlockedReason | null;
  // Why the supervisor stopped, when a stage said so (or when no stage exists for the state).
  message: string | null;
}

// The stage for each run state. A later plan adds the stage for its state with registerRunStage; the loop looks the stage up by the
// run's committed state, so no stage is called for a state that has none.
const stages = new Map<RunState, RunStage>();
export const RUN_STAGES: ReadonlyMap<RunState, RunStage> = stages;

export function registerRunStage(state: RunState, stage: RunStage): void {
  stages.set(state, stage);
}

registerRunStage('contract_ready', contractReadyStage);
registerRunStage('running', runningStage);
registerRunStage('verifying', verifyingStage);

// A start killed between its ledger transaction and its contract file write leaves a run without `contract-v<n>.json` (plan 02-10).
// The file is the ledger's contract, written again by the lease holder before anything is launched.
function ensureContractFile(deps: AppDeps, runId: string): Result<void> {
  const stored = deps.ledger.getRunContract(runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${runId} has no stored contract` });
  const file = join(deps.profile.dataRoot, 'runs', runId, `contract-v${stored.value.version}.json`);
  if (existsSync(file)) return ok(undefined);
  try {
    writeContractFile(deps.profile.dataRoot, runId, canonicalJson(stored.value.body), stored.value.version);
  } catch (e) {
    return err({ kind: 'internal', cause: `the contract file of run ${runId} could not be written: ${e instanceof Error ? e.message : String(e)}` });
  }
  return ok(undefined);
}

export interface RunSupervisorOptions {
  // Runs once under the lease, before the stage loop (resume reconciles an interrupted invocation here).
  prelude?: (ctx: RunStageContext) => Promise<Result<void>> | Result<void>;
  // Test hook: runs in the window between the release of the lease on a blocked run and the re-check that follows it, where a `decide` in another
  // process can land its answer (the same window `after-release:blocked` names for a kill). Nothing in production sets it.
  afterRelease?: () => Promise<void> | void;
}

const outcomeOf = (row: RunRow, message: string | null): RunOutcome => ({ runId: row.runId, state: row.state, reason: row.reason, message });

// What one stay under the lease came to: the outcome, and whether the lease was held at all (a run that is not picked up never takes it).
interface Held {
  outcome: RunOutcome;
  held: boolean;
}

// Takes the lease, loops the stage for the run's state until a stop state or a state with no stage, and releases the lease.
// A run already in a stop state takes no lease and runs nothing, except a run blocked at an item decision that an answer has made continuable
// (D-16): that one is taken and moved back to running.
//
// A run that reaches blocked_on_decision at a decision does not end the supervisor at once (research Pattern 2): the lease is released, the items and
// the decisions are read again, and the run goes on in this process only if an answer made an item ready (or left no decision open) in that window.
// `decide` answers a decision and then starts a supervisor if the run holds no lease; the supervisor releases the lease and then looks for an answer;
// whichever of the two happens second sees the other's write, so a run cannot stay blocked with an answer waiting. Nothing polls.
export async function runSupervisor(deps: AppDeps, runId: string, options: RunSupervisorOptions = {}): Promise<Result<RunOutcome>> {
  let prelude = options.prelude;
  for (;;) {
    const stay = await superviseHeld(deps, runId, prelude === undefined ? {} : { prelude });
    if (!stay.ok) return stay;
    // The prelude (a resume's reconcile) is for the first stay only.
    prelude = undefined;
    const { outcome, held } = stay.value;
    if (held) {
      // The lease is released. A request that landed after this supervisor's last look is seen here, and a request that lands from now on is seen by `cancel`
      // itself, which looks at the lease after it records the request: either way someone carries it out.
      const post = deps.ledger.getRun(runId);
      if (!post.ok) return post;
      if (isCancelPending(post.value)) {
        const done = await completeCancel(deps, runId);
        if (!done.ok && done.error.kind !== 'conflict') return done;
        const settled = deps.ledger.getRun(runId);
        if (!settled.ok) return settled;
        return ok(outcomeOf(settled.value, null));
      }
    }
    if (!held || outcome.state !== 'blocked_on_decision' || outcome.reason !== 'decision') return ok(outcome);
    faultPoint('after-release:blocked');
    if (options.afterRelease !== undefined) await options.afterRelease();
    const now = deps.ledger.getRun(runId);
    if (!now.ok) return now;
    const again = isBlockedRunContinuable(deps, now.value);
    if (!again.ok) return again;
    if (!again.value) return ok(outcome);
  }
}

async function superviseHeld(deps: AppDeps, runId: string, options: Pick<RunSupervisorOptions, 'prelude'>): Promise<Result<Held>> {
  const first = deps.ledger.getRun(runId);
  if (!first.ok) return first;
  // A run with a cancel request standing is taken even in a stop state: the supervisor that starts is the one to carry the cancel out.
  if (isRunStopState(first.value.state) && !isCancelPending(first.value)) {
    // Not continuable: no lease, nothing written.
    const pickup = isBlockedRunContinuable(deps, first.value);
    if (!pickup.ok) return pickup;
    if (!pickup.value) return ok({ outcome: outcomeOf(first.value, null), held: false });
  }

  const holder = holderId();
  const ttl = leaseTtlMs();
  const grant = deps.ledger.acquireRunLease(runId, holder, ttl, deps.clock.nowMs());
  if (!grant.ok) return grant;
  const fence = grant.value.fence;
  const notes: string[] = [];
  // Aborted when a renewal fails, so the host of a unit in flight is ended at once instead of running out its wall clock under a lease this
  // supervisor no longer holds; also aborted when the owner asks to cancel the run (`lease.cancel`), which ends the unit the same way but not as a loss.
  // The finally block leaves it alone: a unit has returned by then.
  const lost = new AbortController();
  const lease: { lost: PortError | null; cancel: boolean } = { lost: null, cancel: false };
  const ctx = makeRunContext(deps, runId, fence, notes, lost.signal, () => lease.cancel && lease.lost === null);

  // A stage that waits on the host does not return to the loop, so a timer keeps the lease alive; it is unref'd, so it never keeps
  // the process alive by itself. A failed renewal means another process took over, and the loop stops at its next check. The same tick reads the run row
  // for a cancel request, so a unit that waits on the host is aborted within one tick of it (AUT-12).
  const timer = setInterval(() => {
    const renewed = deps.ledger.renewRunLease(runId, holder, fence, ttl, deps.clock.nowMs());
    if (!renewed.ok) {
      lease.lost = renewed.error;
      clearInterval(timer);
      lost.abort();
      return;
    }
    if (lease.cancel) return;
    const read = deps.ledger.getRun(runId);
    if (read.ok && isCancelPending(read.value)) {
      lease.cancel = true;
      lost.abort();
    }
  }, Math.max(1, Math.floor(ttl / 3)));
  timer.unref();

  // The cancel of a run this supervisor holds, carried out under its fence (a unit it ran has already returned).
  const cancelNow = (row: RunRow): Result<Held> => {
    const done = finishCancel(ctx, row);
    return done.ok ? ok({ outcome: outcomeOf(done.value.run, null), held: true }) : done;
  };

  try {
    // A request standing at entry is carried out before anything else: no prelude, no stage, no unit. Hosts the earlier holder left running are ended first.
    const atEntry = deps.ledger.getRun(runId);
    if (!atEntry.ok) return atEntry;
    if (isCancelPending(atEntry.value)) {
      const done = await cancelUnderLease(ctx);
      return done.ok ? ok({ outcome: outcomeOf(done.value.run, null), held: true }) : done;
    }
    const filed = ensureContractFile(deps, runId);
    if (!filed.ok) return filed;
    if (options.prelude !== undefined) {
      const prepared = await options.prelude(ctx);
      if (!prepared.ok) return prepared;
    }
    // A blocked run that an answer made continuable goes back to running; the state it reads under the lease decides, not the one read before it.
    const entered = deps.ledger.getRun(runId);
    if (!entered.ok) return entered;
    if (entered.value.state === 'blocked_on_decision') {
      const pickup = isBlockedRunContinuable(deps, entered.value);
      if (!pickup.ok) return pickup;
      if (!pickup.value) return ok({ outcome: outcomeOf(entered.value, null), held: true });
      const resumed = ctx.transition(entered.value, 'running', 'context-pack', { data: { resumedFrom: 'blocked_on_decision' } });
      if (!resumed.ok) return resumed;
    }
    for (;;) {
      if (lease.lost !== null) return err(lease.lost);
      const current = deps.ledger.getRun(runId);
      if (!current.ok) return current;
      const row = current.value;
      if (isCancelPending(row)) return cancelNow(row);
      if (isRunStopState(row.state)) return ok({ outcome: outcomeOf(row, notes.at(-1) ?? null), held: true });
      const stage = stages.get(row.state);
      if (stage === undefined) return ok({ outcome: outcomeOf(row, notes.at(-1) ?? `no stage for ${row.state}`), held: true });

      const renewed = deps.ledger.renewRunLease(runId, holder, fence, ttl, deps.clock.nowMs());
      if (!renewed.ok) {
        lost.abort();
        return renewed;
      }
      const ran = await stage(ctx, row);
      if (!ran.ok) {
        // A stage that failed because the owner asked to cancel (its unit was aborted, or a transition found the row moved) is not a failure of the run.
        if (lease.lost === null) {
          const again = deps.ledger.getRun(runId);
          if (again.ok && isCancelPending(again.value)) return cancelNow(again.value);
        }
        return ran;
      }

      // A stage that returns without moving the run would loop forever, unless the owner asked to cancel: that is looked for first.
      const after = deps.ledger.getRun(runId);
      if (!after.ok) return after;
      if (isCancelPending(after.value)) return cancelNow(after.value);
      if (after.value.state === row.state && after.value.version === row.version) {
        return err({ kind: 'internal', cause: `the ${row.state} stage made no progress` });
      }
    }
  } finally {
    clearInterval(timer);
    deps.ledger.releaseRunLease(runId, holder, fence);
  }
}
