// Onboarding lifecycle (docs/repository-onboarding.md state diagram; SKELETON.md "Onboarding lifecycle").
import { ok, err } from './result.ts';
import type { Result } from './result.ts';

export const ONBOARDING_STATES = [
  'unregistered',
  'discovered',
  'contract_proposed',
  'mapping',
  'paused',
  'validating',
  'validation_failed',
  'planning',
  'planning_ready',
  'active',
  'stale',
  'incompatible',
  'blocked',
  'deactivated',
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export type BlockedReason =
  | 'enforcement_failure'
  | 'budget_exhausted'
  | 'existing_state_conflict'
  | 'scope_unavailable'
  | 'adapter_incompatible'
  | 'decision';

type Edge = readonly [OnboardingState, OnboardingState];

// Edges drawn in the diagram of docs/repository-onboarding.md.
const DIAGRAM_EDGES: readonly Edge[] = [
  ['unregistered', 'discovered'],
  ['discovered', 'contract_proposed'],
  ['contract_proposed', 'mapping'],
  ['contract_proposed', 'blocked'],
  ['mapping', 'validating'],
  ['mapping', 'paused'],
  ['paused', 'mapping'],
  ['validating', 'validation_failed'],
  ['validation_failed', 'mapping'],
  ['validation_failed', 'blocked'],
  ['validating', 'planning'],
  ['validating', 'planning_ready'],
  ['planning', 'planning_ready'],
  ['planning', 'blocked'],
  ['planning_ready', 'active'],
  ['active', 'stale'],
  ['stale', 'mapping'],
  ['active', 'incompatible'],
  ['incompatible', 'contract_proposed'],
  ['blocked', 'contract_proposed'],
  ['active', 'deactivated'],
  ['deactivated', 'discovered'],
];

// SKELETON.md: every non-terminal pre-activation state may move to blocked.
const PRE_ACTIVATION: readonly OnboardingState[] = [
  'discovered',
  'contract_proposed',
  'mapping',
  'paused',
  'validating',
  'validation_failed',
  'planning',
  'planning_ready',
];

// SKELETON.md (S-36): GSD outside the adapter range is discovered at discovered or contract_proposed.
const INCOMPATIBLE_EDGES: readonly Edge[] = [
  ['discovered', 'incompatible'],
  ['contract_proposed', 'incompatible'],
];

function buildTransitions(): readonly Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const add = (edge: Edge) => {
    const key = `${edge[0]}>${edge[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };
  DIAGRAM_EDGES.forEach(add);
  PRE_ACTIVATION.forEach((state) => add([state, 'blocked']));
  INCOMPATIBLE_EDGES.forEach(add);
  return edges;
}

export const TRANSITIONS: readonly Edge[] = buildTransitions();

const EDGE_KEYS: ReadonlySet<string> = new Set(TRANSITIONS.map(([from, to]) => `${from}>${to}`));

export function assertTransition(from: OnboardingState, to: OnboardingState): Result<void> {
  if (EDGE_KEYS.has(`${from}>${to}`)) return ok(undefined);
  return err({
    kind: 'invalid',
    field: 'state',
    reason: `onboarding transition ${String(from)} -> ${String(to)} is not in the lifecycle`,
  });
}

const STOP_STATES: ReadonlySet<string> = new Set(['active', 'blocked', 'incompatible', 'deactivated']);

export function isStopState(state: OnboardingState): boolean {
  return STOP_STATES.has(state);
}

// Written to checkpoints.next_action; order is execution order within the state.
export const NEXT_ACTIONS: Readonly<Partial<Record<OnboardingState, readonly string[]>>> = {
  discovered: ['compile-contract'],
  contract_proposed: ['prepare-workspace', 'configure-gsd', 'verify-enforcement'],
  mapping: ['launch:map'],
  paused: ['reconcile-invocation'],
  validating: ['validate'],
  validation_failed: ['retry-or-block'],
  planning_ready: ['index:code-graph', 'index:intel', 'index:knowledge', 'activate'],
};
