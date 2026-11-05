// Shared invocation preparation and completion for every purpose that runs the contained host (map, and later intel
// and knowledge). prepareInvocation computes the vendor-neutral scope from the stored contract, the staging layout and
// GSD's read roots, reserves the invocation's budget, picks the session ID, and records step `launch:{purpose}`
// (status `started`, with the invocation and session IDs) before the request is returned, so a supervisor killed
// during the run leaves the ID a resume needs to find the process. completeInvocation settles the budget and
// records what the host reported: the step, the transcript artifact and the `invocation.finished` event.
//
// Events carry IDs, counts, cost and duration only (T-01-43): never transcript text, never a model's words.
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { INVOCATION_PURPOSES, PURPOSE_EXTENSIONS, computeInvocationScope } from '../domain/invocation-scope.ts';
import type { InvocationScope } from '../domain/invocation-scope.ts';
import type { InvocationOutcome, InvocationPurpose, InvocationRequest } from '../ports/agent-host.ts';
import type { OnboardingRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { reserveInvocation, settleInvocation } from './budget.ts';
import type { InvocationReservation } from './budget.ts';
import { loadContract, stagingPathOf } from './stages/shared.ts';

const STORE = 'local';
const RETENTION = 'onboarding';
const MAX_RULE_CHARS = 200;

export interface PrepareOptions {
  // Named agent for the session (the intel seam).
  agentName?: string;
  // Staging-relative files the invocation is expected to leave.
  expectedFiles: readonly string[];
  // Subagent total for this invocation when lower than the contract's (the knowledge pass: one per 20 documents).
  subagentsTotal?: number;
}

export interface PreparedInvocation {
  request: InvocationRequest;
  reservation: InvocationReservation;
  // 1 for the first `launch:{purpose}` step, then counting up.
  attempt: number;
  startedMs: number;
  step: string;
}

// `budget` names the budget that stopped the reservation; nothing was started or recorded.
export type PrepareOutcome = { granted: true; prepared: PreparedInvocation } | { granted: false; budget: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function prepareInvocation(deps: AppDeps, onboarding: OnboardingRow, purpose: InvocationPurpose, prompt: string, options: PrepareOptions): Result<PrepareOutcome> {
  const contract = loadContract(deps, onboarding.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(onboarding);
  if (!staging.ok) return staging;

  // The directory the purpose writes is created by AVARICE, so the agent never has to create it.
  const dir = deps.staging.ensureDir(staging.value, INVOCATION_PURPOSES[purpose].writeDir);
  if (!dir.ok) return dir;

  const steps = deps.ledger.getStepResults(onboarding.onboardingId);
  if (!steps.ok) return steps;
  const step = `launch:${purpose}`;
  const attempt = steps.value.filter((s) => s.step === step).length + 1;

  // What GSD's inspect recorded: where the gsd-core and its agents live, both readable to the invocation.
  const inspected = steps.value.find((s) => s.step === 'gsd:inspect')?.result;
  const gsdCoreDir = isObject(inspected) ? inspected['gsdCoreDir'] : undefined;
  const agentsDir = isObject(inspected) ? inspected['agentsDir'] : undefined;
  if (typeof gsdCoreDir !== 'string' || typeof agentsDir !== 'string') {
    return err({ kind: 'internal', cause: `onboarding ${onboarding.onboardingId} has no gsd:inspect step with the gsd-core directories` });
  }

  const project = deps.ledger.findProject({ projectId: onboarding.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'internal', cause: `onboarding ${onboarding.onboardingId} names an unknown project` });
  const workspace = deps.staging.describe(staging.value, contract.value.body.workspace.baseRevision);
  if (!workspace.ok) return workspace;

  // The scope is computed before the budget is reserved: computeInvocationScope refuses a work root that is not a normalized absolute
  // path (WR-01) by throwing, and a throw after the reservation would leave it unsettled. A refusal is a typed `invalid` error here,
  // so nothing was reserved, started or recorded.
  let scope: InvocationScope;
  try {
    scope = computeInvocationScope({
      purpose,
      contract: contract.value.body,
      stagingPath: staging.value,
      repoPath: project.value.repoPath,
      dataRoot: deps.profile.dataRoot,
      workRoot: deps.profile.workRoot,
      home: deps.home ?? homedir(),
      workspace: workspace.value,
      // The scope drops them for the knowledge pass, which loads no skill and runs no GSD verb (decision B).
      readRoots: [gsdCoreDir, agentsDir],
      ...(options.subagentsTotal !== undefined ? { subagentsTotal: options.subagentsTotal } : {}),
    });
  } catch (cause) {
    return err({ kind: 'invalid', field: 'workRoot', reason: cause instanceof Error ? cause.message : String(cause) });
  }

  // Reserve the invocation before anything is launched: with no invocation, wall clock or cost left the onboarding
  // ends blocked (budget_exhausted) and the host is never called (ONB-8, CON-13).
  const reserved = reserveInvocation(deps, onboarding, purpose);
  if (!reserved.ok) return reserved;
  if (!reserved.value.granted) return ok({ granted: false, budget: reserved.value.budget });
  const reservation = reserved.value.reservation;

  const extensions = PURPOSE_EXTENSIONS[purpose];
  const request: InvocationRequest = {
    onboardingId: onboarding.onboardingId,
    runId: contract.value.runId,
    invocationId: deps.ids.next('inv_'),
    purpose,
    contractVersion: contract.value.version,
    contractDigest: contract.value.digest,
    prompt,
    cwd: scope.cwd,
    model: contract.value.body.execution.model,
    costCapUsd: reservation.costCapUsd,
    wallClockMs: reservation.wallClockMs,
    scope,
    extensions: { skills: [...extensions.skills], agents: [...extensions.agents] },
    ...(options.agentName !== undefined ? { agentName: options.agentName } : {}),
    expectedFiles: [...options.expectedFiles],
    sessionId: randomUUID(),
  };

  const startedMs = deps.clock.nowMs();
  const started = deps.ledger.recordStepResult(onboarding.onboardingId, {
    step,
    attempt,
    status: 'started',
    result: { invocationId: request.invocationId, sessionId: request.sessionId, purpose },
    nowMs: startedMs,
  });
  if (!started.ok) return started;
  return ok({ granted: true, prepared: { request, reservation, attempt, startedMs, step } });
}

const clip = (text: string): string => (text.length <= MAX_RULE_CHARS ? text : text.slice(0, MAX_RULE_CHARS));

// Whether the invocation was killed or interrupted, so what it cost is not known: the host's process ended by a signal or by our
// wall clock, or the host adapter reports a timeout or a cancel that may have left the process running. An error that says
// nothing ran (it never started) is not a kill.
function wasKilled(outcome: Result<InvocationOutcome>): boolean {
  if (!outcome.ok) {
    const e = outcome.error;
    return (e.kind === 'timeout' || e.kind === 'cancelled') && e.sideEffect === 'unknown';
  }
  const d = outcome.value.details;
  return d !== undefined && (d.timedOut || d.signal !== null);
}

// Settles the budget and records the invocation whatever happened: the invocation ran, so its unit, its time and its
// cost are spent. The host's own error is returned unchanged for the stage to decide on.
export function completeInvocation(deps: AppDeps, prepared: PreparedInvocation, outcome: Result<InvocationOutcome>): Result<InvocationOutcome> {
  const { request, reservation, attempt, startedMs, step } = prepared;
  const settled = settleInvocation(deps, reservation, {
    durationMs: outcome.ok ? outcome.value.durationMs : deps.clock.nowMs() - startedMs,
    costUsd: outcome.ok ? outcome.value.costUsd : 0,
    killed: wasKilled(outcome),
  });
  if (!settled.ok) return settled;
  const charge = settled.value;

  if (!outcome.ok) {
    const failed = deps.ledger.recordStepResult(request.onboardingId, {
      step,
      attempt,
      status: 'failed',
      result: {
        invocationId: request.invocationId,
        sessionId: request.sessionId,
        error: outcome.error.kind,
        costChargedUsd: charge.chargedUsd,
        ...(outcome.error.kind === 'denied' ? { rule: clip(outcome.error.rule) } : {}),
      },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    return failed.ok ? outcome : failed;
  }

  const o = outcome.value;
  const completed = deps.ledger.recordStepResult(request.onboardingId, {
    step,
    attempt,
    status: 'completed',
    result: {
      invocationId: request.invocationId,
      sessionId: o.sessionId,
      kind: o.kind,
      costUsd: o.costUsd,
      costChargedUsd: charge.chargedUsd,
      durationMs: o.durationMs,
      headBefore: o.headBefore,
      headAfter: o.headAfter,
      permissionDenials: o.permissionDenials.length,
      ...(o.transcriptArtifact !== undefined ? { transcript: o.transcriptArtifact } : {}),
    },
    nowMs: startedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!completed.ok) return completed;

  if (o.transcriptArtifact !== undefined) {
    const artifact = deps.ledger.recordArtifact({
      digest: o.transcriptArtifact,
      size: o.details?.transcriptBytes ?? 0,
      kind: 'transcript',
      runId: request.runId,
      retention: RETENTION,
      store: STORE,
      nowMs: deps.clock.nowMs(),
    });
    if (!artifact.ok) return artifact;
  }

  const d = o.details;
  const event = deps.ledger.appendEvent({
    type: 'invocation.finished',
    runId: request.runId,
    invocationId: request.invocationId,
    data: {
      onboardingId: request.onboardingId,
      invocationId: request.invocationId,
      purpose: request.purpose,
      outcome: o.kind,
      // What the host reported, and what the budget was charged (the larger, for a killed run): both stay visible.
      costUsd: o.costUsd,
      costChargedUsd: charge.chargedUsd,
      costBasis: charge.basis,
      durationMs: o.durationMs,
      permissionDenials: o.permissionDenials.length,
      ...(d !== undefined
        ? {
            exitCode: d.exitCode,
            signal: d.signal,
            timedOut: d.timedOut,
            headMoved: d.headMoved,
            hookDenies: d.hookDenies,
            hookBudgetDenies: d.hookBudgetDenies,
            numTurns: d.numTurns,
            transcriptBytes: d.transcriptBytes,
            ...(d.subtype !== undefined ? { subtype: d.subtype } : {}),
            ...(d.terminalReason !== undefined ? { terminalReason: d.terminalReason } : {}),
            ...(d.subagentsSpawned !== undefined ? { subagents: d.subagentsSpawned } : {}),
          }
        : {}),
    },
    nowMs: deps.clock.nowMs(),
  });
  return event.ok ? outcome : event;
}
