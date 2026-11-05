// Stage for `verifying` (plan 02-13; FR-5, FR-6, AUT-7, RC-4, D-02): the final proof on the committed revision and the hand-off.
//
//   verify:checks  every required check (and every brief target) runs sandboxed at the clean commit; one evidence row each, plus the GSD
//                  verifier's verdict as `model-review` evidence that can never satisfy an acceptance criterion
//   gate:g4        G4 over facts AVARICE measured: one clean revision, every required check passed, every acceptance criterion mapped to
//                  passed deterministic evidence, a clean diff against the pin, no open decision, no budget over its limit
//   handoff:fetch  the run branch is fetched into the source as one new local ref (D-02); the run moves to `ready_for_review` only after
//                  a G4 row for exactly that commit is in the ledger (AUT-7)
//
// The delta against the baseline is the one the `baseline` action recorded at the pin (plan 02-14, D-12): a check that failed there and
// fails again is flagged `preExisting` and named in the hand-off, a check that passed there and fails now blocks.
import { baselineDelta, mapAcceptance, revisionOf } from '../../domain/evidence.ts';
import type { EvidenceRow } from '../../domain/evidence.ts';
import { evaluateG4 } from '../../domain/gates.ts';
import { matchesAny } from '../../domain/glob.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import type { PathChange } from '../../ports/run-workspace.ts';
import { preExistingAt, recordedBase, runRequiredChecks } from '../checks.ts';
import { faultPoint } from '../onboarding-service.ts';
import { blockRun } from './blocked.ts';
import type { RunStage } from './stage.ts';
import { sha256Hex } from '../../domain/digest.ts';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// G4's diff gate: every path the run branch changed against the pin is inside the contract, and none is an artifact or a protected path (D-17).
function diffGateClean(changes: readonly PathChange[], contract: RunContract): boolean {
  const g = contract.files;
  return changes.every((c) => {
    if (matchesAny(c.path, g.protected) || matchesAny(c.path, g.artifacts)) return false;
    if (c.status === 'modified') return matchesAny(c.path, g.write);
    if (c.status === 'added') return matchesAny(c.path, g.create);
    return matchesAny(c.path, g.delete);
  });
}

export const verifyingStage: RunStage = async (ctx, row) => {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  if (row.workspacePath === null || row.branch === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no workspace recorded` });
  const clone = row.workspacePath;

  const stored = deps.ledger.getRunContract(ctx.runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${ctx.runId} has no stored contract` });
  const contract = stored.value.body as RunContract;
  const contractVersion = stored.value.version;

  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const attempt = attempts.value.at(-1);
  if (attempt === undefined) return err({ kind: 'internal', cause: `run ${ctx.runId} is verifying but has no attempt` });
  const attemptId = attempt.attemptId;
  const itemId = 'A';

  const head = workspace.head(clone);
  if (!head.ok) return head;
  const revision = `git:${head.value}`;

  const steps = deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const handedOff = steps.value.some((s) => s.step === 'handoff:fetch' && s.status === 'completed' && isObject(s.result) && s.result['commit'] === head.value);
  const gates = deps.ledger.listGateResults(ctx.runId);
  if (!gates.ok) return gates;
  const passedG4 = gates.value.some((g) => g.gate === 'G4' && g.passed && g.revision === revision);

  if (!handedOff && !passedG4) {
    const verified = await verifyAndGate(ctx, row, { contract, contractVersion, clone, attemptId, itemId, head: head.value, revision });
    if (verified === 'blocked') return ok(undefined);
    if (!verified.ok) return verified;
  }
  return handoff(ctx, row, { contract, clone, attemptId, itemId, head: head.value, revision, branch: row.branch, done: handedOff });
};

interface Final {
  contract: RunContract;
  contractVersion: number;
  clone: string;
  attemptId: string;
  itemId: string;
  head: string;
  revision: string;
}

type Verified = Result<void> | 'blocked';

async function verifyAndGate(ctx: Parameters<RunStage>[0], row: Parameters<RunStage>[1], f: Final): Promise<Verified> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  const marked = ctx.checkpoint('verify:checks', { attemptId: f.attemptId, itemId: f.itemId, revision: f.revision });
  if (!marked.ok) return marked;
  const base = recordedBase(deps, ctx.runId);
  if (!base.ok) return base;
  const ran = await runRequiredChecks(deps, row, f.contract, {
    cwd: f.clone,
    attemptId: f.attemptId,
    phase: 'final',
    contractVersion: f.contractVersion,
    itemId: f.itemId,
    base: base.value,
    afterEach: (index) => {
      if (index === 0) faultPoint('mid-verify');
    },
  });
  if (!ran.ok) return ran;

  // The GSD verifier's verdict is evidence of kind gsd-verdict and independence model-review: it is stored, and it never maps an acceptance.
  const steps = deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const classified = [...steps.value].reverse().find((s) => s.step === 'classify' && s.status === 'completed' && isObject(s.result) && s.result['attemptId'] === f.attemptId);
  const verdict = isObject(classified?.result) ? classified.result['verification'] : undefined;
  const tree = workspace.snapshot(f.clone);
  if (!tree.ok) return tree;
  const clean = workspace.status(f.clone);
  if (!clean.ok) return clean;
  const treeDigest = sha256Hex(`git-tree:${tree.value.tree}`);
  const verdictRevision = revisionOf({ head: f.head, clean: clean.value.length === 0, treeDigest });
  if (!verdictRevision.ok) return verdictRevision;
  const verdictRow = deps.ledger.recordEvidence({
    attemptId: f.attemptId,
    workItem: f.itemId,
    kind: 'gsd-verdict',
    name: 'gsd-verification',
    status: verdict === 'passed' ? 'passed' : 'failed',
    revision: verdictRevision.value,
    clean: clean.value.length === 0,
    treeDigest,
    environment: { kind: f.contract.execution.environment, source: 'gsd-quick VERIFICATION frontmatter' },
    contractVersion: f.contractVersion,
    policyRevision: f.contract.policyRevision,
    independence: 'model-review',
    acceptance: [],
    nowMs: deps.clock.nowMs(),
  });
  if (!verdictRow.ok) return verdictRow;

  const checking = ctx.checkpoint('gate:g4', { attemptId: f.attemptId, itemId: f.itemId, revision: f.revision });
  if (!checking.ok) return checking;

  const evidence = deps.ledger.listEvidence(ctx.runId);
  if (!evidence.ok) return evidence;
  const atFinal = evidence.value.filter((e) => e.revision === verdictRevision.value);
  const rows: EvidenceRow[] = atFinal.map((e) => ({
    evidenceId: e.evidenceId,
    kind: e.kind as EvidenceRow['kind'],
    name: e.name,
    status: e.status,
    independence: e.independence,
    ...(isObject(e.environment) && e.environment['preExisting'] === true ? { preExisting: true } : {}),
  }));
  const delta = baselineDelta({
    base: base.value,
    head: ran.value.map((r) => ({ name: r.name, status: r.status, evidenceId: r.evidenceId })),
    required: f.contract.verification.requiredChecks,
    targets: f.contract.verification.targetChecks,
  });
  const acceptance = mapAcceptance(f.contract.intent.acceptance, { rows, passedTestIds: [] });

  const diff = workspace.diffCommits(f.clone, f.contract.workspace.baseRevision, f.head);
  if (!diff.ok) return diff;
  const open = deps.ledger.listDecisions({ runId: ctx.runId, state: 'open' });
  if (!open.ok) return open;
  const budgets = deps.ledger.getBudgets(ctx.runId);
  if (!budgets.ok) return budgets;

  const requiredNames = new Set(f.contract.verification.requiredChecks);
  const verdictG4 = evaluateG4({
    revision: verdictRevision.value,
    blocking: delta.blocking,
    acceptance,
    requiredEvidence: ran.value.filter((r) => requiredNames.has(r.name)).map((r) => ({ name: r.name, status: r.status })),
    diffGateClean: diffGateClean(diff.value, f.contract),
    openDecisions: open.value.length,
    budgetsExceeded: budgets.value.filter((b) => b.used > b.limit).map((b) => b.name),
  });
  const gate = deps.ledger.recordGateResult({
    runId: ctx.runId,
    gate: 'G4',
    attemptId: f.attemptId,
    contractVersion: f.contractVersion,
    policyRevision: f.contract.policyRevision,
    revision: verdictRevision.value,
    passed: verdictG4.passed,
    failures: verdictG4.failures,
    nowMs: deps.clock.nowMs(),
  });
  if (!gate.ok) return gate;

  if (!verdictG4.passed) {
    const blockingNames = new Set(delta.blocking.map((b) => b.name));
    const failing = ran.value.filter((r) => r.status !== 'passed' && blockingNames.has(r.name)).map((r) => r.evidenceId);
    const blocked = blockRun(ctx, {
      reason: 'decision',
      decisionClass: 'repeated_failure',
      issue: `gate G4 failed: ${verdictG4.failures.map((x) => x.detail).join('; ')}`,
      evidenceRefs: failing,
      attemptId: f.attemptId,
      itemId: f.itemId,
      data: { gate: 'G4', rules: verdictG4.failures.map((x) => x.rule).join(',') },
    });
    return blocked.ok ? 'blocked' : blocked;
  }
  return ok(undefined);
}

interface Handoff {
  contract: RunContract;
  clone: string;
  attemptId: string;
  itemId: string;
  head: string;
  revision: string;
  branch: string;
  done: boolean;
}

async function handoff(ctx: Parameters<RunStage>[0], row: Parameters<RunStage>[1], h: Handoff): Promise<Result<void>> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const project = deps.ledger.findProject({ projectId: row.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'not_found', ref: `project ${row.projectId}` });

  if (!h.done) {
    const marked = ctx.checkpoint('handoff:fetch', { attemptId: h.attemptId, itemId: h.itemId, revision: h.revision });
    if (!marked.ok) return marked;
    const startedMs = deps.clock.nowMs();
    const fetched = workspace.fetchIntoSource({ repoPath: project.value.repoPath, clonePath: h.clone, branch: h.branch });
    if (!fetched.ok) {
      if (fetched.error.kind === 'conflict') {
        const blocked = blockRun(ctx, {
          reason: 'decision',
          decisionClass: 'scope_expansion',
          issue: `the source already has ${h.branch} at another commit, so the run branch was not handed off; the ref was left as it is`,
          attemptId: h.attemptId,
          itemId: h.itemId,
          data: { gate: 'handoff', branch: h.branch },
        });
        return blocked.ok ? ok(undefined) : blocked;
      }
      return fetched;
    }
    if (fetched.value.commit !== h.head) return err({ kind: 'internal', cause: `the hand-off carried ${fetched.value.commit}, not the verified commit ${h.head}` });
    const attemptOrdinal = deps.ledger.listRunAttempts(ctx.runId);
    const ordinal = attemptOrdinal.ok ? (attemptOrdinal.value.find((a) => a.attemptId === h.attemptId)?.ordinal ?? 1) : 1;
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: 'handoff:fetch',
      attempt: ordinal,
      status: 'completed',
      result: { attemptId: h.attemptId, branch: h.branch, commit: fetched.value.commit, created: fetched.value.created },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!recorded.ok) return recorded;
    const event = deps.ledger.appendEvent({
      type: 'handoff.fetched',
      runId: ctx.runId,
      attemptId: h.attemptId,
      data: { runId: ctx.runId, attemptId: h.attemptId, branch: h.branch, commit: fetched.value.commit, created: fetched.value.created },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
    faultPoint('mid-handoff');
  }

  // AUT-7: nothing but a passed G4 row for exactly this commit moves the run to ready_for_review.
  const gates = deps.ledger.listGateResults(ctx.runId);
  if (!gates.ok) return gates;
  if (!gates.value.some((g) => g.gate === 'G4' && g.passed && g.revision === h.revision)) {
    return err({ kind: 'internal', cause: `no passed G4 row for ${h.revision}: the run is not moved to ready_for_review` });
  }
  const ended = deps.ledger.endRunAttempt(h.attemptId, { outcome: 'handed-off', nowMs: deps.clock.nowMs() });
  if (!ended.ok && ended.error.kind !== 'conflict') return ended;
  const current = deps.ledger.getRun(ctx.runId);
  if (!current.ok) return current;
  // T-02-48: a check that was already failing at the pin is named in the hand-off, never hidden behind a green result.
  const preExisting = preExistingAt(deps, ctx.runId, h.revision);
  if (!preExisting.ok) return preExisting;
  const moved = ctx.transition(current.value, 'ready_for_review', 'none', {
    attemptId: h.attemptId,
    itemId: h.itemId,
    revision: h.revision,
    data: { branch: h.branch, ...(preExisting.value.length > 0 ? { preExisting: preExisting.value.join(',') } : {}) },
  });
  return moved.ok ? ok(undefined) : moved;
}
