// The run lifecycle tables (docs/contracts-and-state.md "Run state machine"). The expected edges are written
// out here independently of RUN_TRANSITIONS, so a stray or missing edge in the domain module fails a test
// instead of being copied into it (FR-2).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_BLOCKED_REASONS,
  RUN_NEXT_ACTIONS,
  RUN_STATES,
  RUN_TRANSITIONS,
  WORK_ITEM_STATES,
  assertItemTransition,
  assertRunTransition,
  isRunResumable,
  isRunStopState,
} from '../../src/domain/run-lifecycle.ts';
import type { RunState, WorkItemState } from '../../src/domain/run-lifecycle.ts';

// The edges drawn in the mermaid diagram of docs/contracts-and-state.md, one per line.
const DIAGRAM: ReadonlyArray<readonly [RunState, RunState]> = [
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

const NON_TERMINAL: readonly RunState[] = [
  'contract_ready',
  'running',
  'waiting_external',
  'verifying',
  'ready_for_review',
  'awaiting_review',
  'blocked_on_decision',
  'paused',
];
const TERMINAL: readonly RunState[] = ['failed', 'cancelled', 'closed'];

// "Every non-terminal state can also move to cancelled, paused and blocked_on_decision" (a state does not move to itself),
// and the recovery rule "resume offers re-verification" (paused -> verifying).
const GENERIC: ReadonlyArray<readonly [RunState, RunState]> = NON_TERMINAL.flatMap((from) =>
  (['cancelled', 'paused', 'blocked_on_decision'] as const).filter((to) => to !== from).map((to) => [from, to] as const),
);
const EXTRA: ReadonlyArray<readonly [RunState, RunState]> = [['paused', 'verifying']];

const EXPECTED = new Set<string>([...DIAGRAM, ...GENERIC, ...EXTRA].map(([a, b]) => `${a}>${b}`));

describe('run transition table', () => {
  it('has the eleven states of the diagram', () => {
    assert.deepEqual(
      [...RUN_STATES].sort(),
      [
        'awaiting_review',
        'blocked_on_decision',
        'cancelled',
        'closed',
        'contract_ready',
        'failed',
        'paused',
        'ready_for_review',
        'running',
        'verifying',
        'waiting_external',
      ],
    );
    assert.equal(RUN_STATES.length, 11);
  });

  it('accepts every edge of the diagram', () => {
    for (const [from, to] of DIAGRAM) assert.ok(assertRunTransition(from, to).ok, `${from} -> ${to}`);
  });

  it('accepts every non-terminal state to cancelled, paused and blocked_on_decision', () => {
    for (const [from, to] of GENERIC) assert.ok(assertRunTransition(from, to).ok, `${from} -> ${to}`);
  });

  it('accepts paused -> running and paused -> verifying (resume re-verifies)', () => {
    assert.ok(assertRunTransition('paused', 'running').ok);
    assert.ok(assertRunTransition('paused', 'verifying').ok);
    assert.ok(assertRunTransition('verifying', 'paused').ok);
  });

  it('accepts exactly the expected edges among all 121 ordered pairs and refuses the rest as invalid on field state', () => {
    let accepted = 0;
    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        const result = assertRunTransition(from, to);
        if (EXPECTED.has(`${from}>${to}`)) {
          assert.ok(result.ok, `${from} -> ${to} must be accepted`);
          accepted += 1;
        } else {
          assert.ok(!result.ok, `${from} -> ${to} must be refused`);
          assert.equal(result.error.kind, 'invalid');
          assert.equal(result.error.kind === 'invalid' ? result.error.field : '', 'state');
        }
      }
    }
    assert.equal(accepted, EXPECTED.size);
  });

  it('refuses the named examples, among them the adjacency edge contract_ready -> ready_for_review', () => {
    for (const [from, to] of [
      ['contract_ready', 'ready_for_review'],
      ['contract_ready', 'verifying'],
      ['running', 'ready_for_review'],
      ['running', 'awaiting_review'],
      ['verifying', 'closed'],
      ['ready_for_review', 'running'],
      ['paused', 'ready_for_review'],
      ['blocked_on_decision', 'verifying'],
    ] as const) {
      const result = assertRunTransition(from, to);
      assert.ok(!result.ok, `${from} -> ${to}`);
      assert.equal(result.error.kind, 'invalid');
      assert.equal(result.error.kind === 'invalid' ? result.error.field : '', 'state');
    }
  });

  it('allows running -> running and refuses every other self-edge', () => {
    for (const state of RUN_STATES) {
      assert.equal(assertRunTransition(state, state).ok, state === 'running', state);
    }
  });

  it('lets nothing leave failed, cancelled or closed', () => {
    for (const from of TERMINAL) {
      for (const to of RUN_STATES) assert.ok(!assertRunTransition(from, to).ok, `${from} -> ${to}`);
    }
  });

  it('exports RUN_TRANSITIONS with exactly the accepted edges, each once', () => {
    const keys = RUN_TRANSITIONS.map(([from, to]) => `${from}>${to}`);
    assert.equal(new Set(keys).size, keys.length, 'no edge is listed twice');
    assert.deepEqual([...keys].sort(), [...EXPECTED].sort());
  });

  it('refuses a state that is not in the table', () => {
    assert.ok(!assertRunTransition('onboarding' as RunState, 'running').ok);
    assert.ok(!assertRunTransition('running', 'done' as RunState).ok);
  });
});

describe('run state classes', () => {
  it('treats ready_for_review, blocked_on_decision, failed, cancelled and closed as stop states', () => {
    const stops = RUN_STATES.filter((s) => isRunStopState(s));
    assert.deepEqual([...stops].sort(), ['blocked_on_decision', 'cancelled', 'closed', 'failed', 'ready_for_review']);
  });

  it('treats contract_ready, running, verifying and paused as resumable', () => {
    const resumable = RUN_STATES.filter((s) => isRunResumable(s));
    assert.deepEqual([...resumable].sort(), ['contract_ready', 'paused', 'running', 'verifying']);
  });

  it('names the documented blocked reasons', () => {
    assert.deepEqual(
      [...RUN_BLOCKED_REASONS].sort(),
      ['access_revoked', 'budget_exhausted', 'decision', 'enforcement_failure', 'ref_changed', 'ref_deleted', 'unauthenticated'],
    );
  });
});

describe('run next actions', () => {
  it('lists the actions of each resumable state in execution order', () => {
    assert.deepEqual(RUN_NEXT_ACTIONS.contract_ready, ['prepare-workspace', 'configure-gsd', 'install-deps', 'validate-checks', 'baseline', 'verify-enforcement']);
    assert.deepEqual(RUN_NEXT_ACTIONS.running, ['context-pack', 'launch:run', 'classify', 'discard-attempt', 'gate:g2', 'commit']);
    assert.deepEqual(RUN_NEXT_ACTIONS.verifying, ['verify:checks', 'gate:g4', 'handoff:fetch']);
    assert.deepEqual(RUN_NEXT_ACTIONS.paused, ['reconcile']);
  });
});

const ITEM_EDGES: ReadonlyArray<readonly [WorkItemState, WorkItemState]> = [
  ['ready', 'delegated'],
  ['delegated', 'implemented'],
  ['implemented', 'gated'],
  ['gated', 'done'],
  ['delegated', 'ready'],
  ['ready', 'blocked_on_decision'],
  ['delegated', 'blocked_on_decision'],
  ['implemented', 'blocked_on_decision'],
  ['gated', 'blocked_on_decision'],
  ['blocked_on_decision', 'ready'],
];

describe('work item transition table', () => {
  it('has the six item states', () => {
    assert.deepEqual([...WORK_ITEM_STATES].sort(), ['blocked_on_decision', 'delegated', 'done', 'gated', 'implemented', 'ready']);
  });

  it('accepts exactly ready -> delegated -> implemented -> gated -> done, the discard-and-retry edge and the blocked edges', () => {
    const expected = new Set(ITEM_EDGES.map(([a, b]) => `${a}>${b}`));
    for (const from of WORK_ITEM_STATES) {
      for (const to of WORK_ITEM_STATES) {
        const result = assertItemTransition(from, to);
        if (expected.has(`${from}>${to}`)) assert.ok(result.ok, `${from} -> ${to}`);
        else {
          assert.ok(!result.ok, `${from} -> ${to}`);
          assert.equal(result.error.kind, 'invalid');
        }
      }
    }
  });

  it('refuses skipping a step and leaving done', () => {
    for (const [from, to] of [
      ['ready', 'implemented'],
      ['ready', 'done'],
      ['delegated', 'done'],
      ['implemented', 'done'],
      ['done', 'ready'],
      ['done', 'blocked_on_decision'],
    ] as const) {
      assert.ok(!assertItemTransition(from, to).ok, `${from} -> ${to}`);
    }
  });
});
