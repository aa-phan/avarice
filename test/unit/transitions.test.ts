// The onboarding lifecycle transition table (docs/repository-onboarding.md state diagram; SKELETON.md
// "Onboarding lifecycle"). The expected table is written out here independently of TRANSITIONS, so a
// stray or missing edge in the domain module fails a test instead of being copied into it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ONBOARDING_STATES, TRANSITIONS, assertTransition, isStopState } from '../../src/domain/onboarding-lifecycle.ts';
import type { OnboardingState } from '../../src/domain/onboarding-lifecycle.ts';

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

const DIAGRAM: ReadonlyArray<readonly [OnboardingState, OnboardingState]> = [
  ['unregistered', 'discovered'],
  ['discovered', 'contract_proposed'],
  ['contract_proposed', 'mapping'],
  ['mapping', 'validating'],
  ['mapping', 'paused'],
  ['paused', 'mapping'],
  ['validating', 'validation_failed'],
  ['validation_failed', 'mapping'],
  ['validating', 'planning'],
  ['validating', 'planning_ready'],
  ['planning', 'planning_ready'],
  ['planning_ready', 'active'],
  ['active', 'stale'],
  ['stale', 'mapping'],
  ['active', 'incompatible'],
  ['incompatible', 'contract_proposed'],
  ['blocked', 'contract_proposed'],
  ['active', 'deactivated'],
  ['deactivated', 'discovered'],
  ['discovered', 'incompatible'],
  ['contract_proposed', 'incompatible'],
];

const EXPECTED = new Set<string>([...DIAGRAM.map(([a, b]) => `${a}>${b}`), ...PRE_ACTIVATION.map((s) => `${s}>blocked`)]);

describe('onboarding transition table', () => {
  it('has 14 states', () => {
    assert.equal(ONBOARDING_STATES.length, 14);
  });

  it('accepts every edge of the lifecycle and nothing else (all 196 ordered pairs)', () => {
    let accepted = 0;
    for (const from of ONBOARDING_STATES) {
      for (const to of ONBOARDING_STATES) {
        const result = assertTransition(from, to);
        if (EXPECTED.has(`${from}>${to}`)) {
          assert.ok(result.ok, `${from} -> ${to} must be accepted`);
          accepted += 1;
        } else {
          assert.ok(!result.ok, `${from} -> ${to} must be rejected`);
          assert.equal(result.error.kind, 'invalid', `${from} -> ${to} is rejected as invalid`);
        }
      }
    }
    assert.equal(accepted, EXPECTED.size);
  });

  it('exports TRANSITIONS with exactly the accepted edges, each once', () => {
    const keys = TRANSITIONS.map(([from, to]) => `${from}>${to}`);
    assert.equal(new Set(keys).size, keys.length, 'no edge is listed twice');
    assert.deepEqual([...keys].sort(), [...EXPECTED].sort());
  });

  it('rejects the named examples', () => {
    for (const [from, to] of [
      ['active', 'mapping'],
      ['unregistered', 'active'],
      ['active', 'blocked'],
      ['blocked', 'mapping'],
      ['validating', 'active'],
      ['mapping', 'mapping'],
    ] as const) {
      const result = assertTransition(from, to);
      assert.ok(!result.ok, `${from} -> ${to}`);
      assert.equal(result.error.kind, 'invalid');
    }
  });

  it('lets every pre-activation state move to blocked, and no other state', () => {
    for (const state of ONBOARDING_STATES) {
      assert.equal(assertTransition(state, 'blocked').ok, PRE_ACTIVATION.includes(state), state);
    }
  });

  it('treats active, blocked, incompatible and deactivated as the stop states', () => {
    const stops = ONBOARDING_STATES.filter((s) => isStopState(s));
    assert.deepEqual([...stops].sort(), ['active', 'blocked', 'deactivated', 'incompatible']);
  });
});
