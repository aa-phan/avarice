// The contract between the run supervisor loop (run-service.ts) and the run stages, the run counterpart of
// stages/stage.ts. A stage gets a context whose commit helpers (checkpoint, transition) carry the lease fence and also fire the
// generic kill points `after-checkpoint:<action>` and `after-transition:<state>`, so no stage file carries fault code
// (SKELETON.md "Kill points", FR-2, FR-7). Stages never import the service.
import type { Result } from '../../domain/result.ts';
import type { RunBlockedReason, RunState } from '../../domain/run-lifecycle.ts';
import type { RunCheckpointRow, RunRow } from '../../ports/ledger.ts';
import type { AppDeps } from '../deps.ts';

export interface RunTransitionOptions {
  reason?: RunBlockedReason;
  // Event data: IDs, counts, digests and short detail strings only.
  data?: Readonly<Record<string, unknown>>;
  attemptId?: string;
  itemId?: string;
  revision?: string;
  // Recorded on the run row the first time they are known and kept afterwards.
  workspacePath?: string;
  branch?: string;
}

export interface RunStageContext {
  deps: AppDeps;
  runId: string;
  // Lease fence this supervisor holds; every checkpoint and transition presents it.
  fence: number;
  // Commit a checkpoint naming the action about to run, before its side effect.
  checkpoint(nextAction: string, extra?: { revision?: string; itemId?: string; attemptId?: string }): Result<RunCheckpointRow>;
  // Commit a lifecycle transition (state, checkpoint and event in one transaction).
  transition(row: RunRow, to: RunState, nextAction: string, options?: RunTransitionOptions): Result<RunRow>;
  // A human-readable note surfaced to the caller (for example why the run blocked).
  note(message: string): void;
}

export type RunStage = (ctx: RunStageContext, row: RunRow) => Promise<Result<void>> | Result<void>;
