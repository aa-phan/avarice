// The fenced context of a run stage (plan 02-12; extracted from run-service.ts by plan 03-24). A stage, the supervisor's cancel and `avarice cancel` itself all
// commit through this one context: every checkpoint and transition presents the lease fence the holder was granted, and the context fires the generic kill
// points `after-checkpoint:<action>` and `after-transition:<state>` through the one fault mechanism (faultPoint of onboarding-service.ts).
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { RunRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { faultPoint } from './onboarding-service.ts';
import type { RunStageContext, RunTransitionOptions } from './run-stages/stage.ts';

// The name a process holds a run lease under: host, process and a random suffix, so two holders never share one.
export function holderId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

// `cancelRequested` answers for the supervisor that holds the lease: true once its lease timer saw the owner's cancel request and aborted the signal for it. A
// holder that has no timer (`avarice cancel` itself) leaves it out.
export function makeRunContext(deps: AppDeps, runId: string, fence: number, notes: string[], signal: AbortSignal, cancelRequested?: () => boolean): RunStageContext {
  return {
    deps,
    runId,
    fence,
    signal,
    ...(cancelRequested !== undefined ? { cancelRequested } : {}),
    checkpoint(nextAction, extra) {
      const checkpoint = deps.ledger.recordRunCheckpoint(runId, { fence }, { nextAction, nowMs: deps.clock.nowMs(), ...(extra ?? {}) });
      if (checkpoint.ok) faultPoint('after-checkpoint:' + nextAction);
      return checkpoint;
    },
    transition(row: RunRow, to, nextAction: string, options: RunTransitionOptions = {}) {
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
