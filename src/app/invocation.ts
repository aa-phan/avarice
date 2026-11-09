// Shared invocation preparation and completion for every purpose that runs the contained host (map, and later intel
// and knowledge). prepareInvocation computes the vendor-neutral scope from the stored contract, the staging layout and
// GSD's read roots, reserves the invocation's budget, picks the session ID, and records step `launch:{purpose}`
// (status `started`, with the invocation and session IDs) before the request is returned, so a supervisor killed
// during the run leaves the ID a resume needs to find the process. completeInvocation settles the budget and
// records what the host reported: the step, the transcript artifact and the `invocation.finished` event.
//
// Events carry IDs, counts, cost and duration only (T-01-43): never transcript text, never a model's words.
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { INVOCATION_PURPOSES, PURPOSE_EXTENSIONS, computeInvocationScope, computeRunScope, runScopeDirs } from '../domain/invocation-scope.ts';
import type { InvocationScope } from '../domain/invocation-scope.ts';
import { RootRefusedError } from '../domain/normalized-root.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { InvocationOutcome, InvocationRequest, OnboardingPurpose } from '../ports/agent-host.ts';
import type { OnboardingRow, RunRow, StepResultInput } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { reserveInvocation, reserveRunInvocation, settleInvocation } from './budget.ts';
import type { InvocationReservation, SettlementCharge } from './budget.ts';
import { loadContract, stagingPathOf } from './stages/shared.ts';

const STORE = 'local';
const RETENTION = 'onboarding';
// Artifacts of a run's invocation live as long as the run (plan 02-12).
const RUN_RETENTION = 'run';
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

export function prepareInvocation(deps: AppDeps, onboarding: OnboardingRow, purpose: OnboardingPurpose, prompt: string, options: PrepareOptions): Result<PrepareOutcome> {
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
  // path (WR-01) by throwing a RootRefusedError, and a throw after the reservation would leave it unsettled. That refusal is a typed
  // `invalid` error here, so nothing was reserved, started or recorded. Any other throw is a defect, not a work-root problem: it
  // propagates with its stack (IN-04).
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
    if (!(cause instanceof RootRefusedError)) throw cause;
    return err({ kind: 'invalid', field: 'workRoot', reason: cause.message });
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
// nothing ran (it never started) is not a kill. An ending with no result event (a crash: a non-zero exit, or an exit 0 that printed no
// result) reports no cost, so what it cost is unknown, as for a kill, and it is charged its reservation too.
function wasKilled(outcome: Result<InvocationOutcome>): boolean {
  if (!outcome.ok) {
    const e = outcome.error;
    return (e.kind === 'timeout' || e.kind === 'cancelled') && e.sideEffect === 'unknown';
  }
  const d = outcome.value.details;
  return d !== undefined && (d.timedOut || d.signal !== null || d.resultSeen === false);
}

// What differs between an onboarding's invocation and a run's when it ends: where the step is written, how long the transcript is
// kept, and which IDs the step result and the `invocation.finished` event carry. Everything else is one code path.
interface FinishTarget {
  prepared: PreparedInvocation;
  recordStep(input: StepResultInput): Result<unknown>;
  retention: string;
  // Added to the step result (IDs only).
  stepExtras: Readonly<Record<string, unknown>>;
  // The first keys of the event data, naming the owner (IDs only).
  eventOwner: Readonly<Record<string, unknown>>;
  attemptId?: string;
}

// Settles the budget and records the invocation whatever happened: the invocation ran, so its unit, its time and its
// cost are spent. The host's own error is returned unchanged for the stage to decide on.
function finishInvocation(deps: AppDeps, target: FinishTarget, outcome: Result<InvocationOutcome>): Result<InvocationOutcome> {
  const { request, reservation, attempt, startedMs, step } = target.prepared;
  const settled = settleInvocation(deps, reservation, {
    durationMs: outcome.ok ? outcome.value.durationMs : deps.clock.nowMs() - startedMs,
    costUsd: outcome.ok ? outcome.value.costUsd : 0,
    killed: wasKilled(outcome),
  });
  if (!settled.ok) return settled;
  const charge: SettlementCharge = settled.value;

  if (!outcome.ok) {
    const failed = target.recordStep({
      step,
      attempt,
      status: 'failed',
      result: {
        invocationId: request.invocationId,
        sessionId: request.sessionId,
        ...target.stepExtras,
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
  const completed = target.recordStep({
    step,
    attempt,
    status: 'completed',
    result: {
      invocationId: request.invocationId,
      sessionId: o.sessionId,
      ...target.stepExtras,
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
      retention: target.retention,
      store: STORE,
      nowMs: deps.clock.nowMs(),
    });
    if (!artifact.ok) return artifact;
  }

  const d = o.details;
  const event = deps.ledger.appendEvent({
    type: 'invocation.finished',
    runId: request.runId,
    ...(target.attemptId !== undefined ? { attemptId: target.attemptId } : {}),
    invocationId: request.invocationId,
    data: {
      ...target.eventOwner,
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

export function completeInvocation(deps: AppDeps, prepared: PreparedInvocation, outcome: Result<InvocationOutcome>): Result<InvocationOutcome> {
  return finishInvocation(
    deps,
    {
      prepared,
      recordStep: (input) => deps.ledger.recordStepResult(prepared.request.onboardingId, input),
      retention: RETENTION,
      stepExtras: {},
      eventOwner: { onboardingId: prepared.request.onboardingId },
    },
    outcome,
  );
}

// ---- runs (plan 02-12) -------------------------------------------------------------------------------

export interface PreparedRunInvocation extends PreparedInvocation {
  attemptId: string;
  itemId: string;
}

export type PrepareRunOutcome = { granted: true; prepared: PreparedRunInvocation } | { granted: false; budget: string };

export interface PrepareRunOptions {
  // The attempt (CON-16 ordinal) and the work item this invocation serves.
  attemptId: string;
  itemId: string;
  // The session ID of the invocation when the caller chose it first (it records it on the work item when it delegates it, D-08); a fresh one otherwise.
  sessionId?: string;
  // Clone-relative files the invocation is expected to leave; none by default (a run is judged from the clone, not from a file list).
  expectedFiles?: readonly string[];
}

// The directories of the GSD install the run reads: the `gsd:inspect` step when a stage recorded one, else what the GSD adapter reports now.
function gsdDirsOf(deps: AppDeps, runId: string): Result<{ gsdCoreDir: string; agentsDir: string }> {
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return steps;
  const inspected = [...steps.value].reverse().find((s) => s.step === 'gsd:inspect' && s.status === 'completed')?.result;
  if (isObject(inspected) && typeof inspected['gsdCoreDir'] === 'string' && typeof inspected['agentsDir'] === 'string') {
    return ok({ gsdCoreDir: inspected['gsdCoreDir'], agentsDir: inspected['agentsDir'] });
  }
  const snapshot = deps.gsd?.inspect();
  if (snapshot?.ok) return ok({ gsdCoreDir: snapshot.value.gsdCoreDir, agentsDir: snapshot.value.agentsDir });
  return err({ kind: 'internal', cause: `run ${runId} has no gsd:inspect step and no GSD adapter to ask for the gsd-core directories` });
}

// Every path the model is handed is the symlink-resolved form (the 02-01 carried finding: the host refuses a write addressed through
// /var when the rules name /private/var); a path that does not exist yet stays as it is.
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// The run counterpart of prepareInvocation: the run scope from the stored contract and the clone, the reservation from the run's own
// budget rows, and step `launch:run` recorded as `started` (with the invocation, session and attempt IDs) before the request is returned.
export function prepareRunInvocation(deps: AppDeps, run: RunRow, prompt: string, options: PrepareRunOptions): Result<PrepareRunOutcome> {
  const stored = deps.ledger.getRunContract(run.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${run.runId} has no stored contract` });
  const contract = stored.value.body as RunContract;
  if (run.workspacePath === null) return err({ kind: 'internal', cause: `run ${run.runId} has no workspace recorded` });
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const items = deps.ledger.listWorkItems(run.runId);
  if (!items.ok) return items;
  const item = items.value.find((i) => i.itemId === options.itemId);
  if (item === undefined) return err({ kind: 'not_found', ref: `work item ${options.itemId} of run ${run.runId}` });
  const attempts = deps.ledger.listRunAttempts(run.runId);
  if (!attempts.ok) return attempts;
  if (!attempts.value.some((a) => a.attemptId === options.attemptId)) return err({ kind: 'invalid', field: 'attemptId', reason: `${options.attemptId} is not an attempt of run ${run.runId}` });
  const dirs = gsdDirsOf(deps, run.runId);
  if (!dirs.ok) return dirs;
  const project = deps.ledger.findProject({ projectId: run.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'internal', cause: `run ${run.runId} names an unknown project` });

  const steps = deps.ledger.getRunSteps(run.runId);
  if (!steps.ok) return steps;
  const step = 'launch:run';
  const attempt = steps.value.filter((s) => s.step === step).length + 1;

  const clone = canonical(run.workspacePath);
  const described = workspace.describe(clone, runScopeDirs(contract.files));
  if (!described.ok) return described;
  // The scratch directory (TMPDIR and the npm cache) is made by AVARICE, beside the clone, owner only. The host's TMPDIR (`scratch/tmp`) and the
  // npm cache (`scratch/npm-cache`) must exist before it starts: the host listens on a unix socket in its TMPDIR when its sandbox initializes, so
  // a missing directory leaves every Bash call failing `Sandbox is required but failed to initialize` (plan 02-20, first live run).
  const scratchParent = join(deps.profile.workRoot, run.runId);
  try {
    for (const name of ['tmp', 'npm-cache']) mkdirSync(join(scratchParent, 'scratch', name), { recursive: true, mode: 0o700 });
  } catch (cause) {
    return err({ kind: 'internal', cause: `the scratch directory of run ${run.runId} could not be created: ${cause instanceof Error ? cause.message : String(cause)}` });
  }

  // As prepareInvocation: the scope is computed before the budget is reserved, so a refused root leaves nothing reserved.
  let scope: InvocationScope;
  try {
    scope = computeRunScope({
      contract,
      clonePath: clone,
      repoPath: canonical(project.value.repoPath),
      dataRoot: canonical(deps.profile.dataRoot),
      home: canonical(deps.home ?? homedir()),
      workRoot: canonical(deps.profile.workRoot),
      scratchDir: join(canonical(scratchParent), 'scratch'),
      workspace: described.value,
      readRoots: [canonical(dirs.value.gsdCoreDir), canonical(dirs.value.agentsDir)],
    });
  } catch (cause) {
    if (!(cause instanceof RootRefusedError)) throw cause;
    return err({ kind: 'invalid', field: 'workRoot', reason: cause.message });
  }

  // Reserve before anything is launched: with no invocation, wall clock or cost left the run ends blocked (budget_exhausted) and the
  // host is never called (CON-13).
  const reserved = reserveRunInvocation(deps, run);
  if (!reserved.ok) return reserved;
  if (!reserved.value.granted) return ok({ granted: false, budget: reserved.value.budget });
  const reservation = reserved.value.reservation;

  const extensions = PURPOSE_EXTENSIONS.run;
  const request: InvocationRequest = {
    // A run has no onboarding: the host names the invocation's owner by `ownerKind` and `ownerId`, and the run ID stands in here.
    onboardingId: run.runId,
    runId: run.runId,
    invocationId: deps.ids.next('inv_'),
    purpose: 'run',
    contractVersion: stored.value.version,
    contractDigest: stored.value.digest,
    prompt,
    cwd: scope.cwd,
    model: item.model,
    costCapUsd: reservation.costCapUsd,
    wallClockMs: reservation.wallClockMs,
    scope,
    extensions: { skills: [...extensions.skills], agents: [...extensions.agents] },
    expectedFiles: [...(options.expectedFiles ?? [])],
    sessionId: options.sessionId ?? randomUUID(),
    ownerKind: 'run',
    ownerId: run.runId,
  };

  const startedMs = deps.clock.nowMs();
  const started = deps.ledger.recordRunStep(run.runId, {
    step,
    attempt,
    status: 'started',
    result: { invocationId: request.invocationId, sessionId: request.sessionId, purpose: 'run', attemptId: options.attemptId, itemId: options.itemId, model: item.model },
    nowMs: startedMs,
  });
  if (!started.ok) return started;
  return ok({ granted: true, prepared: { request, reservation, attempt, startedMs, step, attemptId: options.attemptId, itemId: options.itemId } });
}

// The run counterpart of completeInvocation: the same settlement and records, kept for the life of the run, and an event that names the
// run, the attempt and the invocation.
export function completeRunInvocation(deps: AppDeps, prepared: PreparedRunInvocation, outcome: Result<InvocationOutcome>): Result<InvocationOutcome> {
  const { request, attemptId, itemId } = prepared;
  return finishInvocation(
    deps,
    {
      prepared,
      recordStep: (input) => deps.ledger.recordRunStep(request.runId, input),
      retention: RUN_RETENTION,
      // The model the invocation was launched with (its item's, D-10), on the step and on the event: a run's model use is traceable per invocation.
      stepExtras: { attemptId, itemId, model: request.model },
      eventOwner: { runId: request.runId, attemptId, itemId, model: request.model },
      attemptId,
    },
    outcome,
  );
}
