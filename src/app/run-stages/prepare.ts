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
import { canonicalJson, digestOf } from '../../domain/digest.ts';
import type { AttemptRow, RunRow } from '../../ports/ledger.ts';
import { blockingOf, validateChecks } from '../check-validation.ts';
import { installDependencies, measureInventory, runRequiredChecks } from '../checks.ts';
import type { InstallResult } from '../checks.ts';
import type { AppDeps } from '../deps.ts';
import { RUN_GSD_SETTINGS } from '../run-gsd-config.ts';
import { blockRun } from './blocked.ts';
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
  // A step the action decided to skip (no dependencies declared) is as done as a completed one: a resume repeats nothing.
  const done = new Set(steps.value.filter((s) => s.status === 'completed' || s.status === 'skipped').map((s) => s.step));

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

const GSD_INSPECT_STEP = 'gsd:inspect';
const GSD_CONFIGURE_STEP = 'gsd:configure';

// `configure-gsd` (RC-4, CON-2): what GSD does under the run is decided here, outside any invocation (RESEARCH Pitfall 2). It records where the
// admitted gsd-core and its agents are (step `gsd:inspect`, which the invocation scope reads), applies the seven RUN_GSD_SETTINGS with
// `config-set` (spike S2-B) and records the result (step `gsd:configure`). `config-set` leaves an untracked `.planning/config.json` in the
// clone, so the snapshot of the unit's attempt is taken after this step and the commit step takes the file out again (D-17). S2-B found no
// directory that has to exist before the launch (`Write` creates the quick directory), so none is created.
registerContractReadyAction(
  'configure-gsd',
  async (ctx, row) => {
    const { deps } = ctx;
    const gsd = deps.gsd;
    if (gsd === undefined) return err({ kind: 'unavailable', cause: deps.gsdProblem !== undefined ? `no admitted gsd-core: ${deps.gsdProblem.found}` : 'no admitted gsd-core' });
    const workspace = preparedWorkspace(deps, ctx.runId);
    if (!workspace.ok) return workspace;

    const startedMs = deps.clock.nowMs();
    const inspected = gsd.inspect();
    if (!inspected.ok) return inspected;
    const found = deps.ledger.recordRunStep(ctx.runId, {
      step: GSD_INSPECT_STEP,
      status: 'completed',
      result: { gsdCoreDir: inspected.value.gsdCoreDir, agentsDir: inspected.value.agentsDir, version: inspected.value.version, packageName: inspected.value.packageName },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!found.ok) return found;

    const applied = await gsd.configure(workspace.value.path, RUN_GSD_SETTINGS);
    if (!applied.ok) return applied;
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: GSD_CONFIGURE_STEP,
      status: 'completed',
      result: { applied: applied.value.map((s) => ({ key: s.key, value: s.value })), settingsDigest: digestOf(RUN_GSD_SETTINGS), runId: row.runId },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    return recorded.ok ? ok('next') : recorded;
  },
  { step: GSD_CONFIGURE_STEP },
);

const INSTALL_STEP = 'deps:install';
const VALIDATE_STEP = 'checks:validate';
const BASELINE_STEP = 'baseline';

// What a step keeps of an install: the lockfile digest, the exit, the duration and every proxy attempt by host (D-11, T-02-47).
function installSummary(result: InstallResult): Record<string, unknown> {
  return {
    outcome: result.outcome,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(result.lockfile !== undefined ? { lockfile: result.lockfile } : {}),
    ...(result.lockfileDigest !== undefined ? { lockfileDigest: result.lockfileDigest } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    attempts: result.attempts,
  };
}

// `install-deps` (D-11): the conventions' dependency install in the run clone, before the first invocation, the only network any run step has
// and only to the registry. The step records the lockfile digest, the exit, the duration and every attempt the proxy saw by host. A missing
// sandbox or proxy is an enforcement failure; a host that is not an allowed registry, or a failing install, is a decision.
registerContractReadyAction(
  'install-deps',
  async (ctx, row, contract) => {
    const { deps } = ctx;
    const workspace = preparedWorkspace(deps, ctx.runId);
    if (!workspace.ok) return workspace;
    const startedMs = deps.clock.nowMs();
    const result = await installDependencies(deps, row, contract, workspace.value.path);
    if (!result.ok) return result;
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: INSTALL_STEP,
      status: result.value.outcome === 'installed' ? 'completed' : result.value.outcome === 'skipped' ? 'skipped' : 'failed',
      result: installSummary(result.value),
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!recorded.ok) return recorded;
    const failure = result.value.failure;
    if (failure === undefined) return ok('next');
    const blocked = blockRun(ctx, {
      reason: failure.reason,
      decisionClass: failure.decisionClass,
      issue: failure.issue,
      data: { gate: 'deps:install' },
      place: { workspacePath: workspace.value.path, branch: workspace.value.branch },
    });
    return blocked.ok ? ok('moved') : blocked;
  },
  { step: INSTALL_STEP },
);

// `validate-checks` (ONB-10): every declared check is validated in a scratch clone before it can become evidence. No repository command runs
// before this except the dependency install. A required (or targeted) check that is not `active` blocks the run with a decision before any
// invocation; a rejected optional check is left out and recorded. The step lists the checks in declared order with their verdicts.
registerContractReadyAction(
  'validate-checks',
  async (ctx, row, contract) => {
    const { deps } = ctx;
    const workspace = preparedWorkspace(deps, ctx.runId);
    if (!workspace.ok) return workspace;
    const place = { workspacePath: workspace.value.path, branch: workspace.value.branch };

    const startedMs = deps.clock.nowMs();
    // The checks are validated with their dependencies installed (a check usually runs a tool the install provides), in the validation clone,
    // by the same install as the run clone's. It runs only when some check still needs validating.
    const install: { result?: InstallResult } = {};
    const report = await validateChecks(deps, row, contract, {
      prepared: async (clone) => {
        const installed = await installDependencies(deps, row, contract, clone);
        if (!installed.ok) return installed;
        install.result = installed.value;
        return installed.value.outcome === 'failed' ? err({ kind: 'conflict', expected: 'the dependencies installed in the validation clone', actual: installed.value.failure?.issue ?? 'the install failed' }) : ok(undefined);
      },
    });
    if (!report.ok) {
      const failure = install.result?.failure;
      if (failure === undefined) return report;
      deps.ledger.recordRunStep(ctx.runId, { step: VALIDATE_STEP, status: 'failed', result: { install: installSummary(install.result as InstallResult) }, nowMs: startedMs, completedAtMs: deps.clock.nowMs() });
      const blocked = blockRun(ctx, { reason: failure.reason, decisionClass: failure.decisionClass, issue: `in the validation clone: ${failure.issue}`, data: { gate: 'checks:validate', step: 'deps:install' }, place });
      return blocked.ok ? ok('moved') : blocked;
    }
    const blocking = report.value.outcomes.filter((o) => o.verdict !== 'active' && (o.required || o.target));
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: VALIDATE_STEP,
      // A blocked validation is not a finished one: a run that is resumed validates again.
      status: blocking.length > 0 ? 'failed' : 'completed',
      result: {
        checks: report.value.outcomes.map((o) => ({ name: o.name, verdict: o.verdict, reused: o.reused, ...o.detail })),
        reused: report.value.reused,
        ...(install.result !== undefined ? { install: installSummary(install.result) } : {}),
      },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    if (!recorded.ok) return recorded;
    if (blocking.length === 0) return ok('next');

    const why = blocking.map(blockingOf);
    const blocked = blockRun(ctx, {
      reason: why.some((w) => w.reason === 'enforcement_failure') ? 'enforcement_failure' : 'decision',
      decisionClass: 'permission',
      issue: why.map((w) => w.issue).join('; '),
      data: { gate: 'checks:validate', checks: blocking.map((o) => o.name).join(',') },
      place,
    });
    return blocked.ok ? ok('moved') : blocked;
  },
  { step: VALIDATE_STEP },
);

// The first attempt of the run, opened by the baseline because the evidence of a check names an attempt. The unit's first attempt is this
// one: the running stage adopts it instead of opening another, so a run that never retries has exactly one attempt.
function initialAttempt(deps: AppDeps, runId: string): Result<AttemptRow> {
  const attempts = deps.ledger.listRunAttempts(runId);
  if (!attempts.ok) return attempts;
  const first = attempts.value[0];
  if (first !== undefined) return ok(first);
  return deps.ledger.recordRunAttempt(runId, { reason: 'initial', nowMs: deps.clock.nowMs() });
}

// `baseline` (D-12): every required (and targeted) active check runs once at the pin in the run clone, before the unit touches it. The
// outcomes are evidence rows labelled `base`; G2 and G4 judge the unit against them, never against an assumption that the pin is green.
registerContractReadyAction(
  'baseline',
  async (ctx, row, contract) => {
    const { deps } = ctx;
    const workspace = preparedWorkspace(deps, ctx.runId);
    if (!workspace.ok) return workspace;
    const stored = deps.ledger.getRunContract(ctx.runId);
    if (!stored.ok) return stored;
    const items = deps.ledger.listWorkItems(ctx.runId);
    if (!items.ok) return items;
    const attempt = initialAttempt(deps, ctx.runId);
    if (!attempt.ok) return attempt;

    const startedMs = deps.clock.nowMs();
    const itemId = items.value[0]?.itemId;
    const ran = await runRequiredChecks(deps, row, contract, {
      cwd: workspace.value.path,
      attemptId: attempt.value.attemptId,
      phase: 'base',
      contractVersion: stored.value?.version ?? 1,
      ...(itemId !== undefined ? { itemId } : {}),
    });
    if (!ran.ok) return ran;
    // AUT-9: the test inventory at the pin, measured here so the unit's tests are compared with what was there before it touched them.
    const inventory = await measureInventory(deps, row, contract, workspace.value.path, {
      phase: 'base',
      attemptId: attempt.value.attemptId,
      contractVersion: stored.value?.version ?? 1,
      ...(itemId !== undefined ? { itemId } : {}),
    });
    if (!inventory.ok) return inventory;
    const recorded = deps.ledger.recordRunStep(ctx.runId, {
      step: BASELINE_STEP,
      status: 'completed',
      result: {
        attemptId: attempt.value.attemptId,
        revision: contract.workspace.baseRevision,
        checks: ran.value.map((r) => ({ name: r.name, status: r.status, evidenceId: r.evidenceId })),
        ...(inventory.value !== null
          ? { inventory: { evidenceId: inventory.value.evidenceId, status: inventory.value.status, tests: inventory.value.snapshot.ids.length, files: inventory.value.snapshot.fileCount } }
          : {}),
      },
      nowMs: startedMs,
      completedAtMs: deps.clock.nowMs(),
    });
    return recorded.ok ? ok('next') : recorded;
  },
  { step: BASELINE_STEP },
);

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
  // A kill between this insert and the transition repeats the action on resume. Gate rows are insert-only and tell the truth about each
  // evaluation, but a repeat that finds the identical verdict already recorded for the same contract, policy and revision adds nothing.
  const contractVersion = loaded.value?.version ?? 1;
  const earlier = deps.ledger.listGateResults(ctx.runId);
  if (!earlier.ok) return earlier;
  const sameVerdict = earlier.value.some(
    (g) =>
      g.gate === 'G0' &&
      g.contractVersion === contractVersion &&
      g.policyRevision === contract.policyRevision &&
      g.revision === contract.workspace.baseRevision &&
      g.passed === (failures.length === 0) &&
      canonicalJson(g.failures) === canonicalJson(failures),
  );
  if (!sameVerdict) {
    const gate = deps.ledger.recordGateResult({
      runId: ctx.runId,
      gate: 'G0',
      contractVersion,
      policyRevision: contract.policyRevision,
      revision: contract.workspace.baseRevision,
      passed: failures.length === 0,
      failures,
      nowMs: deps.clock.nowMs(),
    });
    if (!gate.ok) return gate;
  }

  const place = { workspacePath: workspace.value.path, branch: workspace.value.branch };
  if (failures.length > 0) {
    // The baseline opened the first attempt; a run that stops here never runs a unit, so that attempt ends with the block.
    const attempts = deps.ledger.listRunAttempts(ctx.runId);
    if (!attempts.ok) return attempts;
    const open = attempts.value.find((a) => a.endedAt === null);
    if (open !== undefined) {
      const ended = deps.ledger.endRunAttempt(open.attemptId, { outcome: `blocked:${hostFailed ? 'enforcement_failure' : 'decision'}`, nowMs: deps.clock.nowMs() });
      if (!ended.ok && ended.error.kind !== 'conflict') return ended;
    }
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
