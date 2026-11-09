// The scheduler as a pure function (D-09, AUT-3, AUT-12): which item runs next, when a run is blocked on a
// decision, and when no item can ever be delivered. The expected results are written out here, independently of
// the domain module, and every case is also run over shuffled input because the verdict must not depend on the
// order rows arrive in (T-03-07).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isContinuableBlocked, readyItems, runDisposition, transitiveDependents } from '../../src/domain/work-items.ts';
import type { DecisionFacts, ItemFacts } from '../../src/domain/work-items.ts';
import type { WorkItemState } from '../../src/domain/run-lifecycle.ts';

function item(itemId: string, state: WorkItemState, dependsOn: string[], order: number): ItemFacts {
  return { itemId, state, dependsOn, order };
}

function decision(decisionId: string, state: string, affectedItems: string[]): DecisionFacts {
  return { decisionId, state, affectedItems };
}

// A is done, B waits on a decision, C is independent, D depends on B.
function scenario(overrides: Partial<Record<string, WorkItemState>> = {}): ItemFacts[] {
  const state = (id: string, fallback: WorkItemState): WorkItemState => overrides[id] ?? fallback;
  return [
    item('A', state('A', 'done'), [], 0),
    item('B', state('B', 'blocked_on_decision'), ['A'], 1),
    item('C', state('C', 'ready'), [], 2),
    item('D', state('D', 'ready'), ['B'], 3),
  ];
}

const OPEN_ON_B = [decision('dec_1', 'open', ['B'])];

// Every rotation and the reversal of the input, so a result that leans on arrival order fails.
function permutations<T>(values: readonly T[]): T[][] {
  const out: T[][] = [[...values].reverse()];
  for (let shift = 0; shift < values.length; shift += 1) out.push([...values.slice(shift), ...values.slice(0, shift)]);
  return out;
}

function ids(items: readonly ItemFacts[]): string[] {
  return items.map((entry) => entry.itemId);
}

describe('readyItems', () => {
  it('lists C only: B is blocked by its open decision and D depends on B', () => {
    assert.deepEqual(ids(readyItems(scenario(), OPEN_ON_B)), ['C']);
  });

  it('lists B once its decision is answered and B is ready, then D once B is done', () => {
    const answered = [decision('dec_1', 'answered', ['B'])];
    assert.deepEqual(ids(readyItems(scenario({ B: 'ready', C: 'done' }), answered)), ['B']);
    assert.deepEqual(ids(readyItems(scenario({ B: 'done', C: 'done' }), answered)), ['D']);
  });

  it('keeps a ready item blocked while any open decision lists it, and skips its transitive dependents whatever their state', () => {
    // B is ready again in the item table but a second open decision still lists it; D and E depend on it.
    const items = [
      item('A', 'done', [], 0),
      item('B', 'ready', ['A'], 1),
      item('D', 'ready', ['B'], 2),
      item('E', 'ready', ['D'], 3),
      item('F', 'ready', [], 4),
    ];
    assert.deepEqual(ids(readyItems(items, [decision('dec_2', 'open', ['B'])])), ['F']);
  });

  it('skips a dependent whose ancestor is named by an open decision even when the dependency chain is done', () => {
    // D claims done-ness of everything it needs, but an open decision lists D itself: never ready.
    const items = [item('A', 'done', [], 0), item('D', 'ready', ['A'], 1)];
    assert.deepEqual(ids(readyItems(items, [decision('dec_3', 'open', ['D'])])), []);
  });

  it('ignores decisions that are not open', () => {
    const closed = ['answered', 'stale', 'withdrawn'].map((state, index) => decision(`dec_${index}`, state, ['C']));
    assert.deepEqual(ids(readyItems(scenario(), closed)), ['C']);
  });

  it('returns items in brief declaration order', () => {
    const items = [item('Z', 'ready', [], 2), item('M', 'ready', [], 0), item('Q', 'ready', [], 1)];
    assert.deepEqual(ids(readyItems(items, [])), ['M', 'Q', 'Z']);
  });

  it('gives a deep-equal result for shuffled items and decisions', () => {
    const decisions = [decision('dec_1', 'open', ['B']), decision('dec_9', 'answered', ['C'])];
    const expected = readyItems(scenario(), decisions);
    for (const items of permutations(scenario())) {
      for (const shuffled of permutations(decisions)) assert.deepEqual(readyItems(items, shuffled), expected);
    }
  });
});

describe('transitiveDependents', () => {
  it('lists the direct dependent of B', () => {
    assert.deepEqual(transitiveDependents(scenario(), ['B']), ['D']);
  });

  it('follows a chain B <- D <- E and returns declaration order', () => {
    const items = [item('B', 'ready', [], 0), item('E', 'ready', ['D'], 2), item('D', 'ready', ['B'], 1)];
    assert.deepEqual(transitiveDependents(items, ['B']), ['D', 'E']);
  });

  it('ignores unknown roots and does not list a root that nothing depends on', () => {
    assert.deepEqual(transitiveDependents(scenario(), ['nope']), []);
    assert.deepEqual(transitiveDependents(scenario(), ['D']), []);
  });

  it('terminates on a dependency cycle, where a root reaches itself through its dependent', () => {
    const cyclic = [item('B', 'ready', ['D'], 0), item('D', 'ready', ['B'], 1)];
    assert.deepEqual(transitiveDependents(cyclic, ['B']), ['B', 'D']);
  });

  it('gives the same list for shuffled items', () => {
    const items = [item('B', 'ready', [], 0), item('D', 'ready', ['B'], 1), item('E', 'ready', ['D'], 2)];
    for (const shuffled of permutations(items)) assert.deepEqual(transitiveDependents(shuffled, ['B']), ['D', 'E']);
  });
});

describe('runDisposition', () => {
  it('starts C while B waits on its decision and D waits on B', () => {
    assert.deepEqual(runDisposition(scenario(), OPEN_ON_B), { kind: 'start', itemId: 'C' });
  });

  it('is blocked once C is done: D is not ready because its dependency B is not done', () => {
    assert.deepEqual(runDisposition(scenario({ C: 'done' }), OPEN_ON_B), { kind: 'blocked', decisionIds: ['dec_1'] });
  });

  it('walks B then D after the decision is answered, then is all-done', () => {
    const answered = [decision('dec_1', 'answered', ['B'])];
    assert.deepEqual(runDisposition(scenario({ B: 'ready', C: 'done' }), answered), { kind: 'start', itemId: 'B' });
    assert.deepEqual(runDisposition(scenario({ B: 'done', C: 'done' }), answered), { kind: 'start', itemId: 'D' });
    assert.deepEqual(runDisposition(scenario({ B: 'done', C: 'done', D: 'done' }), answered), { kind: 'all-done' });
  });

  it('continues an in-flight item (delegated, implemented or gated) even when other items are ready', () => {
    for (const state of ['delegated', 'implemented', 'gated'] as const) {
      assert.deepEqual(runDisposition(scenario({ C: state }), OPEN_ON_B), { kind: 'continue', itemId: 'C' }, state);
    }
    // Two in flight: the first in declaration order.
    const items = [item('A', 'gated', [], 0), item('B', 'delegated', [], 1), item('C', 'ready', [], 2)];
    assert.deepEqual(runDisposition(items, []), { kind: 'continue', itemId: 'A' });
  });

  it('is undeliverable, listing B and D, when the decision was withdrawn and nothing else can run', () => {
    const withdrawn = [decision('dec_1', 'withdrawn', ['B'])];
    assert.deepEqual(runDisposition(scenario({ C: 'done' }), withdrawn), { kind: 'undeliverable', itemIds: ['B', 'D'] });
  });

  it('lists every open decision when blocked, sorted by id', () => {
    const decisions = [decision('dec_b', 'open', ['B']), decision('dec_a', 'open', ['D']), decision('dec_z', 'withdrawn', ['C'])];
    assert.deepEqual(runDisposition(scenario({ C: 'done' }), decisions), { kind: 'blocked', decisionIds: ['dec_a', 'dec_b'] });
  });

  it('is all-done when every item is done, with or without decisions', () => {
    const items = [item('A', 'done', [], 0), item('B', 'done', ['A'], 1)];
    assert.deepEqual(runDisposition(items, []), { kind: 'all-done' });
    assert.deepEqual(runDisposition(items, [decision('dec_1', 'answered', ['B'])]), { kind: 'all-done' });
  });

  it('gives a deep-equal disposition for shuffled items and decisions in every scenario', () => {
    const cases: Array<[ItemFacts[], DecisionFacts[]]> = [
      [scenario(), OPEN_ON_B],
      [scenario({ C: 'done' }), OPEN_ON_B],
      [scenario({ C: 'done' }), [decision('dec_1', 'withdrawn', ['B'])]],
      [scenario({ C: 'delegated' }), OPEN_ON_B],
      [scenario({ B: 'done', C: 'done', D: 'done' }), []],
    ];
    for (const [items, decisions] of cases) {
      const expected = runDisposition(items, decisions);
      for (const shuffled of permutations(items)) assert.deepEqual(runDisposition(shuffled, decisions), expected);
    }
  });
});

describe('isContinuableBlocked', () => {
  it('is false with the decision open and nothing ready', () => {
    assert.equal(isContinuableBlocked(scenario({ C: 'done' }), OPEN_ON_B), false);
  });

  it('is true once an item is ready', () => {
    assert.equal(isContinuableBlocked(scenario(), OPEN_ON_B), true);
    assert.equal(isContinuableBlocked(scenario({ B: 'ready', C: 'done' }), [decision('dec_1', 'answered', ['B'])]), true);
  });

  it('is true when no open decision remains, even with nothing ready (the supervisor then reports undeliverable)', () => {
    assert.equal(isContinuableBlocked(scenario({ C: 'done' }), [decision('dec_1', 'withdrawn', ['B'])]), true);
  });

  it('gives the same answer for shuffled input', () => {
    for (const items of permutations(scenario({ C: 'done' }))) assert.equal(isContinuableBlocked(items, OPEN_ON_B), false);
    for (const items of permutations(scenario())) assert.equal(isContinuableBlocked(items, OPEN_ON_B), true);
  });
});
