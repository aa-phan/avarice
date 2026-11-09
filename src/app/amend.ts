// Amending a run's contract (plan 03-15; RC-6, D-17, D-19, D-20). `planAmendment` reads the run, its latest contract and the evidence and gate
// rows, asks the domain for contract version n+1, its field-level diff and what it invalidates, and returns a plan that changes nothing.
// `commitAmendment` writes the plan in the ledger's one transaction and then writes the contract file of the new version. The caller (the amend
// command, from a terminal outside the run) shows the plan and asks the owner between the two; nothing here asks, and nothing here is reachable
// from a contained invocation.
import { applyAmendment, budgetRowChanges, staleTargets } from '../domain/amendment.ts';
import type { FieldDiff, InvalidationClass } from '../domain/amendment.ts';
import { parseConventions } from '../domain/conventions.ts';
import { canonicalJson, digestOf } from '../domain/digest.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isRunTerminal } from '../domain/run-lifecycle.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { AppDeps } from './deps.ts';
import { describeError, writeContractFile } from './run-start.ts';

// What the owner asked for. Every field but the reason is optional; at least one change must be named.
export interface AmendRequest {
  // `--budget name=value`, validated by the domain: any finite value above 0, up or down (D-19).
  budgets?: Readonly<Record<string, number>>;
  // `--add-write glob`: inside the write set of the repository conventions and off the protected globs.
  addWrite?: readonly string[];
  // `--check +name` and `--check -name`.
  checks?: ReadonlyArray<{ op: '+' | '-'; name: string }>;
  // The text of `--acceptance-file`, and `--item` for a criterion the contract does not have yet.
  acceptance?: { text: string; item?: string };
  // `--decision`: an open decision this amendment answers (`amended:v<n+1>`).
  decisionId?: string;
  reason: string;
}

export interface AmendmentPlan {
  runId: string;
  // The contract version the plan was computed from; the ledger re-checks it inside its transaction.
  baseVersion: number;
  // The version the amendment writes.
  version: number;
  contract: RunContract;
  diff: FieldDiff[];
  invalidates: InvalidationClass[];
  // The budget rows whose limit changes, by ledger row name.
  budgetChanges: Array<{ name: string; limit: number }>;
  // Evidence rows and gates that get a stale row appended under the new version.
  staleEvidenceIds: string[];
  staleGates: string[];
  resolvesDecisionId?: string;
  reason: string;
}

export interface AmendOutcome {
  version: number;
  staleEvidence: number;
  staleGates: number;
  // The decision the amendment answered, when it named one.
  resolvedDecisionId: string | null;
  contractPath: string;
}

// An amendment answers these decision classes (the ledger refuses any other). The rest need the owner's own answer.
const RESOLVABLE_DECISION_CLASSES: readonly string[] = ['repeated_failure', 'permission', 'budget', 'scope_expansion'];

// The contract the ledger holds for the run, read back as the compiler wrote it.
function storedContract(body: unknown, version: number): Result<RunContract> {
  if (typeof body !== 'object' || body === null || (body as { contractVersion?: unknown }).contractVersion !== version) {
    return err({ kind: 'internal', cause: `the stored contract of version ${version} is not a run contract` });
  }
  return ok(body as RunContract);
}

// The write globs of the repository conventions the run was compiled against, read from git objects at the contract's conventions revision
// (D-04, D-16): an uncommitted edit of the conventions cannot widen a run.
function conventionsWriteSet(deps: AppDeps, projectId: string, contract: RunContract): Result<string[]> {
  if (deps.runSource === undefined) return err({ kind: 'internal', cause: 'the run source is not composed' });
  const projects = deps.ledger.listProjects();
  if (!projects.ok) return projects;
  const project = projects.value.find((p) => p.projectId === projectId);
  if (project === undefined) return err({ kind: 'internal', cause: `project ${projectId} is not registered` });
  const { baseRevision, conventionsRevision } = contract.workspace;
  const at = deps.runSource.conventionsAt(project.repoPath, baseRevision, conventionsRevision);
  if (!at.ok) {
    return err({ kind: 'unavailable', cause: `the repository conventions at ${conventionsRevision.slice(0, 7)} cannot be read: ${describeError(at.error)}` });
  }
  const parsed = parseConventions(at.value.text);
  if (!parsed.ok) {
    return err({ kind: 'unavailable', cause: `the repository conventions at ${conventionsRevision.slice(0, 7)} are invalid: ${describeError(parsed.error)}` });
  }
  return ok([...parsed.value.paths.write]);
}

// The decision must be an open one of this run, of a class an amendment can answer. Unknown or of another run is `invalid`; one that is no
// longer open is `conflict`, as the ledger reports it.
function checkDecision(deps: AppDeps, runId: string, decisionId: string): Result<void> {
  const listed = deps.ledger.listDecisions({ runId });
  if (!listed.ok) return listed;
  const found = listed.value.find((d) => d.decisionId === decisionId);
  if (found === undefined) return err({ kind: 'invalid', field: 'decision', reason: `${decisionId} is not a decision of run ${runId}` });
  if (found.state !== 'open') return err({ kind: 'conflict', expected: 'an open decision', actual: `${decisionId} is ${found.state}` });
  if (!RESOLVABLE_DECISION_CLASSES.includes(found.class)) {
    return err({
      kind: 'invalid',
      field: 'decision',
      reason: `${decisionId} is a ${found.class} decision: an amendment answers only ${RESOLVABLE_DECISION_CLASSES.join(', ')} decisions`,
    });
  }
  return ok(undefined);
}

export function planAmendment(deps: AppDeps, runId: string, request: AmendRequest): Result<AmendmentPlan> {
  const run = deps.ledger.getRun(runId);
  if (!run.ok) return run;
  if (isRunTerminal(run.value.state)) {
    return err({ kind: 'conflict', expected: 'a run that has not ended', actual: `run ${runId} is ${run.value.state}` });
  }
  const latest = deps.ledger.getRunContract(runId);
  if (!latest.ok) return latest;
  if (latest.value === null) return err({ kind: 'internal', cause: `run ${runId} has no stored contract` });
  const current = storedContract(latest.value.body, latest.value.version);
  if (!current.ok) return current;

  if (request.decisionId !== undefined) {
    const decision = checkDecision(deps, runId, request.decisionId);
    if (!decision.ok) return decision;
  }
  // Only a write glob needs the conventions; a budget, check or acceptance amendment does not depend on the repository being readable.
  let conventionsWrite: string[] = [];
  if (request.addWrite !== undefined) {
    const read = conventionsWriteSet(deps, run.value.projectId, current.value);
    if (!read.ok) return read;
    conventionsWrite = read.value;
  }

  const amended = applyAmendment(
    current.value,
    {
      reason: request.reason,
      ...(request.budgets !== undefined ? { budgets: request.budgets } : {}),
      ...(request.addWrite !== undefined ? { addWrite: request.addWrite } : {}),
      ...(request.checks !== undefined ? { checks: request.checks } : {}),
      ...(request.acceptance !== undefined ? { acceptance: request.acceptance } : {}),
    },
    { conventionsWrite, nowIso: new Date(deps.clock.nowMs()).toISOString() },
  );
  if (!amended.ok) return amended;

  const evidence = deps.ledger.listEvidence(runId);
  if (!evidence.ok) return evidence;
  const gates = deps.ledger.listGateResults(runId);
  if (!gates.ok) return gates;
  const stale = staleTargets(
    amended.value.invalidates,
    evidence.value.map((row) => ({ evidenceId: row.evidenceId, kind: row.kind, contractVersion: row.contractVersion, status: row.status, acceptance: row.acceptance })),
    gates.value.map((row) => ({ gate: row.gate, passed: row.passed })),
  );

  return ok({
    runId,
    baseVersion: latest.value.version,
    version: amended.value.contract.contractVersion,
    contract: amended.value.contract,
    diff: amended.value.diff,
    invalidates: amended.value.invalidates,
    budgetChanges: budgetRowChanges(amended.value.diff, amended.value.contract).map((row) => ({ name: row.name, limit: row.limit })),
    staleEvidenceIds: stale.evidenceIds,
    staleGates: stale.gates,
    ...(request.decisionId !== undefined ? { resolvesDecisionId: request.decisionId } : {}),
    reason: request.reason.trim(),
  });
}

// One ledger transaction (contract n+1, raised limits, stale rows, the decision it answers), then the contract file. The ledger refuses a base
// version that moved, a run that ended and a decision that is no longer open, as `conflict`, and writes nothing then. A file that cannot be
// written after the commit leaves the amendment recorded; the supervisor writes the latest version's file from the ledger before it launches
// anything.
export function commitAmendment(deps: AppDeps, plan: AmendmentPlan, authorizedBy: string, nowMs: number): Result<AmendOutcome> {
  const detail = `amended to contract v${plan.version}: ${plan.invalidates.join(', ')}`;
  const written = deps.ledger.amendRunContract({
    runId: plan.runId,
    expectVersion: plan.baseVersion,
    next: {
      body: plan.contract,
      digest: digestOf(plan.contract),
      policyRevision: plan.contract.policyRevision,
      diff: plan.diff,
      reason: plan.reason,
      authorizedBy,
    },
    budgetChanges: plan.budgetChanges,
    staleEvidenceIds: plan.staleEvidenceIds,
    staleGates: plan.staleGates.map((gate) => ({ gate, detail })),
    ...(plan.resolvesDecisionId !== undefined ? { resolvesDecisionId: plan.resolvesDecisionId } : {}),
    nowMs,
  });
  if (!written.ok) return written;
  let contractPath: string;
  try {
    contractPath = writeContractFile(deps.profile.dataRoot, plan.runId, canonicalJson(plan.contract), written.value.contract.version);
  } catch (e) {
    return err({
      kind: 'internal',
      cause: `contract v${written.value.contract.version} of run ${plan.runId} is recorded but its file could not be written: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return ok({
    version: written.value.contract.version,
    staleEvidence: written.value.staleEvidence,
    staleGates: written.value.staleGates,
    resolvedDecisionId: written.value.resolved?.decisionId ?? null,
    contractPath,
  });
}
