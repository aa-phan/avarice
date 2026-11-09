// Answering a decision (plan 03-20; D-13 to D-17, AUT-4, AUT-5). `decide` reads the decision, its run and the run's latest contract, computes the digest
// of the state the decision is about to be applied to, and asks the pure rule of the D-15 order (validateResponse) what to do with the answer. Only
// an `apply` verdict changes the ledger, through answerDecision or withdrawDecision, which re-check in their own transaction that the decision is
// still open and that the contract is the version validated against. `decide` changes no contract field, budget or scope (D-17), and nothing here
// reads a clock to decide anything: an answer comes from a person, never from time passing (AUT-4).
//
// After the write the outcome says who picks the run up: `spawn` when the run is blocked, an answer made it continuable and nobody holds its lease (the
// command starts the detached supervisor through the single spawn path), `live-supervisor` when a supervisor holds the lease and its scheduler takes the
// answered item next, `none` otherwise (D-16). The shared rule is isBlockedRunContinuable.
import { optionsOf } from '../domain/decision-policy.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { isRunStopState } from '../domain/run-lifecycle.ts';
import type { RunContract } from '../domain/run-contract.ts';
import { validateResponse } from '../domain/response-validation.ts';
import type { ResponseFacts } from '../domain/response-validation.ts';
import type { DecisionRow, RunRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';
import { stateDigestOf } from './run-stages/blocked.ts';
import { isBlockedRunContinuable } from './run-stages/schedule.ts';

export interface DecideRequest {
  decisionId: string;
  // What the responder typed: an option key, or free text.
  answer: { key?: string; text?: string };
  // The facts the command measured about who is answering (the refusals before the profile resolves have already run).
  identity: ResponseFacts['identity'];
  // The OS user name; the answer is recorded as `owner:<responder>`.
  responder: string;
  nowMs: number;
}

export type DecideKind = 'answered' | 'withdrawn' | 'duplicate' | 'stale' | 'rejected' | 'amendment-requested';
export type Pickup = 'spawn' | 'live-supervisor' | 'none';

export interface DecideOutcome {
  kind: DecideKind;
  // The decision as it is after the call (for a stale one, the old row).
  decision: DecisionRow;
  // The successor a stale answer opened.
  reopened?: DecisionRow;
  // The name of the check that refused the answer, and its words.
  check?: string;
  detail?: string;
  // What was recorded as the answer (the option key, or the text).
  answer?: string;
  // The amend command of a record answered by an amendment, with the decision's ID in it.
  amendCommand?: string;
  // The contract version the decision was opened on and the latest one, for a stale answer.
  contractVersions?: { opened: number; latest: number };
  pickup: Pickup;
}

export function findDecision(deps: AppDeps, decisionId: string): Result<DecisionRow> {
  const all = deps.ledger.listDecisions({});
  if (!all.ok) return all;
  const found = all.value.find((d) => d.decisionId === decisionId);
  return found === undefined ? err({ kind: 'not_found', ref: `decision ${decisionId}` }) : ok(found);
}

const leaseIsLive = (run: RunRow, nowMs: number): boolean => run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;

// Who continues the run now that the decision is closed (D-16).
function pickupOf(deps: AppDeps, runId: string, nowMs: number): Result<Pickup> {
  const read = deps.ledger.getRun(runId);
  if (!read.ok) return read;
  const run = read.value;
  if (run.state === 'blocked_on_decision') {
    const continuable = isBlockedRunContinuable(deps, run);
    if (!continuable.ok) return continuable;
    if (!continuable.value) return ok('none');
    return ok(leaseIsLive(run, nowMs) ? 'live-supervisor' : 'spawn');
  }
  // A supervisor that is working the run's other items takes the answered one next: its scheduler reads the ledger again after every item.
  return ok(!isRunStopState(run.state) && leaseIsLive(run, nowMs) ? 'live-supervisor' : 'none');
}

// One pass of the rule. `retry` means the ledger refused the write because the decision or the contract moved between the read and the write: the
// caller reads again once and the rule decides on what is there now.
function applyOnce(deps: AppDeps, request: DecideRequest, decision: DecisionRow): Result<DecideOutcome | 'retry'> {
  const contract = deps.ledger.getRunContract(decision.runId);
  if (!contract.ok) return contract;
  if (contract.value === null) return err({ kind: 'internal', cause: `run ${decision.runId} has no stored contract` });
  const currentDigest = stateDigestOf(contract.value.version, contract.value.body as RunContract);

  const verdict = validateResponse({
    identity: request.identity,
    decision: {
      decisionId: decision.decisionId,
      state: decision.state,
      options: optionsOf(decision.options),
      answer: decision.answer,
      stateDigest: decision.stateDigest,
    },
    answer: request.answer,
    currentDigest,
  });

  if (verdict.verdict === 'reject') return ok({ kind: 'rejected', decision, check: verdict.check, detail: verdict.detail, pickup: 'none' });
  if (verdict.verdict !== 'apply') return ok({ kind: 'rejected', decision, check: verdict.verdict === 'stale' ? 'state-digest' : 'duplicate', detail: 'not supported yet', pickup: 'none' });

  const answeredBy = `owner:${request.responder}`;
  if (verdict.kind === 'withdraw') {
    const withdrawn = deps.ledger.withdrawDecision({ runId: decision.runId, decisionId: decision.decisionId, reason: 'owner', nowMs: request.nowMs });
    if (!withdrawn.ok) return withdrawn.error.kind === 'conflict' ? ok('retry') : withdrawn;
    const pickup = pickupOf(deps, decision.runId, request.nowMs);
    if (!pickup.ok) return pickup;
    return ok({ kind: 'withdrawn', decision: withdrawn.value, pickup: pickup.value });
  }
  const answered = deps.ledger.answerDecision({
    runId: decision.runId,
    decisionId: decision.decisionId,
    answer: verdict.answer,
    answeredBy,
    channel: 'terminal',
    expectContractVersion: contract.value.version,
    nowMs: request.nowMs,
  });
  if (!answered.ok) return answered.error.kind === 'conflict' ? ok('retry') : answered;
  const pickup = pickupOf(deps, decision.runId, request.nowMs);
  if (!pickup.ok) return pickup;
  return ok({ kind: 'answered', decision: answered.value, answer: verdict.answer, pickup: pickup.value });
}

export function decide(deps: AppDeps, request: DecideRequest): Result<DecideOutcome> {
  let found = findDecision(deps, request.decisionId);
  if (!found.ok) return found;
  for (let pass = 0; pass < 2; pass += 1) {
    const step = applyOnce(deps, request, found.value);
    if (!step.ok) return step;
    if (step.value !== 'retry') return ok(step.value);
    found = findDecision(deps, request.decisionId);
    if (!found.ok) return found;
  }
  return err({ kind: 'conflict', expected: `decision ${request.decisionId} unchanged while it was answered`, actual: 'it changed twice while it was answered' });
}
