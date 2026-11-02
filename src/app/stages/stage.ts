// The contract between the stage loop (onboarding-service.ts) and the stages. A stage gets a context
// whose commit helpers (checkpoint, transition, activate) also fire the generic kill points, so no
// stage file carries fault code (SKELETON.md "Kill points"). Stages never import the service.
import type { Result } from '../../domain/result.ts';
import type { BlockedReason, OnboardingState } from '../../domain/onboarding-lifecycle.ts';
import type {
  ActivationResult,
  CheckpointRow,
  OnboardingRow,
} from '../../ports/ledger.ts';
import type { AppDeps } from '../deps.ts';

export interface TransitionOptions {
  reason?: BlockedReason;
  stagingWorktree?: string;
  // Event data: IDs, counts, digests and short detail strings only.
  data?: Readonly<Record<string, unknown>>;
}

export interface StageContext {
  deps: AppDeps;
  onboardingId: string;
  // Lease fence this run holds.
  fence: number;
  // Commit a checkpoint naming the action about to run, before its side effect.
  checkpoint(nextAction: string, extra?: { stagingWorktree?: string }): Result<CheckpointRow>;
  // Commit a lifecycle transition (state, checkpoint and event in one transaction).
  transition(row: OnboardingRow, to: OnboardingState, nextAction: string, options?: TransitionOptions): Result<OnboardingRow>;
  // Insert the project record version and move planning_ready to active in one transaction.
  activate(row: OnboardingRow, body: Readonly<Record<string, unknown>>): Result<ActivationResult>;
  // A human-readable note surfaced to the caller (for example why onboarding blocked).
  note(message: string): void;
}

export type Stage = (ctx: StageContext, row: OnboardingRow) => Promise<Result<void>> | Result<void>;
