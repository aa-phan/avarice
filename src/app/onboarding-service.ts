// Onboarding service: start an onboarding, and run the lease-holding stage loop (SKELETON.md "Application").
// runOnboarding reads the state, runs the stage for it, and stops at a stop state. Every stage commits a
// checkpoint naming its side effect before performing it, and the transition after it; the commit helpers
// in the stage context fire the generic kill points, so no stage carries fault code.
import { hostname } from 'node:os';
import { err, ok } from '../domain/result.ts';
import type { PortError, Result } from '../domain/result.ts';
import { isStopState } from '../domain/onboarding-lifecycle.ts';
import type { BlockedReason, OnboardingState } from '../domain/onboarding-lifecycle.ts';
import type { OnboardingRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { registerAndPreflight } from './stages/register.ts';
import type { Registered } from './stages/register.ts';
import { contractStage } from './stages/contract.ts';
import { workspaceStage } from './stages/workspace.ts';
import { mapStage } from './stages/map.ts';
import { retryOrBlockStage, validateStage } from './stages/validate.ts';
import { indexStage } from './stages/index-stage.ts';
import { activateStage } from './stages/activate.ts';
import type { Stage, StageContext, TransitionOptions } from './stages/stage.ts';

export const DEFAULT_LEASE_TTL_MS = 180_000;
export const ONBOARDING_POLICY = 'onboarding';

// SIGKILLs this process when AVARICE_FAULT names the point (test-only fault injection, no cleanup runs).
export function faultPoint(name: string): void {
  if (process.env['AVARICE_FAULT'] === name) process.kill(process.pid, 'SIGKILL');
}

export function leaseTtlMs(): number {
  const raw = Number(process.env['AVARICE_LEASE_TTL_MS']);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_LEASE_TTL_MS;
}

export interface StartRequest {
  repoPath: string;
  policy: string;
  mode?: string;
  promote?: string;
  budgetOverrides?: Readonly<Record<string, unknown>>;
}

// Registers the project and creates the onboarding in `discovered`. Takes no lease.
export function startOnboarding(deps: AppDeps, request: StartRequest): Result<Registered> {
  if (request.policy !== ONBOARDING_POLICY) {
    return err({ kind: 'invalid', field: 'policy', reason: `onboarding runs under the "${ONBOARDING_POLICY}" policy, not ${JSON.stringify(request.policy)}` });
  }
  const registered = registerAndPreflight(deps, {
    repoPath: request.repoPath,
    policy: request.policy,
    mode: request.mode ?? 'full',
    promote: request.promote ?? 'none',
    budgetOverrides: request.budgetOverrides ?? {},
  });
  if (!registered.ok) return registered;
  faultPoint('after-transition:discovered');
  faultPoint('after-checkpoint:compile-contract');
  return registered;
}

export interface OnboardingOutcome {
  onboardingId: string;
  state: OnboardingState;
  reason: BlockedReason | null;
  // Why the run stopped, when a stage said so.
  message: string | null;
}

export function makeContext(deps: AppDeps, onboardingId: string, fence: number, notes: string[]): StageContext {
  return {
    deps,
    onboardingId,
    fence,
    checkpoint(nextAction, extra) {
      const checkpoint = deps.ledger.recordCheckpoint(
        onboardingId,
        { fence },
        { nextAction, nowMs: deps.clock.nowMs(), ...(extra?.stagingWorktree !== undefined ? { stagingWorktree: extra.stagingWorktree } : {}) },
      );
      if (checkpoint.ok) faultPoint('after-checkpoint:' + nextAction);
      return checkpoint;
    },
    transition(row: OnboardingRow, to: OnboardingState, nextAction: string, options: TransitionOptions = {}) {
      const moved = deps.ledger.transitionOnboarding(
        onboardingId,
        { version: row.version, fence },
        {
          to,
          nextAction,
          nowMs: deps.clock.nowMs(),
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          ...(options.stagingWorktree !== undefined ? { stagingWorktree: options.stagingWorktree } : {}),
          ...(options.data !== undefined ? { data: options.data } : {}),
        },
      );
      if (moved.ok) {
        faultPoint('after-transition:' + to);
        faultPoint('after-checkpoint:' + nextAction);
      }
      return moved;
    },
    activate(row, body) {
      const activated = deps.ledger.insertRecordAndActivate(onboardingId, { version: row.version, fence }, { body, nowMs: deps.clock.nowMs() });
      if (activated.ok) faultPoint('after-transition:active');
      return activated;
    },
    note(message) {
      notes.push(message);
    },
  };
}

// `planning_ready`: the index steps (plan 01-14), then activation.
const planningReadyStage: Stage = async (ctx, row) => {
  const indexed = await indexStage(ctx, row);
  if (!indexed.ok) return indexed;
  return activateStage(ctx, row);
};

const STAGES: Readonly<Partial<Record<OnboardingState, Stage>>> = {
  discovered: contractStage,
  contract_proposed: workspaceStage,
  mapping: mapStage,
  validating: validateStage,
  validation_failed: retryOrBlockStage,
  planning_ready: planningReadyStage,
};

function holderId(deps: AppDeps): string {
  return `${hostname()}:${process.pid}:${deps.ids.next('onb_').slice('onb_'.length)}`;
}

export interface RunOptions {
  // Runs once under the lease, before the stage loop (resume reconciles an interrupted invocation here).
  prelude?: (ctx: StageContext) => Promise<Result<void>> | Result<void>;
}

// Takes the lease (a free one, or one whose expiry has passed), renews it every ttl/3 while stages run,
// loops the stages until a stop state, and releases the lease on the way out.
export async function runOnboarding(deps: AppDeps, onboardingId: string, options: RunOptions = {}): Promise<Result<OnboardingOutcome>> {
  const holder = holderId(deps);
  const ttl = leaseTtlMs();
  const grant = deps.ledger.acquireLease(onboardingId, holder, ttl, deps.clock.nowMs());
  if (!grant.ok) return grant;
  const fence = grant.value.fence;
  const notes: string[] = [];
  const ctx = makeContext(deps, onboardingId, fence, notes);

  // A stage that waits on the host does not return to the loop, so a timer keeps the lease alive. A failed
  // renewal means another process took over; the loop stops at its next check.
  const lease: { lost: PortError | null } = { lost: null };
  const timer = setInterval(() => {
    const renewed = deps.ledger.renewLease(onboardingId, holder, fence, ttl, deps.clock.nowMs());
    if (!renewed.ok) {
      lease.lost = renewed.error;
      clearInterval(timer);
    }
  }, Math.max(1, Math.floor(ttl / 3)));
  timer.unref();

  try {
    if (options.prelude !== undefined) {
      const prepared = await options.prelude(ctx);
      if (!prepared.ok) return prepared;
    }
    for (;;) {
      if (lease.lost !== null) return err(lease.lost);
      const current = deps.ledger.getOnboarding(onboardingId);
      if (!current.ok) return current;
      const row = current.value;
      const stage = isStopState(row.state) ? undefined : STAGES[row.state];
      if (stage === undefined) {
        return ok({ onboardingId, state: row.state, reason: row.reason, message: notes.at(-1) ?? null });
      }

      const renewed = deps.ledger.renewLease(onboardingId, holder, fence, ttl, deps.clock.nowMs());
      if (!renewed.ok) return renewed;
      const ran = await stage(ctx, row);
      if (!ran.ok) return ran;

      // A stage that returns without moving the onboarding would loop forever.
      const after = deps.ledger.getOnboarding(onboardingId);
      if (!after.ok) return after;
      if (after.value.state === row.state && after.value.version === row.version) {
        return err({ kind: 'internal', cause: `the ${row.state} stage made no progress` });
      }
    }
  } finally {
    clearInterval(timer);
    deps.ledger.releaseLease(onboardingId, holder, fence);
  }
}
