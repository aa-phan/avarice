// Cancelling a run (plan 03-24; AUT-12, owner decision 3 of 2026-11-08; S-20, T-03-47, T-03-48). `cancelled` is the one terminal state an owner chooses: the run is
// stopped at any non-terminal state, whether or not a supervisor is working on it, and nothing is lost.
//
//   no live lease   `cancelRun` records the request, takes the run lease, ends every host the dead holder left running (the reap `resume` does), withdraws every open
//                   decision in decision-ID order (reason `cancel`), ends the open attempt `cancelled`, moves the run to `cancelled` and releases the lease.
//   a live lease    `cancelRun` records the request and returns. The supervisor's lease timer reads the request on its next tick and aborts the unit in flight; the
//                   attempt ends `cancelled` (nothing is classified, retried or discarded, and the killed invocation stays charged), and the supervisor runs `finishCancel`
//                   through its fenced context at its next check and stops. A supervisor that dies after the request leaves the request standing: the next supervisor
//                   start, or `cancel` again, finishes it, and a run with a request never goes on with work.
//
// Everything here writes ledger rows. Nothing deletes, resets or checks out anything in the user's checkout or in the run clone (S-20): the clone and its branch
// stay for inspection, and a cancelled run is terminal, so `resume` only reports it stopped.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isRunTerminal } from '../domain/run-lifecycle.ts';
import type { RunRow } from '../ports/ledger.ts';
import { chargeRunOrphans } from './budget.ts';
import type { AppDeps } from './deps.ts';
import { faultPoint, leaseTtlMs } from './onboarding-service.ts';
import { holderId, makeRunContext } from './run-context.ts';
import { reapRunLaunches } from './run-resume.ts';
import type { RunStageContext } from './run-stages/stage.ts';

const CANCEL_LEASE_MAX_MS = 60_000;

export interface CancelOutcome {
  // `cancelled`: this call moved the run to cancelled (or found it so). `requested`: a supervisor holds the lease and will finish it.
  kind: 'cancelled' | 'requested';
  // How many open decisions this call withdrew.
  withdrawn: number;
}

// A run row whose cancel was asked for and not yet carried out.
export const isCancelPending = (run: RunRow): boolean => run.cancelRequestedAt !== null && !isRunTerminal(run.state);

const leaseIsLive = (run: RunRow, nowMs: number): boolean => run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;

// The end of a cancel, under a lease: the open decisions are withdrawn in decision-ID order (only those still open, so a cancel that was interrupted and runs again
// withdraws nothing twice), the open attempt ends `cancelled`, and the run moves to `cancelled` through the fenced context. `row` is the run as the caller last read
// it; the run is read again here, because a stage may have moved it. A run that is already terminal is returned as it is.
export function finishCancel(ctx: RunStageContext, row: RunRow): Result<{ run: RunRow; withdrawn: number }> {
  const { deps, runId } = ctx;
  const latest = deps.ledger.getRun(row.runId);
  if (!latest.ok) return latest;
  if (isRunTerminal(latest.value.state)) return ok({ run: latest.value, withdrawn: 0 });

  const open = deps.ledger.listDecisions({ runId, state: 'open' });
  if (!open.ok) return open;
  let withdrawn = 0;
  for (const decisionId of open.value.map((d) => d.decisionId).sort()) {
    const taken = deps.ledger.withdrawDecision({ runId, decisionId, reason: 'cancel', nowMs: deps.clock.nowMs() });
    // An answer that landed since the list was read leaves nothing to withdraw.
    if (!taken.ok) {
      if (taken.error.kind === 'conflict') continue;
      return taken;
    }
    withdrawn += 1;
  }
  // A kill here leaves the decisions withdrawn and the run not yet cancelled: the request stands, and the next `cancel` or supervisor start runs this again,
  // which withdraws nothing a second time.
  faultPoint('mid-cancel');

  const attempts = deps.ledger.listRunAttempts(runId);
  if (!attempts.ok) return attempts;
  for (const attempt of attempts.value.filter((a) => a.endedAt === null)) {
    const ended = deps.ledger.endRunAttempt(attempt.attemptId, { outcome: 'cancelled', nowMs: deps.clock.nowMs() });
    if (!ended.ok && ended.error.kind !== 'conflict') return ended;
  }

  const current = deps.ledger.getRun(runId);
  if (!current.ok) return current;
  const moved = ctx.transition(current.value, 'cancelled', 'none', { data: { withdrawn } });
  return moved.ok ? ok({ run: moved.value, withdrawn }) : moved;
}

// The whole cancel of a lease holder that has no unit in flight: every host the earlier holder left running is ended and its invocation charged, then the cancel is
// finished. A reap that fails stops the cancel with nothing withdrawn.
export async function cancelUnderLease(ctx: RunStageContext): Promise<Result<{ run: RunRow; withdrawn: number }>> {
  const reaped = await reapRunLaunches(ctx);
  if (!reaped.ok) return reaped;
  const charged = chargeRunOrphans(ctx.deps, ctx.runId);
  if (!charged.ok) return charged;
  const run = ctx.deps.ledger.getRun(ctx.runId);
  if (!run.ok) return run;
  return finishCancel(ctx, run.value);
}

// Takes the run lease for the length of one cancel and carries it out. A lease another holder took first is a supervisor that will see the request: `requested`.
export async function completeCancel(deps: AppDeps, runId: string): Promise<Result<CancelOutcome>> {
  const holder = holderId();
  // The cancel holds the lease only while it works, so a cancel that dies leaves it for at most this long, never a supervisor's whole term.
  const grant = deps.ledger.acquireRunLease(runId, holder, Math.min(leaseTtlMs(), CANCEL_LEASE_MAX_MS), deps.clock.nowMs());
  if (!grant.ok) return grant.error.kind === 'conflict' ? ok({ kind: 'requested', withdrawn: 0 }) : grant;
  const { fence } = grant.value;
  try {
    const ctx = makeRunContext(deps, runId, fence, [], new AbortController().signal);
    const done = await cancelUnderLease(ctx);
    return done.ok ? ok({ kind: 'cancelled', withdrawn: done.value.withdrawn }) : done;
  } finally {
    deps.ledger.releaseRunLease(runId, holder, fence);
  }
}

// `avarice cancel <run>`: records the owner's request (the first one is kept), then either carries the cancel out at once (nobody holds the lease) or leaves it to the
// supervisor that does. The request is committed before anything else is touched, and the lease is looked at again after it: a supervisor that released the lease
// between the two reads cannot miss a request that was committed before its last look (it looks again after its release), and one that has not released it will
// see the request on its next tick. A run that has ended is a `conflict` and nothing is written.
export async function cancelRun(deps: AppDeps, runId: string, by: string, nowMs: number): Promise<Result<CancelOutcome>> {
  const found = deps.ledger.getRun(runId);
  if (!found.ok) return found;
  if (isRunTerminal(found.value.state)) return err({ kind: 'conflict', expected: 'a run that has not ended', actual: `run ${runId} is ${found.value.state}` });

  const requested = deps.ledger.requestRunCancel(runId, { by, nowMs });
  if (!requested.ok) return requested;
  // A kill here leaves the request committed and nothing else done: the next supervisor start or `cancel` carries it out.
  faultPoint('after-cancel-request');

  const again = deps.ledger.getRun(runId);
  if (!again.ok) return again;
  if (leaseIsLive(again.value, deps.clock.nowMs())) return ok({ kind: 'requested', withdrawn: 0 });
  return completeCancel(deps, runId);
}
