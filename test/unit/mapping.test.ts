// chooseMappingMode: the decision table of docs/repository-onboarding.md "Mapping-mode decision table", as far
// as Phase 1 implements it (skip, fast, full; adoption and path scope arrive in Phase 4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMappingMode } from '../../src/domain/mapping.ts';
import type { ExistingMapClass } from '../../src/domain/preflight.ts';

const EXISTING: readonly ExistingMapClass[] = ['none', 'stamped-complete', 'stamped-partial', 'unstamped', 'unknown-format', 'user-edited'];

describe('chooseMappingMode', () => {
  it('skips mapping, with completeness none, when the repository is not brownfield', () => {
    for (const requested of [undefined, 'full', 'fast']) {
      const decision = chooseMappingMode({ isBrownfield: false, ...(requested !== undefined ? { requested } : {}) });
      assert.ok(decision.ok, JSON.stringify(decision));
      assert.equal(decision.value.mode, 'skip');
      assert.equal(decision.value.completeness, 'none');
    }
  });

  it('maps fast, with completeness partial, when fast is requested', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'fast' });
    assert.ok(decision.ok, JSON.stringify(decision));
    assert.equal(decision.value.mode, 'fast');
    assert.equal(decision.value.completeness, 'partial');
  });

  it('maps full, with completeness complete, by default and when full is requested', () => {
    for (const requested of [undefined, 'full']) {
      const decision = chooseMappingMode({ isBrownfield: true, ...(requested !== undefined ? { requested } : {}) });
      assert.ok(decision.ok, JSON.stringify(decision));
      assert.equal(decision.value.mode, 'full');
      assert.equal(decision.value.completeness, 'complete');
    }
  });

  it('answers unsupported with reduced mode fast for a path-scoped request (Phase 4)', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'paths' });
    assert.ok(!decision.ok);
    assert.equal(decision.error.kind, 'unsupported');
    assert.ok(decision.error.kind === 'unsupported');
    assert.equal(decision.error.reducedMode, 'fast');
  });

  it('regenerates in staging (full) for every existing-map classification, and keeps the classification', () => {
    for (const existingMap of EXISTING) {
      const decision = chooseMappingMode({ isBrownfield: true, existingMap });
      assert.ok(decision.ok, `${existingMap}: ${JSON.stringify(decision)}`);
      assert.equal(decision.value.mode, 'full', existingMap);
      assert.equal(decision.value.existingMap, existingMap);
    }
  });

  it('honours an explicit fast request even when a map already exists', () => {
    const decision = chooseMappingMode({ isBrownfield: true, requested: 'fast', existingMap: 'stamped-complete' });
    assert.ok(decision.ok);
    assert.equal(decision.value.mode, 'fast');
  });

  it('refuses a mode name it does not know and adoption (deferred)', () => {
    const unknown = chooseMappingMode({ isBrownfield: true, requested: 'sideways' });
    assert.ok(!unknown.ok);
    assert.equal(unknown.error.kind, 'invalid');
    const adopt = chooseMappingMode({ isBrownfield: true, requested: 'adopt' });
    assert.ok(!adopt.ok);
    assert.equal(adopt.error.kind, 'unsupported');
  });
});
