// Run lifecycle (docs/contracts-and-state.md "Run state machine"): the outer run state and the per-work-item
// state as two pure tables, mirroring onboarding-lifecycle.ts. The diagram in that document is the single list
// of run states; every edge it draws is listed here, plus the generic edges its prose names.
import { ok, err } from './result.ts';
import type { Result } from './result.ts';

export const RUN_STATES = [
  'contract_ready',
  'running',
  'waiting_external',
  'verifying',
  'ready_for_review',
  'awaiting_review',
  'blocked_on_decision',
  'paused',
  'failed',
  'cancelled',
  'closed',
] as const;

export type RunState = (typeof RUN_STATES)[number];

// Every entry into blocked_on_decision carries one of these codes ("Run state machine", prose under the diagram).
export const RUN_BLOCKED_REASONS = [
  'decision',
  'enforcement_failure',
  'budget_exhausted',
  'unauthenticated',
  'ref_changed',
  'ref_deleted',
  'access_revoked',
] as const;

export type RunBlockedReason = (typeof RUN_BLOCKED_REASONS)[number];

type Edge = readonly [RunState, RunState];

// Edges drawn in the diagram of docs/contracts-and-state.md, in the order of the diagram.
const DIAGRAM_EDGES: readonly Edge[] = [
  ['contract_ready', 'running'],
  ['running', 'running'],
  ['running', 'waiting_external'],
  ['waiting_external', 'running'],
  ['running', 'blocked_on_decision'],
  ['blocked_on_decision', 'running'],
  ['running', 'verifying'],
  ['verifying', 'running'],
  ['verifying', 'ready_for_review'],
  ['verifying', 'blocked_on_decision'],
  ['ready_for_review', 'awaiting_review'],
  ['awaiting_review', 'running'],
  ['awaiting_review', 'closed'],
  ['running', 'failed'],
  ['running', 'paused'],
  ['verifying', 'paused'],
  ['ready_for_review', 'paused'],
  ['awaiting_review', 'paused'],
  ['awaiting_review', 'blocked_on_decision'],
  ['running', 'cancelled'],
  ['blocked_on_decision', 'cancelled'],
  ['paused', 'running'],
  ['ready_for_review', 'closed'],
];

// failed, cancelled and closed end the run; nothing leaves them.
const TERMINAL: readonly RunState[] = ['failed', 'cancelled', 'closed'];

// "Every non-terminal state can also move to cancelled, paused and blocked_on_decision."
const NON_TERMINAL: readonly RunState[] = RUN_STATES.filter((state) => !TERMINAL.includes(state));
const GENERIC_TARGETS: readonly RunState[] = ['cancelled', 'paused', 'blocked_on_decision'];

// Recovery rules: a run killed during verification resumes through re-verification ("`avarice resume` offers re-verification").
const RECOVERY_EDGES: readonly Edge[] = [['paused', 'verifying']];

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
  for (const from of NON_TERMINAL) {
    for (const to of GENERIC_TARGETS) {
      // The only edge from a state to itself is the diagram's running -> running (a work item passed its gate).
      if (from !== to) add([from, to]);
    }
  }
  RECOVERY_EDGES.forEach(add);
  return edges;
}

export const RUN_TRANSITIONS: readonly Edge[] = buildTransitions();

const EDGE_KEYS: ReadonlySet<string> = new Set(RUN_TRANSITIONS.map(([from, to]) => `${from}>${to}`));

export function assertRunTransition(from: RunState, to: RunState): Result<void> {
  if (EDGE_KEYS.has(`${from}>${to}`)) return ok(undefined);
  return err({
    kind: 'invalid',
    field: 'state',
    reason: `run transition ${String(from)} -> ${String(to)} is not in the lifecycle`,
  });
}

// A run that stops here waits for a person or has ended; the supervisor does not continue it unprompted.
const STOP_STATES: ReadonlySet<string> = new Set(['ready_for_review', 'blocked_on_decision', 'failed', 'cancelled', 'closed']);

export function isRunStopState(state: RunState): boolean {
  return STOP_STATES.has(state);
}

// `resume` continues from the committed state in these states (a paused run reconciles first).
const RESUMABLE: readonly RunState[] = ['contract_ready', 'running', 'verifying', 'paused'];

export function isRunResumable(state: RunState): boolean {
  return RESUMABLE.includes(state);
}

// Written to checkpoints.next_action; order is execution order within the state.
export const RUN_NEXT_ACTIONS: Readonly<Partial<Record<RunState, readonly string[]>>> = {
  contract_ready: ['prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement'],
  running: ['context-pack', 'launch:run', 'classify', 'discard-attempt', 'gate:g2', 'commit'],
  verifying: ['verify:checks', 'gate:g4', 'handoff:fetch'],
  paused: ['reconcile'],
};

// The status of a run step row, mirroring the onboarding steps (an interrupted step is marked by resume, a step the
// reconcile found finished is `reconciled`).
export const RUN_STEP_STATUSES = ['started', 'completed', 'failed', 'interrupted', 'reconciled', 'skipped'] as const;

export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

// Work items move ready -> delegated -> implemented -> gated -> done, or to blocked_on_decision
// ("Run state machine", prose after the diagram). A delegated item that is discarded goes back to ready
// (CON-16 discard and retry), and an implemented item whose required check newly failed goes back to delegated for
// one bounded repair (AUT-10).
export const WORK_ITEM_STATES = ['ready', 'delegated', 'implemented', 'gated', 'done', 'blocked_on_decision'] as const;

export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

type ItemEdge = readonly [WorkItemState, WorkItemState];

const ITEM_EDGES: readonly ItemEdge[] = [
  ['ready', 'delegated'],
  ['delegated', 'implemented'],
  ['implemented', 'gated'],
  ['gated', 'done'],
  ['delegated', 'ready'],
  // A bounded repair of an item whose required check newly failed (AUT-10, D-11). The repair limit is enforced by
  // gate G3 and the invocation budget, not by this table.
  ['implemented', 'delegated'],
  // An item blocked by a decision becomes ready again once no open decision affects it.
  ['blocked_on_decision', 'ready'],
  ...WORK_ITEM_STATES.filter((state) => state !== 'done' && state !== 'blocked_on_decision').map((state): ItemEdge => [state, 'blocked_on_decision']),
];

const ITEM_EDGE_KEYS: ReadonlySet<string> = new Set(ITEM_EDGES.map(([from, to]) => `${from}>${to}`));

export function assertItemTransition(from: WorkItemState, to: WorkItemState): Result<void> {
  if (ITEM_EDGE_KEYS.has(`${from}>${to}`)) return ok(undefined);
  return err({
    kind: 'invalid',
    field: 'state',
    reason: `work item transition ${String(from)} -> ${String(to)} is not in the lifecycle`,
  });
}
