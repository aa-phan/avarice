// The permission decision of an onboarding (plan 04-21; FR-15, ONB-6). A run's decisions hang off the run; an onboarding's hang off the carrier run its
// contract is stored under, through `openOnboardingDecision`. The class is `permission`, so the only option is `withdraw`: nothing here can be answered
// into an approval (FR-13), and what the decision is about is never done again on its own. Used for a promotion that left files untouched and for a
// privileged action whose start has no end.
import { ISSUE_MAX_CHARS, OPTION_LABEL_MAX_CHARS, classifyDecision } from '../domain/decision-policy.ts';
import { digestOf } from '../domain/digest.ts';
import { storedText } from '../domain/quick-record.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { DecisionRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';

// A permission decision reads no list of the contract; the shape is what the classifier's signature asks for.
const NO_DECISION_LISTS: RunContract['decisions'] = { delegated: [], defaults: [], human: [], prohibited: [] };

export interface OnboardingPermissionDecision {
  issue: string;
  // What closing the decision does, said once for its only option.
  consequence: string;
  evidenceRefs: readonly string[];
}

export function openOnboardingPermissionDecision(deps: AppDeps, onboardingId: string, input: OnboardingPermissionDecision): Result<DecisionRow> {
  const stored = deps.ledger.getContract(onboardingId);
  if (!stored.ok) return stored;
  if (stored.value === null) return err({ kind: 'internal', cause: `onboarding ${onboardingId} has no stored contract` });
  const classification = classifyDecision({ kind: 'permission' }, NO_DECISION_LISTS);
  const options = classification.options.map((o) => ({ key: o.key, label: storedText(o.label, OPTION_LABEL_MAX_CHARS), kind: o.kind }));
  const consequences: Record<string, string> = {};
  for (const option of options) consequences[option.key] = input.consequence;
  const opened = deps.ledger.openOnboardingDecision(onboardingId, {
    class: classification.class,
    issue: storedText(input.issue, ISSUE_MAX_CHARS),
    options,
    consequences,
    evidenceRefs: input.evidenceRefs,
    affectedItems: [],
    stateDigest: digestOf({ onboardingId, contractDigest: stored.value.digest }),
    urgency: classification.urgency,
    nowMs: deps.clock.nowMs(),
  });
  return opened.ok ? ok(opened.value) : opened;
}
