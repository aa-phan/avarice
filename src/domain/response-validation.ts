// The response checks, in the order D-15 states them (AUT-4, AUT-5; T-03-08, T-03-09). One pure function over facts the caller
// measured; the first failing check decides the verdict:
//   1. identity     the responder is an interactive terminal, not under AVARICE_RUN, not in the run's process tree, and the profile
//                   owner. The agent answering its own decision (NG-5) fails here, before anything else is looked at.
//   2. open         the decision is open (an answered one goes on to be told apart from a repeat), a stale one names its successor,
//                   a withdrawn one is refused.
//   3. option       the answer is a listed option, or free text where the record allows it.
//   4. duplicate    the same answer to an answered decision is ignored; a different one is refused.
//   5. state-digest an open decision whose state moved is `stale`: the caller re-opens it with the answer kept as context. It is
//                   never applied. A withdraw applies nothing to the work, so it is applied whatever the digest says.
//
// AUT-4: there is no time, deadline or clock input. A verdict of `apply` needs a responder who passed identity and a matching
// state; nothing that happens by waiting can produce one, so silence cannot approve.
import type { DecisionOption } from './decision-policy.ts';

export const RESPONSE_CHECKS = ['identity', 'open', 'option', 'duplicate', 'state-digest'] as const;
export type ResponseCheck = (typeof RESPONSE_CHECKS)[number];

export interface ResponseFacts {
  identity: {
    // Standard input and output are a terminal.
    interactive: boolean;
    // The AVARICE_RUN marker is set in the responder's environment.
    underRun: boolean;
    // The responder's process tree includes a run's supervisor or unit.
    inRunTree: boolean;
    // The responder is the OS user who owns the profile.
    ownsProfile: boolean;
  };
  decision: {
    decisionId: string;
    // open, answered, stale or withdrawn.
    state: string;
    options: readonly DecisionOption[];
    // The recorded answer of an answered decision.
    answer: string | null;
    // The digest the decision was opened with.
    stateDigest: string;
    // The decision that replaced a stale one.
    successorId?: string;
  };
  // What the responder typed: an option key, or free text.
  answer: { key?: string; text?: string };
  // The state digest now (computeStateDigest).
  currentDigest: string;
}

export type AnswerKind = DecisionOption['kind'];

export type ResponseVerdict =
  | { verdict: 'apply' | 'stale' | 'duplicate'; answer: string; kind: AnswerKind }
  | { verdict: 'reject'; stage: ResponseCheck; check: string; detail: string };

export const FREE_TEXT_MAX_CHARS = 2000;

// Control characters other than tab and line feed (the rule of the brief parser).
const BAD_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function reject(stage: ResponseCheck, check: string, detail: string): ResponseVerdict {
  return { verdict: 'reject', stage, check, detail };
}

type Resolved = { answer: string; kind: AnswerKind } | { rejected: ResponseVerdict };

function resolveAnswer(facts: ResponseFacts): Resolved {
  const { key, text } = facts.answer;
  if (key !== undefined && text !== undefined) return { rejected: reject('option', 'answer-ambiguous', 'give an option key or free text, not both') };
  if (key === undefined && text === undefined) return { rejected: reject('option', 'answer-missing', 'give an option key or free text') };
  if (key !== undefined) {
    // A text option is answered with text, never by its key.
    const option = facts.decision.options.find((o) => o.key === key && o.kind !== 'text');
    if (option === undefined) {
      const listed = facts.decision.options.filter((o) => o.kind !== 'text').map((o) => o.key);
      return { rejected: reject('option', 'option-not-listed', `${JSON.stringify(key)} is not one of the options (${listed.join(', ') || 'none'})`) };
    }
    return { answer: option.key, kind: option.kind };
  }
  const answerText = text as string;
  if (!facts.decision.options.some((o) => o.kind === 'text')) {
    return { rejected: reject('option', 'free-text-not-allowed', 'this decision lists its options; answer with one of them') };
  }
  if (answerText.trim() === '' || answerText.length > FREE_TEXT_MAX_CHARS || BAD_CONTROL.test(answerText)) {
    return { rejected: reject('option', 'text-invalid', `free text is 1 to ${FREE_TEXT_MAX_CHARS} characters with no control characters`) };
  }
  return { answer: answerText, kind: 'text' };
}

export function validateResponse(facts: ResponseFacts): ResponseVerdict {
  const { identity, decision } = facts;
  if (!identity.interactive) return reject('identity', 'identity:not-interactive', 'a decision is answered from an interactive terminal');
  if (identity.underRun) return reject('identity', 'identity:avarice-run', 'a decision is not answered from inside a run (AVARICE_RUN is set)');
  if (identity.inRunTree) return reject('identity', 'identity:run-tree', 'a decision is not answered from a process the run started');
  if (!identity.ownsProfile) return reject('identity', 'identity:profile-owner', 'only the user who owns the profile answers a decision');

  if (decision.state === 'stale') {
    const successor = decision.successorId !== undefined ? `; answer ${decision.successorId}` : '';
    return reject('open', 'decision-stale', `decision ${decision.decisionId} was re-opened on newer state${successor}`);
  }
  if (decision.state === 'withdrawn') return reject('open', 'decision-withdrawn', `decision ${decision.decisionId} was withdrawn`);
  if (decision.state !== 'open' && decision.state !== 'answered') return reject('open', 'decision-not-open', `decision ${decision.decisionId} is ${decision.state}, not open`);

  const resolved = resolveAnswer(facts);
  if ('rejected' in resolved) return resolved.rejected;
  const { answer, kind } = resolved;

  if (decision.state === 'answered') {
    if (decision.answer === answer) return { verdict: 'duplicate', answer, kind };
    return reject('duplicate', 'decision-answered', `decision ${decision.decisionId} was already answered`);
  }

  if (kind === 'withdraw') return { verdict: 'apply', answer, kind };
  // An empty digest on either side is not a digest to match.
  if (decision.stateDigest === '' || facts.currentDigest === '' || decision.stateDigest !== facts.currentDigest) {
    return { verdict: 'stale', answer, kind };
  }
  return { verdict: 'apply', answer, kind };
}
