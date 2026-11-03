// The ordered registry of index steps for `planning_ready` (docs/repository-onboarding.md "Stages", Index row).
// The stage loop (index-stage.ts) and activation (activate.ts) know only this registry and the shape of a step's
// result, so plans 01-17 (intel) and 01-18 (knowledge pass) fill in their step without editing either.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { IndexName, IndexStepResult } from '../../domain/project-record.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { AppDeps } from '../deps.ts';
import { runCodeGraphStep } from './index-code-graph.ts';
import { runIntelStep } from './index-intel.ts';
import { runKnowledgeStep } from './index-knowledge.ts';
import type { StageContext } from './stage.ts';
import type { StoredContract } from './shared.ts';

// What a step is given: the stage context (checkpoints, notes), the onboarding row, the staging path and HEAD, and
// the stored contract (budgets, write sets, which indexes are on).
export interface IndexStepContext {
  stage: StageContext;
  row: OnboardingRow;
  staging: string;
  // The staging HEAD, which is the onboarded revision (the full commit, without a `git:` prefix).
  head: string;
  contract: StoredContract;
}

// A step reports a missing or failed index as `absent` with a reason, never as an error: an index that fails never
// blocks activation (ONB-13). An `err` is left for a failure of the ledger or the stage itself.
export interface IndexStep {
  name: IndexName;
  run(deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>>;
}

export const INDEX_STEPS: readonly IndexStep[] = [
  { name: 'code-graph', run: runCodeGraphStep },
  { name: 'intel', run: runIntelStep },
  { name: 'knowledge', run: runKnowledgeStep },
];

// The name of a step in `onboarding_steps` and of the checkpoint taken before it.
export function indexStepKey(name: IndexName): string {
  return `index:${name}`;
}

// The stored result of every index step that completed, in registry order.
export function loadIndexResults(deps: AppDeps, onboardingId: string): Result<IndexStepResult[]> {
  const steps = deps.ledger.getStepResults(onboardingId);
  if (!steps.ok) return steps;
  const results: IndexStepResult[] = [];
  for (const step of INDEX_STEPS) {
    const stored = [...steps.value].reverse().find((s) => s.step === indexStepKey(step.name) && s.status === 'completed');
    if (stored === undefined || typeof stored.result !== 'object' || stored.result === null) continue;
    results.push(stored.result as IndexStepResult);
  }
  return ok(results);
}
