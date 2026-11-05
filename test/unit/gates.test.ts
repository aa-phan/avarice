// Gates G2 and G4 (AUT-7, AUT-9): pure verdicts over facts AVARICE measured, with failures listed in a fixed rule order.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { G4_RULES, evaluateG4 } from '../../src/domain/gates.ts';
import type { G4Facts } from '../../src/domain/gates.ts';

const HEAD = `git:${'a'.repeat(40)}`;

function g4(over: Partial<G4Facts> = {}): G4Facts {
  return {
    revision: HEAD,
    blocking: [],
    acceptance: [{ id: 'AC1', satisfied: true, evidenceIds: ['ev_1'] }],
    requiredEvidence: [{ name: 'test', status: 'passed' }],
    diffGateClean: true,
    openDecisions: 0,
    budgetsExceeded: [],
    ...over,
  };
}

describe('evaluateG4', () => {
  it('passes a clean committed revision with no blocking delta, every criterion mapped and nothing open', () => {
    assert.deepEqual(evaluateG4(g4()), { passed: true, failures: [] });
  });

  it('lists the rules in their fixed order', () => {
    assert.deepEqual([...G4_RULES], ['revision-clean', 'checks-delta', 'acceptance-mapped', 'no-stale-or-inconclusive', 'diff-gate-clean', 'decisions-closed', 'budgets-within']);
  });

  const cases: Array<[string, Partial<G4Facts>]> = [
    ['revision-clean', { revision: `tree:sha256:${'b'.repeat(64)}` }],
    ['checks-delta', { blocking: [{ name: 'test', reason: 'regressed' }] }],
    ['acceptance-mapped', { acceptance: [{ id: 'AC1', satisfied: false, evidenceIds: [] }] }],
    ['no-stale-or-inconclusive', { requiredEvidence: [{ name: 'test', status: 'stale' }] }],
    ['diff-gate-clean', { diffGateClean: false }],
    ['decisions-closed', { openDecisions: 1 }],
    ['budgets-within', { budgetsExceeded: ['costUsd'] }],
  ];
  for (const [rule, over] of cases) {
    it(`fails alone on ${rule}`, () => {
      const verdict = evaluateG4(g4(over));
      assert.equal(verdict.passed, false);
      assert.deepEqual(verdict.failures.map((f) => f.rule), [rule]);
      assert.ok((verdict.failures[0]?.detail ?? '').length > 0);
    });
  }

  it('fails a revision that is not git:<40 hex>, including look-alikes', () => {
    for (const revision of ['', 'git:abc', `git:${'A'.repeat(40)}`, `git:${'a'.repeat(40)}\n`, `tree:sha256:${'b'.repeat(64)}`, 'HEAD']) {
      assert.deepEqual(evaluateG4(g4({ revision })).failures.map((f) => f.rule), ['revision-clean'], JSON.stringify(revision));
    }
  });

  it('fails a required evidence row that is inconclusive, and one that is stale, but not a passed one', () => {
    assert.equal(evaluateG4(g4({ requiredEvidence: [{ name: 'test', status: 'inconclusive' }] })).passed, false);
    assert.equal(evaluateG4(g4({ requiredEvidence: [{ name: 'test', status: 'passed' }, { name: 'lint', status: 'passed' }] })).passed, true);
  });

  it('fails a run with no acceptance criteria rather than passing it vacuously', () => {
    assert.deepEqual(evaluateG4(g4({ acceptance: [] })).failures.map((f) => f.rule), ['acceptance-mapped']);
  });

  it('reports every failing rule, in rule order, when several fail', () => {
    const verdict = evaluateG4(g4({ openDecisions: 2, revision: 'x', blocking: [{ name: 'lint', reason: 'missing' }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['revision-clean', 'checks-delta', 'decisions-closed']);
  });

  it('does not let a failed required check pass by being listed as pre-existing: only the blocking list counts (AUT-9)', () => {
    const verdict = evaluateG4(g4({ blocking: [{ name: 'format', reason: 'target-not-passed' }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['checks-delta']);
  });

  it('is idempotent and independent of the order of the lists it is given (AUT-9)', () => {
    const facts = g4({
      blocking: [{ name: 'b', reason: 'regressed' }, { name: 'a', reason: 'missing' }],
      acceptance: [{ id: 'AC2', satisfied: false, evidenceIds: [] }, { id: 'AC1', satisfied: false, evidenceIds: [] }],
      requiredEvidence: [{ name: 'z', status: 'stale' }, { name: 'y', status: 'inconclusive' }],
      budgetsExceeded: ['wallClock', 'costUsd'],
    });
    const reversed: G4Facts = {
      ...facts,
      blocking: [...facts.blocking].reverse(),
      acceptance: [...facts.acceptance].reverse(),
      requiredEvidence: [...facts.requiredEvidence].reverse(),
      budgetsExceeded: [...facts.budgetsExceeded].reverse(),
    };
    assert.deepEqual(evaluateG4(facts), evaluateG4(facts));
    assert.deepEqual(evaluateG4(facts), evaluateG4(reversed));
  });
});
