// Stage for `contract_ready` (plan 02-12; FR-2, FR-7, CON-3, D-01): the run's preparation actions, in RUN_NEXT_ACTIONS order. Each
// action that has a registered handler is preceded by its checkpoint, committed before the side effect, and an action whose run step
// is already `completed` is skipped, so a resume repeats nothing. Later plans register the other actions (`configure-gsd`,
// `install-deps`, `validate-checks`, `baseline`) between these two without editing this stage.
//
// `prepare-workspace` makes the run clone at the pin on `avarice/<runId>`. `verify-enforcement` is gate G0's dynamic half: the host
// must report `enforced`, else the run blocks with `enforcement_failure` before any invocation; otherwise it moves to `running`.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { checkG0Static } from '../../domain/run-contract.ts';
import type { G0Failure, RunContract } from '../../domain/run-contract.ts';
import { RUN_NEXT_ACTIONS } from '../../domain/run-lifecycle.ts';
import type { RunRow } from '../../ports/ledger.ts';
import type { AppDeps } from '../deps.ts';
import type { RunStage, RunStageContext } from './stage.ts';

// `moved`: the handler committed a transition, so the stage is done and the loop reads the new state.
export type ContractReadyOutcome = 'next' | 'moved';

export type ContractReadyHandler = (ctx: RunStageContext, row: RunRow, contract: RunContract) => Promise<Result<ContractReadyOutcome>> | Result<ContractReadyOutcome>;

interface Registered {
  handler: ContractReadyHandler;
  // The run step that marks the action done; absent for an action that ends in a transition.
  step?: string;
}

const handlers = new Map<string, Registered>();

export function registerContractReadyAction(name: string, handler: ContractReadyHandler, options: { step?: string } = {}): void {
  handlers.set(name, { handler, ...(options.step !== undefined ? { step: options.step } : {}) });
}

const MAX_DETAIL = 200;

interface LoadedContract {
  version: number;
  body: RunContract;
}

function loadRunContract(deps: AppDeps, runId: string): Result<LoadedContract> {
  const stored = deps.ledger.getRunContract(runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${runId} has no stored contract` });
  return ok({ version: stored.value.version, body: stored.value.body as RunContract });
}

export const contractReadyStage: RunStage = async (ctx: RunStageContext, row: RunRow): Promise<Result<void>> => {
  const loaded = loadRunContract(ctx.deps, ctx.runId);
  if (!loaded.ok) return loaded;
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const done = new Set(steps.value.filter((s) => s.status === 'completed').map((s) => s.step));

  for (const action of RUN_NEXT_ACTIONS.contract_ready ?? []) {
    const registered = handlers.get(action);
    if (registered === undefined) continue;
    if (registered.step !== undefined && done.has(registered.step)) continue;
    const marked = ctx.checkpoint(action);
    if (!marked.ok) return marked;
    const ran = await registered.handler(ctx, row, loaded.value.body);
    if (!ran.ok) return ran;
    if (ran.value === 'moved') return ok(undefined);
  }
  return ok(undefined);
};

const WORKSPACE_STEP = 'workspace:prepare';

registerContractReadyAction(
  'prepare-workspace',
  (ctx, row, contract) => {
    const { deps } = ctx;
    const workspace = deps.runWorkspace;
    if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
    const project = deps.ledger.findProject({ projectId: row.projectId });
    if (!project.ok) return project;
    if (project.value === null) return err({ kind: 'not_found', ref: `project ${row.projectId}` });

    const startedMs = deps.clock.nowMs();
    const prepared = workspace.prepare({ repoPath: project.value.repoPath, workRoot: deps.profile.workRoot, runId: ctx.runId, pin: contract.workspace.baseRevision });
    if (!prepared.ok) return prepared;
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: WORKSPACE_STEP,
      status: 'completed',
      result: { path: prepared.value.path, branch: prepared.value.branch, pin: contract.workspace.baseRevision },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    return recorded.ok ? ok('next') : recorded;
  },
  { step: WORKSPACE_STEP },
);

// The clone and branch `prepare-workspace` recorded, for the transition that writes them on the run row.
function preparedWorkspace(deps: AppDeps, runId: string): Result<{ path: string; branch: string }> {
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return steps;
  const found = [...steps.value].reverse().find((s) => s.step === WORKSPACE_STEP && s.status === 'completed');
  const body = typeof found?.result === 'object' && found.result !== null ? (found.result as Record<string, unknown>) : {};
  const path = body['path'];
  const branch = body['branch'];
  if (typeof path !== 'string' || typeof branch !== 'string') return err({ kind: 'internal', cause: `run ${runId} has no ${WORKSPACE_STEP} step` });
  return ok({ path, branch });
}

registerContractReadyAction('verify-enforcement', (ctx, row, contract) => {
  const { deps } = ctx;
  const workspace = preparedWorkspace(deps, ctx.runId);
  if (!workspace.ok) return workspace;
  const loaded = deps.ledger.getRunContract(ctx.runId);
  if (!loaded.ok) return loaded;

  // G0 has two halves: the conditions the contract states (checked again here, they were judged at start) and the one only the
  // host can answer, whether it enforces containment (CON-3).
  const failures: G0Failure[] = checkG0Static(contract);
  const enforcement = deps.host.descriptor.attributes?.['enforcement'];
  const hostFailed = enforcement !== 'enforced';
  if (hostFailed) {
    failures.push({ rule: 'host-enforcement', detail: `host ${deps.host.descriptor.adapter} reports enforcement ${enforcement ?? 'unknown'}`.slice(0, MAX_DETAIL) });
  }
  const gate = deps.ledger.recordGateResult({
    runId: ctx.runId,
    gate: 'G0',
    contractVersion: loaded.value?.version ?? 1,
    policyRevision: contract.policyRevision,
    revision: contract.workspace.baseRevision,
    passed: failures.length === 0,
    failures,
    nowMs: deps.clock.nowMs(),
  });
  if (!gate.ok) return gate;

  const place = { workspacePath: workspace.value.path, branch: workspace.value.branch };
  if (failures.length > 0) {
    ctx.note(
      hostFailed
        ? `host ${deps.host.descriptor.adapter} reports enforcement ${enforcement ?? 'unknown'}; containment cannot be guaranteed`
        : `G0 failed: ${failures.map((f) => f.rule).join(', ')}`.slice(0, MAX_DETAIL),
    );
    const blocked = ctx.transition(row, 'blocked_on_decision', 'none', {
      reason: hostFailed ? 'enforcement_failure' : 'decision',
      data: { host: deps.host.descriptor.adapter, enforcement: enforcement ?? 'unknown', gate: 'G0' },
      ...place,
    });
    return blocked.ok ? ok('moved') : blocked;
  }
  const moved = ctx.transition(row, 'running', 'context-pack', place);
  return moved.ok ? ok('moved') : moved;
});
