// Amending a run's contract (plan 03-15; RC-6, D-17, D-19, D-20). `planAmendment` reads the run, its latest contract and the evidence and gate
// rows, asks the domain for contract version n+1, its field-level diff and what it invalidates, and returns a plan that changes nothing.
// `commitAmendment` writes the plan in the ledger's one transaction and then writes the contract file of the new version. The caller (the amend
// command, from a terminal outside the run) shows the plan and asks the owner between the two; nothing here asks, and nothing here is reachable
// from a contained invocation.
import { applyAmendment, budgetRowChanges, staleTargets } from '../domain/amendment.ts';
import type { FieldDiff, InvalidationClass } from '../domain/amendment.ts';
import { canonicalJson, digestOf } from '../domain/digest.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isRunTerminal } from '../domain/run-lifecycle.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { AppDeps } from './deps.ts';
import { writeContractFile } from './run-start.ts';

// What the owner asked for. Every field but the reason is optional; at least one change must be named.
export interface AmendRequest {
  // `--budget name=value`, validated by the domain: any finite value above 0, up or down (D-19).
  budgets?: Readonly<Record<string, number>>;
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
  reason: string;
}

export interface AmendOutcome {
  version: number;
  staleEvidence: number;
  staleGates: number;
  contractPath: string;
}

// The contract the ledger holds for the run, read back as the compiler wrote it.
function storedContract(body: unknown, version: number): Result<RunContract> {
  if (typeof body !== 'object' || body === null || (body as { contractVersion?: unknown }).contractVersion !== version) {
    return err({ kind: 'internal', cause: `the stored contract of version ${version} is not a run contract` });
  }
  return ok(body as RunContract);
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

  const amended = applyAmendment(
    current.value,
    { reason: request.reason, ...(request.budgets !== undefined ? { budgets: request.budgets } : {}) },
    { conventionsWrite: [], nowIso: new Date(deps.clock.nowMs()).toISOString() },
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
    reason: request.reason.trim(),
  });
}

// One ledger transaction (contract n+1, raised limits, stale rows), then the contract file. The ledger refuses a base version that moved
// and a run that ended, as `conflict`, and writes nothing then. A file that cannot be written after the commit leaves the amendment recorded;
// the supervisor writes the latest version's file from the ledger before it launches anything.
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
  return ok({ version: written.value.contract.version, staleEvidence: written.value.staleEvidence, staleGates: written.value.staleGates, contractPath });
}
