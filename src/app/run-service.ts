// Run supervisor (plan 02-12; FR-2, FR-7, D-18): the lease-holding stage loop of one run, the run counterpart of runOnboarding.
// runSupervisor takes the run lease (free, or strictly expired), renews it every ttl/3 while stages run, runs the stage for the
// run's state until a stop state, and releases the lease on the way out. A stage never advances a run without the fence: its
// context presents the lease fence on every checkpoint and transition, and the context fires the generic kill points
// `after-checkpoint:<action>` and `after-transition:<state>` through the one fault mechanism (faultPoint of onboarding-service.ts).
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../domain/digest.ts';
import { err, ok } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import { isRunStopState } from '../domain/run-lifecycle.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import type { AppDeps } from './deps.ts';
import { faultPoint, leaseTtlMs } from './onboarding-service.ts';
import { writeContractFile } from './run-start.ts';
import { contractReadyStage } from './run-stages/prepare.ts';
import type { RunRow } from '../ports/ledger.ts';
import type { RunStage, RunStageContext, RunTransitionOptions } from './run-stages/stage.ts';

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

function makeContext(deps: AppDeps, runId: string, fence: number, notes: string[]): RunStageContext {
  return {
    deps,
    runId,
    fence,
    checkpoint(nextAction, extra) {
      const checkpoint = deps.ledger.recordRunCheckpoint(runId, { fence }, { nextAction, nowMs: deps.clock.nowMs(), ...(extra ?? {}) });
      if (checkpoint.ok) faultPoint('after-checkpoint:' + nextAction);
      return checkpoint;
    },
    transition(row: RunRow, to: RunState, nextAction: string, options: RunTransitionOptions = {}) {
      const moved = deps.ledger.transitionRun(
        runId,
        { version: row.version, fence },
        {
          to,
          nextAction,
          nowMs: deps.clock.nowMs(),
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          ...(options.data !== undefined ? { data: options.data } : {}),
          ...(options.attemptId !== undefined ? { attemptId: options.attemptId } : {}),
          ...(options.itemId !== undefined ? { itemId: options.itemId } : {}),
          ...(options.revision !== undefined ? { revision: options.revision } : {}),
          ...(options.workspacePath !== undefined ? { workspacePath: options.workspacePath } : {}),
          ...(options.branch !== undefined ? { branch: options.branch } : {}),
        },
      );
      if (moved.ok) {
        faultPoint('after-transition:' + to);
        faultPoint('after-checkpoint:' + nextAction);
      }
      return moved;
    },
    note(message) {
      notes.push(message);
    },
  };
}

function holderId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

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
}

const outcomeOf = (row: RunRow, message: string | null): RunOutcome => ({ runId: row.runId, state: row.state, reason: row.reason, message });

// Takes the lease, loops the stage for the run's state until a stop state or a state with no stage, and releases the lease.
// A run already in a stop state takes no lease and runs nothing.
export async function runSupervisor(deps: AppDeps, runId: string, options: RunSupervisorOptions = {}): Promise<Result<RunOutcome>> {
  const first = deps.ledger.getRun(runId);
  if (!first.ok) return first;
  if (isRunStopState(first.value.state)) return ok(outcomeOf(first.value, null));

  const holder = holderId();
  const ttl = leaseTtlMs();
  const grant = deps.ledger.acquireRunLease(runId, holder, ttl, deps.clock.nowMs());
  if (!grant.ok) return grant;
  const fence = grant.value.fence;
  const notes: string[] = [];
  const ctx = makeContext(deps, runId, fence, notes);

  // A stage that waits on the host does not return to the loop, so a timer keeps the lease alive; it is unref'd, so it never keeps
  // the process alive by itself. A failed renewal means another process took over, and the loop stops at its next check.
  const lease: { lost: PortError | null } = { lost: null };
  const timer = setInterval(() => {
    const renewed = deps.ledger.renewRunLease(runId, holder, fence, ttl, deps.clock.nowMs());
    if (!renewed.ok) {
      lease.lost = renewed.error;
      clearInterval(timer);
    }
  }, Math.max(1, Math.floor(ttl / 3)));
  timer.unref();

  try {
    const filed = ensureContractFile(deps, runId);
    if (!filed.ok) return filed;
    if (options.prelude !== undefined) {
      const prepared = await options.prelude(ctx);
      if (!prepared.ok) return prepared;
    }
    for (;;) {
      if (lease.lost !== null) return err(lease.lost);
      const current = deps.ledger.getRun(runId);
      if (!current.ok) return current;
      const row = current.value;
      if (isRunStopState(row.state)) return ok(outcomeOf(row, notes.at(-1) ?? null));
      const stage = stages.get(row.state);
      if (stage === undefined) return ok(outcomeOf(row, notes.at(-1) ?? `no stage for ${row.state}`));

      const renewed = deps.ledger.renewRunLease(runId, holder, fence, ttl, deps.clock.nowMs());
      if (!renewed.ok) return renewed;
      const ran = await stage(ctx, row);
      if (!ran.ok) return ran;

      // A stage that returns without moving the run would loop forever.
      const after = deps.ledger.getRun(runId);
      if (!after.ok) return after;
      if (after.value.state === row.state && after.value.version === row.version) {
        return err({ kind: 'internal', cause: `the ${row.state} stage made no progress` });
      }
    }
  } finally {
    clearInterval(timer);
    deps.ledger.releaseRunLease(runId, holder, fence);
  }
}
