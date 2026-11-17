// The approval gate (plan 04-16; FR-12, FR-13, FR-15, ADR-005, S-7). `authorizeAction` is the one place that says whether a privileged action may start:
//
//   1. the action is classified (an unknown name is privileged) and the policy sources of the profile are evaluated (`evaluatePolicy`): a deny ends it;
//   2. an allow lets a read or local-write action through with no record, and a privileged one through with its start recorded (`action.started`);
//   3. require-approval needs a source: a contract authorization that names exactly this action and these parameters, else an approval of the same scope,
//      action and canonical parameter digest that is unexpired, unrevoked and unconsumed, consumed in the transaction that records the start
//      (`consumeApprovalAndStart`), so an approval starts one action once even when two processes race for it;
//   4. with no source the action is denied with rule `approval-required:<apr id>` and an `approval.requested` event, and the message names the command the
//      owner runs: `avarice approve <apr id>`.
//
// Nothing here reads a plan, a decision answer or a clock for an answer: a plan approval, a decision answer, a deadline, silence and a replay after an
// interruption approve nothing (FR-13). A privileged action whose start was recorded and whose end was not is never run again: `reconcilePrivilegedSteps`
// finds it on resume and opens a permission decision that names it (FR-15). The scope is the run ID, the onboarding ID or `attended:<session id>`.
import { paramsDigest, paramsSummary, scopeRunId } from '../domain/approval.ts';
import { classifyAction } from '../domain/action-class.ts';
import { ISSUE_MAX_CHARS, OPTION_LABEL_MAX_CHARS, classifyDecision } from '../domain/decision-policy.ts';
import { evaluatePolicy } from '../domain/policy.ts';
import { storedText } from '../domain/quick-record.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { ActionEventRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { openOnboardingPermissionDecision } from './onboarding-decision.ts';
import { stateDigestOf } from './run-stages/blocked.ts';

export interface AuthorizeInput {
  // The run ID, the onboarding ID, or `attended:<session id>`.
  scope: string;
  action: string;
  params: Readonly<Record<string, unknown>>;
  // What a contract authorizes without an approval (the onboarding contract for promotion): an action with exactly these parameters, and no other.
  contractAuthorization?: { action: string; params: Readonly<Record<string, unknown>> };
  // The repository whose `.avarice/policy.json` at the pin is the fourth policy source.
  repo?: { path: string; pin: string };
  // The work item the action belongs to, recorded on the start so a resume can name it.
  itemId?: string;
}

export type AuthorizeOutcome =
  // `class`: a read or local-write action the policy allows. `policy`: a privileged action an explicit rule allows. `contract` and `approval`: the
  // action may start because the contract names it or because one approval was consumed with its start. A privileged action carries `startSeq`.
  | { effect: 'allow'; source: 'class' | 'policy' | 'contract' | 'approval'; approvalId?: string; startSeq?: number }
  // `rule` is the policy rule that denied it, or `approval-required:<apr id>` when only an approval is missing (`requestId` is then set).
  | { effect: 'deny'; rule: string; message: string; requestId?: string };

export interface PrivilegedOutcome {
  status: 'succeeded' | 'failed';
}

// What `reconcilePrivilegedSteps` found: a privileged action that started and never finished.
export interface InterruptedStep {
  startSeq: number;
  action: string;
  paramsDigest: string;
  paramsSummary: string;
  itemId?: string;
}

export interface ReconcileOutcome {
  steps: InterruptedStep[];
  decisionIds: string[];
}

// The parameters a policy rule can match on are strings; a number or a boolean is matched by its text, and anything else has no text to match.
function textParams(params: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

function startData(input: AuthorizeInput, digest: string, source: string): Record<string, unknown> {
  return {
    scope: input.scope,
    action: input.action,
    paramsDigest: digest,
    paramsSummary: paramsSummary(input.params),
    source,
    ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
  };
}

export function authorizeAction(deps: AppDeps, input: AuthorizeInput): Result<AuthorizeOutcome> {
  let digest: string;
  try {
    digest = paramsDigest(input.params);
  } catch {
    return err({ kind: 'invalid', field: 'params', reason: 'the parameters of an action have no canonical form (a number that is not finite, a function or a class instance)' });
  }
  const sources = deps.policy(input.repo);
  if (!sources.ok) return sources;
  const decision = evaluatePolicy(sources.value, input.action, textParams(input.params));
  const nowMs = deps.clock.nowMs();
  const runId = scopeRunId(input.scope);

  if (decision.effect === 'deny') {
    return ok({ effect: 'deny', rule: decision.ruleId, message: `${input.action} is denied by policy rule ${decision.ruleId}` });
  }

  // The start of a privileged action is recorded; a read or local-write action that policy allows leaves no record (it needs no replay rule).
  const recordStart = (source: 'policy' | 'contract'): Result<AuthorizeOutcome> => {
    const started = deps.ledger.appendEvent({ type: 'action.started', ...(runId !== undefined ? { runId } : {}), data: startData(input, digest, source), nowMs });
    return started.ok ? ok({ effect: 'allow', source, startSeq: started.value.seq }) : started;
  };

  if (decision.effect === 'allow') {
    if (classifyAction(input.action) !== 'privileged') return ok({ effect: 'allow', source: 'class' });
    return recordStart('policy');
  }

  // require-approval. A contract that authorizes this action with exactly these parameters is the first source.
  const contract = input.contractAuthorization;
  if (contract !== undefined && contract.action === input.action) {
    let contractDigest: string | undefined;
    try {
      contractDigest = paramsDigest(contract.params);
    } catch {
      contractDigest = undefined;
    }
    if (contractDigest === digest) return recordStart('contract');
  }

  const consumed = deps.ledger.consumeApprovalAndStart({
    scope: input.scope,
    action: input.action,
    paramsDigest: digest,
    nowMs,
    startEvent: { type: 'action.started', ...(runId !== undefined ? { runId } : {}), data: startData(input, digest, 'approval') },
  });
  if (!consumed.ok) return consumed;
  if (consumed.value !== null) return ok({ effect: 'allow', source: 'approval', approvalId: consumed.value.approvalId, startSeq: consumed.value.startSeq });

  // No source: ask the owner once. A retry of the same action finds the request that is still waiting and names it again.
  const pending = deps.ledger.findPendingApprovalRequest({ scope: input.scope, action: input.action, paramsDigest: digest });
  if (!pending.ok) return pending;
  let requestId = pending.value?.requestId;
  if (requestId === undefined) {
    requestId = deps.ids.next('apr_');
    const requested = deps.ledger.appendEvent({
      type: 'approval.requested',
      ...(runId !== undefined ? { runId } : {}),
      data: { requestId, scope: input.scope, action: input.action, paramsDigest: digest, paramsSummary: paramsSummary(input.params), ruleId: decision.ruleId },
      nowMs,
    });
    if (!requested.ok) return requested;
  }
  return ok({
    effect: 'deny',
    rule: `approval-required:${requestId}`,
    requestId,
    message: `${input.action} needs an approval for these parameters; the owner approves it at a terminal with: avarice approve ${requestId}`,
  });
}

// The starts of a scope that have no end: an `action.finished` ends the earliest open start of its action, an `action.interrupted` ends the start it names.
function openSteps(events: readonly ActionEventRow[]): ActionEventRow[] {
  const open: ActionEventRow[] = [];
  for (const event of events) {
    if (event.type === 'action.started') {
      open.push(event);
    } else if (event.type === 'action.finished') {
      const at = open.findIndex((s) => s.data['action'] === event.data['action']);
      if (at >= 0) open.splice(at, 1);
    } else if (event.type === 'action.interrupted') {
      const at = open.findIndex((s) => s.seq === event.data['startSeq']);
      if (at >= 0) open.splice(at, 1);
    }
  }
  return open;
}

// Records that a privileged action ended, whatever its outcome. An end with no open start of that action in the scope is a caller that never asked.
export function finishPrivilegedAction(deps: AppDeps, scope: string, action: string, outcome: PrivilegedOutcome): Result<void> {
  const events = deps.ledger.listActionEvents(scope);
  if (!events.ok) return events;
  if (!openSteps(events.value).some((s) => s.data['action'] === action)) {
    return err({ kind: 'conflict', expected: `an open start of ${action} in ${scope}`, actual: 'no action.started without an end' });
  }
  const runId = scopeRunId(scope);
  const finished = deps.ledger.appendEvent({
    type: 'action.finished',
    ...(outcome.status === 'failed' ? { level: 'warn' as const } : {}),
    ...(runId !== undefined ? { runId } : {}),
    data: { scope, action, status: outcome.status },
    nowMs: deps.clock.nowMs(),
  });
  return finished.ok ? ok(undefined) : finished;
}

// The evidence reference a permission decision carries to name the start it is about: `event:<seq of the action.started event>`.
export const INTERRUPTED_REF_PREFIX = 'event:';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

// The permission decision of an interrupted privileged action of a run (FR-15): what started, with which parameters (the summary), and that it was not
// repeated. The only option is `withdraw`, as for every permission decision: nothing here can be answered into an approval (FR-13).
function openInterruptedDecision(deps: AppDeps, runId: string, step: InterruptedStep): Result<string> {
  const stored = deps.ledger.getRunContract(runId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `run ${runId} has no stored contract` });
  const contract = stored.value.body as RunContract;
  const classification = classifyDecision({ kind: 'permission' }, contract.decisions);
  const options = classification.options.map((o) => ({ key: o.key, label: storedText(o.label, OPTION_LABEL_MAX_CHARS), kind: o.kind }));
  const consequences: Record<string, string> = {};
  for (const option of options) {
    consequences[option.key] = 'the decision closes with nothing applied; the action is not repeated, and a new one needs its own approval';
  }
  const opened = deps.ledger.openDecision({
    runId,
    contractVersion: stored.value.version,
    class: classification.class,
    issue: storedText(`the privileged action ${step.action} (${step.paramsSummary}) started and its end was never recorded; it was not repeated`, ISSUE_MAX_CHARS),
    options,
    consequences,
    evidenceRefs: [`${INTERRUPTED_REF_PREFIX}${step.startSeq}`],
    affectedItems: step.itemId !== undefined ? [step.itemId] : [],
    stateDigest: stateDigestOf(stored.value.version, contract),
    urgency: classification.urgency,
    nowMs: deps.clock.nowMs(),
  });
  return opened.ok ? ok(opened.value.decisionId) : opened;
}

// The starts of a scope that have no end, in the order they were recorded; empty when none. Read-only: a caller that must not take the scope's lease
// asks this first, and reconciles only when something is open.
export function openPrivilegedSteps(deps: AppDeps, scope: string): Result<InterruptedStep[]> {
  const events = deps.ledger.listActionEvents(scope);
  if (!events.ok) return events;
  return ok(openSteps(events.value).map((start) => stepOf(start)));
}

function stepOf(start: ActionEventRow): InterruptedStep {
  return {
    startSeq: start.seq,
    action: asText(start.data['action']),
    paramsDigest: asText(start.data['paramsDigest']),
    paramsSummary: asText(start.data['paramsSummary']),
    ...(asText(start.data['itemId']) !== '' ? { itemId: asText(start.data['itemId']) } : {}),
  };
}

// The permission decision of an interrupted privileged action of an onboarding: the same words as a run's, on the onboarding's carrier run.
function openInterruptedOnboardingDecision(deps: AppDeps, onboardingId: string, step: InterruptedStep): Result<string> {
  const opened = openOnboardingPermissionDecision(deps, onboardingId, {
    issue: `the privileged action ${step.action} (${step.paramsSummary}) started and its end was never recorded; it was not repeated`,
    consequence: 'the decision closes with nothing applied; the action is not repeated, and a new one needs its own approval',
    evidenceRefs: [`${INTERRUPTED_REF_PREFIX}${step.startSeq}`],
  });
  return opened.ok ? ok(opened.value.decisionId) : opened;
}

// The no-replay rule (FR-15, T-04-44). A privileged action whose start was recorded and whose end was not may have taken effect, so it is never run again
// on its own: it is found here, on resume, and one permission decision names it, in the order the starts were recorded. Nothing in this module calls the
// action, and no approval is consumed or written. Each interrupted start is marked with an `action.interrupted` event after its decision is opened, so a
// resume that is itself interrupted repeats nothing: the decision is found by its evidence reference and the mark is written. The scope is a run (its
// decision hangs off the run), an onboarding (plan 04-21: off the carrier run its contract is stored under) or an attended session, which has no decision
// to hang off: its steps are marked and returned and its caller decides what to ask.
export function reconcilePrivilegedSteps(deps: AppDeps, scope: string): Result<ReconcileOutcome> {
  const events = deps.ledger.listActionEvents(scope);
  if (!events.ok) return events;
  const open = openSteps(events.value);
  if (open.length === 0) return ok({ steps: [], decisionIds: [] });

  const run = deps.ledger.getRun(scope);
  if (!run.ok && run.error.kind !== 'not_found') return run;
  const isRun = run.ok;
  const onboarding = isRun ? null : deps.ledger.getOnboarding(scope);
  if (onboarding !== null && !onboarding.ok && onboarding.error.kind !== 'not_found') return onboarding;
  const carrier = onboarding !== null && onboarding.ok ? onboarding.value.contractRunId : null;
  const decisionRunId = isRun ? scope : carrier;

  const known = new Map<string, string>();
  if (decisionRunId !== null) {
    const decisions = deps.ledger.listDecisions({ runId: decisionRunId });
    if (!decisions.ok) return decisions;
    for (const decision of decisions.value) {
      for (const ref of decision.evidenceRefs) if (ref.startsWith(INTERRUPTED_REF_PREFIX)) known.set(ref, decision.decisionId);
    }
  }

  const runId = scopeRunId(scope);
  const steps: InterruptedStep[] = [];
  const decisionIds: string[] = [];
  for (const start of open) {
    const step = stepOf(start);
    let decisionId: string | undefined;
    if (decisionRunId !== null) {
      decisionId = known.get(`${INTERRUPTED_REF_PREFIX}${start.seq}`);
      if (decisionId === undefined) {
        const opened = isRun ? openInterruptedDecision(deps, scope, step) : openInterruptedOnboardingDecision(deps, scope, step);
        if (!opened.ok) return opened;
        decisionId = opened.value;
      }
      decisionIds.push(decisionId);
    }
    const marked = deps.ledger.appendEvent({
      type: 'action.interrupted',
      level: 'warn',
      ...(runId !== undefined ? { runId } : {}),
      data: { scope, action: step.action, startSeq: start.seq, ...(decisionId !== undefined ? { decisionId } : {}) },
      nowMs: deps.clock.nowMs(),
    });
    if (!marked.ok) return marked;
    steps.push(step);
  }
  return ok({ steps, decisionIds });
}
