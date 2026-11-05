// Evidence statuses, revisions, the D-12 baseline delta and acceptance mapping (AUT-7, AUT-8, AUT-9, FR-5, FR-6).
// Every verdict here comes from statuses AVARICE measured; model text never produces a revision or a passed status.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EVIDENCE_STATUSES, baselineDelta, evidenceStatusOf, mapAcceptance, revisionOf } from '../../src/domain/evidence.ts';
import type { CheckOutcome, EvidenceRow } from '../../src/domain/evidence.ts';

const A40 = 'a'.repeat(40);
const B64 = 'b'.repeat(64);

function outcomes(spec: Record<string, CheckOutcome['status']>): CheckOutcome[] {
  return Object.entries(spec).map(([name, status]) => ({ name, status }));
}

describe('EVIDENCE_STATUSES', () => {
  it('lists exactly the six statuses of the evidence schema', () => {
    assert.deepEqual([...EVIDENCE_STATUSES], ['passed', 'failed', 'skipped', 'unavailable', 'inconclusive', 'stale']);
  });
});

describe('evidenceStatusOf (AUT-8)', () => {
  it('maps each command result to an evidence status', () => {
    assert.equal(evidenceStatusOf('passed'), 'passed');
    assert.equal(evidenceStatusOf('failed'), 'failed');
    assert.equal(evidenceStatusOf('timed_out'), 'inconclusive');
    assert.equal(evidenceStatusOf('cancelled'), 'inconclusive');
    assert.equal(evidenceStatusOf('spawn_error'), 'unavailable');
    assert.equal(evidenceStatusOf('sandbox_unavailable'), 'unavailable');
  });

  it('never calls an unknown result passed', () => {
    assert.equal(evidenceStatusOf('success' as never), 'inconclusive');
    assert.equal(evidenceStatusOf('' as never), 'inconclusive');
    assert.equal(evidenceStatusOf(undefined as never), 'inconclusive');
  });
});

describe('revisionOf (FR-6)', () => {
  it('names a committed clean tree git:<40 hex>', () => {
    assert.deepEqual(revisionOf({ head: A40, clean: true }), { ok: true, value: `git:${A40}` });
  });

  it('names a dirty tree tree:sha256:<64 hex>', () => {
    assert.deepEqual(revisionOf({ head: A40, clean: false, treeDigest: B64 }), { ok: true, value: `tree:sha256:${B64}` });
  });

  it('gives the tree form when there is no head commit (empty edge), never a git form', () => {
    for (const head of [null, '']) {
      assert.deepEqual(revisionOf({ head, clean: true, treeDigest: B64 }), { ok: true, value: `tree:sha256:${B64}` });
    }
  });

  it('refuses a head that is not 40 lowercase hex (encoding edge)', () => {
    for (const head of ['a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), `${'a'.repeat(39)}\n`, 'HEAD']) {
      assert.equal(revisionOf({ head, clean: true }).ok, false, JSON.stringify(head));
    }
  });

  it('refuses a tree digest that is not 64 lowercase hex, and a dirty tree with none', () => {
    for (const treeDigest of ['b'.repeat(63), 'b'.repeat(65), 'B'.repeat(64), `sha256:${B64}`, 'z'.repeat(64)]) {
      assert.equal(revisionOf({ head: A40, clean: false, treeDigest }).ok, false, treeDigest);
    }
    assert.equal(revisionOf({ head: A40, clean: false }).ok, false);
    assert.equal(revisionOf({ head: null, clean: false }).ok, false);
  });
});

describe('baselineDelta (D-12)', () => {
  it('blocks a required check that passed at base and does not pass at head, and calls base-and-head failures pre-existing', () => {
    const delta = baselineDelta({
      base: outcomes({ lint: 'passed', format: 'failed', test: 'passed' }),
      head: outcomes({ lint: 'passed', format: 'failed', test: 'failed' }),
      required: ['lint', 'format', 'test'],
      targets: [],
    });
    assert.deepEqual(delta.blocking, [{ name: 'test', reason: 'regressed' }]);
    assert.deepEqual(delta.preExisting, ['format']);
  });

  it('requires a target check to pass at head even when it failed at base', () => {
    const delta = baselineDelta({
      base: outcomes({ lint: 'passed', format: 'failed', test: 'passed' }),
      head: outcomes({ lint: 'passed', format: 'failed', test: 'passed' }),
      required: ['lint', 'format', 'test'],
      targets: ['format'],
    });
    assert.deepEqual(delta.blocking, [{ name: 'format', reason: 'target-not-passed' }]);
    assert.deepEqual(delta.preExisting, []);
  });

  it('lets a target check that was failing at base and passes at head through', () => {
    const delta = baselineDelta({ base: outcomes({ test: 'failed' }), head: outcomes({ test: 'passed' }), required: ['test'], targets: ['test'] });
    assert.deepEqual(delta, { blocking: [], preExisting: [] });
  });

  it('blocks an unavailable, inconclusive, skipped or stale required check at head as not-conclusive', () => {
    for (const status of ['unavailable', 'inconclusive', 'skipped', 'stale'] as const) {
      const delta = baselineDelta({ base: outcomes({ test: 'passed' }), head: outcomes({ test: status }), required: ['test'], targets: [] });
      assert.deepEqual(delta.blocking, [{ name: 'test', reason: 'not-conclusive' }], status);
      assert.deepEqual(delta.preExisting, []);
    }
  });

  it('blocks a required check with no head result as missing', () => {
    const delta = baselineDelta({ base: outcomes({ test: 'passed' }), head: [], required: ['test'], targets: [] });
    assert.deepEqual(delta.blocking, [{ name: 'test', reason: 'missing' }]);
  });

  it('does not call a head failure pre-existing unless the base failure was measured (AUT-9)', () => {
    for (const base of [outcomes({}), outcomes({ test: 'inconclusive' }), outcomes({ test: 'unavailable' }), outcomes({ test: 'skipped' })]) {
      const delta = baselineDelta({ base, head: outcomes({ test: 'failed' }), required: ['test'], targets: [] });
      assert.deepEqual(delta.blocking, [{ name: 'test', reason: 'regressed' }]);
      assert.deepEqual(delta.preExisting, []);
    }
  });

  it('holds a target that is not a required check to the same bar', () => {
    const delta = baselineDelta({ base: outcomes({}), head: outcomes({ extra: 'failed' }), required: [], targets: ['extra'] });
    assert.equal(delta.blocking.length, 1);
    assert.equal(delta.blocking[0]?.name, 'extra');
  });

  it('is order independent and idempotent', () => {
    const input = {
      base: outcomes({ b: 'passed', a: 'failed', c: 'passed' }),
      head: outcomes({ b: 'failed', a: 'failed', c: 'inconclusive' }),
      required: ['c', 'a', 'b'],
      targets: [],
    };
    const first = baselineDelta(input);
    const second = baselineDelta({ ...input, base: [...input.base].reverse(), head: [...input.head].reverse(), required: ['b', 'c', 'a'] });
    assert.deepEqual(first, second);
    assert.deepEqual(baselineDelta(input), first);
    assert.deepEqual(first.blocking.map((b) => b.name), ['b', 'c']);
  });
});

describe('mapAcceptance (AUT-7, AUT-8)', () => {
  const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
    evidenceId: 'ev_1', kind: 'check', name: 'test', status: 'passed', independence: 'deterministic', ...over,
  });

  it('satisfies a criterion by a deterministic check passed at head, naming the evidence', () => {
    const [m] = mapAcceptance([{ id: 'AC1', verifiedBy: ['check:test'] }], { rows: [row({})], passedTestIds: [] });
    assert.deepEqual(m, { id: 'AC1', satisfied: true, evidenceIds: ['ev_1'] });
  });

  it('never lets model-review evidence satisfy a criterion', () => {
    const [m] = mapAcceptance([{ id: 'AC1', verifiedBy: ['check:test'] }], { rows: [row({ independence: 'model-review' })], passedTestIds: [] });
    assert.equal(m?.satisfied, false);
    assert.deepEqual(m?.evidenceIds, []);
  });

  it('does not satisfy a criterion from a gsd-verdict row, even one named like the check and passed', () => {
    const [m] = mapAcceptance([{ id: 'AC1', verifiedBy: ['check:test'] }], { rows: [row({ kind: 'gsd-verdict' })], passedTestIds: [] });
    assert.equal(m?.satisfied, false);
  });

  it('does not satisfy a criterion from a failed, inconclusive, unavailable, skipped or stale row', () => {
    for (const status of ['failed', 'inconclusive', 'unavailable', 'skipped', 'stale'] as const) {
      const [m] = mapAcceptance([{ id: 'AC1', verifiedBy: ['check:test'] }], { rows: [row({ status })], passedTestIds: [] });
      assert.equal(m?.satisfied, false, status);
    }
  });

  it('leaves a criterion verified by a pre-existing failed check unsatisfied', () => {
    const [m] = mapAcceptance([{ id: 'AC1', verifiedBy: ['check:format'] }], { rows: [row({ name: 'format', status: 'failed', preExisting: true })], passedTestIds: [] });
    assert.equal(m?.satisfied, false);
  });

  it('satisfies a test: reference only by an ID in the passed after-inventory', () => {
    const ac = [{ id: 'AC1', verifiedBy: ['test:renders the footer'] }];
    assert.equal(mapAcceptance(ac, { rows: [], passedTestIds: ['renders the footer'] })[0]?.satisfied, true);
    assert.equal(mapAcceptance(ac, { rows: [], passedTestIds: ['renders the header'] })[0]?.satisfied, false);
    assert.equal(mapAcceptance(ac, { rows: [], passedTestIds: [] })[0]?.satisfied, false);
  });

  it('satisfies a diff: reference only by a passed deterministic diff row of that name', () => {
    const ac = [{ id: 'AC1', verifiedBy: ['diff:package.json unchanged'] }];
    assert.equal(mapAcceptance(ac, { rows: [row({ kind: 'diff', name: 'package.json unchanged' })], passedTestIds: [] })[0]?.satisfied, true);
    assert.equal(mapAcceptance(ac, { rows: [row({ kind: 'diff', name: 'package.json unchanged', status: 'failed' })], passedTestIds: [] })[0]?.satisfied, false);
    assert.equal(mapAcceptance(ac, { rows: [row({ kind: 'check', name: 'package.json unchanged' })], passedTestIds: [] })[0]?.satisfied, false);
  });

  it('leaves a criterion with no verifiedBy, or an unknown reference form, unsatisfied', () => {
    const maps = mapAcceptance(
      [{ id: 'AC1', verifiedBy: [] }, { id: 'AC2', verifiedBy: ['manual:looks fine'] }],
      { rows: [row({ kind: 'manual', name: 'looks fine' })], passedTestIds: [] },
    );
    assert.deepEqual(maps.map((m) => m.satisfied), [false, false]);
  });

  it('returns one mapping per criterion in the order given', () => {
    const maps = mapAcceptance([{ id: 'AC2', verifiedBy: ['check:test'] }, { id: 'AC1', verifiedBy: ['check:lint'] }], { rows: [row({})], passedTestIds: [] });
    assert.deepEqual(maps.map((m) => m.id), ['AC2', 'AC1']);
    assert.deepEqual(maps.map((m) => m.satisfied), [true, false]);
  });
});
