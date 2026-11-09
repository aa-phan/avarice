// Gates G2 and G4 (AUT-7, AUT-9): pure verdicts over facts AVARICE measured, with failures listed in a fixed rule order.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  G1_RULES,
  G2_RULES,
  G3_RULES,
  G4_RULES,
  INTEGRITY_GATE_RULES,
  PLAN_CITES_ACCEPTANCE_HARD,
  evaluateG1,
  evaluateG2,
  evaluateG3,
  evaluateG4,
  integrityFailures,
} from '../../src/domain/gates.ts';
import type { G1Facts, G2Facts, G3Facts, G4Facts } from '../../src/domain/gates.ts';
import { ROUTINE_PRESET } from '../../src/domain/run-contract.ts';
import type { QuickPlan } from '../../src/domain/quick-record.ts';

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

const PROTECTED = ['package.json', 'package-lock.json', '.github/**', 'tsconfig.json'];

function g2(over: Partial<G2Facts> = {}): G2Facts {
  return {
    outcome: 'progressed',
    changes: [{ path: 'src/a.ts', status: 'modified' }],
    globs: { write: ['src/**'], create: ['src/**'], artifacts: ['.planning/quick/**'], delete: [], protected: PROTECTED },
    inventory: [],
    verification: 'passed',
    newOverrides: 0,
    pruneEntries: 0,
    delta: [],
    ...over,
  };
}

describe('evaluateG2', () => {
  it('passes a progressed unit that changed one path inside the write set', () => {
    assert.deepEqual(evaluateG2(g2()), { passed: true, failures: [] });
  });

  it('lists the rules in their fixed order', () => {
    assert.deepEqual([...G2_RULES], ['outcome-progressed', 'scope-conformance', 'deletion-scope', 'test-inventory', 'gsd-verification', 'no-new-overrides', 'prune-is-decision', 'checks-delta']);
  });

  const cases: Array<[string, Partial<G2Facts>]> = [
    ['outcome-progressed', { outcome: 'no_progress' }],
    ['scope-conformance', { changes: [{ path: 'docs/x.md', status: 'modified' }] }],
    ['deletion-scope', { changes: [{ path: 'src/a.ts', status: 'deleted' }] }],
    ['test-inventory', { inventory: [{ rule: 'removed-test', detail: 'b works' }] }],
    ['gsd-verification', { verification: 'gaps_found' }],
    ['no-new-overrides', { newOverrides: 1 }],
    ['prune-is-decision', { pruneEntries: 1 }],
    ['checks-delta', { delta: [{ name: 'test', reason: 'regressed' }] }],
  ];
  for (const [rule, over] of cases) {
    it(`fails alone on ${rule}`, () => {
      const verdict = evaluateG2(g2(over));
      assert.equal(verdict.passed, false);
      assert.deepEqual(verdict.failures.map((f) => f.rule), [rule]);
      assert.ok((verdict.failures[0]?.detail ?? '').length > 0);
    });
  }

  it('fails every outcome that is not progressed, paused and failed included', () => {
    for (const outcome of ['paused', 'failed', 'denied', 'budget_exhausted', 'inconclusive', 'no_progress']) {
      assert.deepEqual(evaluateG2(g2({ outcome: outcome as G2Facts['outcome'] })).failures.map((f) => f.rule), ['outcome-progressed'], outcome);
    }
  });

  it('does not match a sibling that shares the prefix of a write glob', () => {
    const verdict = evaluateG2(g2({ changes: [{ path: 'src-evil/a.ts', status: 'modified' }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['scope-conformance']);
    assert.match(verdict.failures[0]?.detail ?? '', /src-evil\/a\.ts/);
  });

  it('fails a protected path even when the write glob is **', () => {
    const verdict = evaluateG2(g2({
      changes: [{ path: 'package.json', status: 'modified' }],
      globs: { write: ['**'], create: ['**'], artifacts: [], delete: [], protected: PROTECTED },
    }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['scope-conformance']);
    assert.match(verdict.failures[0]?.detail ?? '', /protected/);
  });

  it('fails a protected path that is also an artifact glob', () => {
    const verdict = evaluateG2(g2({
      changes: [{ path: '.github/workflows/ci.yml', status: 'added' }],
      globs: { write: ['src/**'], create: ['src/**'], artifacts: ['.github/**'], delete: [], protected: PROTECTED },
    }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['scope-conformance']);
  });

  it('passes an added artifact under .planning/quick', () => {
    assert.equal(evaluateG2(g2({ changes: [{ path: '.planning/quick/x/PLAN.md', status: 'added' }] })).passed, true);
  });

  it('passes an added path inside the create glob and fails one that only the write glob covers when create is narrower', () => {
    const globs = { write: ['src/**'], create: ['src/new/**'], artifacts: [], delete: [], protected: PROTECTED };
    assert.equal(evaluateG2(g2({ changes: [{ path: 'src/new/a.ts', status: 'added' }], globs })).passed, true);
    assert.deepEqual(evaluateG2(g2({ changes: [{ path: 'src/old/a.ts', status: 'added' }], globs })).failures.map((f) => f.rule), ['scope-conformance']);
  });

  it('fails a deletion with an empty delete list, and passes one inside a delete glob', () => {
    assert.deepEqual(evaluateG2(g2({ changes: [{ path: 'src/a.ts', status: 'deleted' }] })).failures.map((f) => f.rule), ['deletion-scope']);
    const globs = { write: ['src/**'], create: ['src/**'], artifacts: [], delete: ['src/old/**'], protected: PROTECTED };
    assert.equal(evaluateG2(g2({ changes: [{ path: 'src/old/a.ts', status: 'deleted' }], globs })).passed, true);
  });

  it('fails the deletion of a protected path on both scope rules', () => {
    const verdict = evaluateG2(g2({ changes: [{ path: 'package.json', status: 'deleted' }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['scope-conformance', 'deletion-scope']);
  });

  it('fails a change status it does not know rather than passing it', () => {
    const verdict = evaluateG2(g2({ changes: [{ path: 'src/a.ts', status: 'mystery' as never }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['scope-conformance']);
  });

  it('fails every GSD verification status other than passed, a missing one included (AUT-7)', () => {
    for (const verification of ['gaps_found', 'human_needed', 'missing'] as const) {
      assert.deepEqual(evaluateG2(g2({ verification })).failures.map((f) => f.rule), ['gsd-verification'], verification);
    }
  });

  it('reports several failures in rule order', () => {
    const verdict = evaluateG2(g2({ outcome: 'failed', pruneEntries: 2, verification: 'missing', delta: [{ name: 'lint', reason: 'missing' }] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['outcome-progressed', 'gsd-verification', 'prune-is-decision', 'checks-delta']);
  });

  it('is idempotent and independent of the order of the path lists (AUT-9)', () => {
    const facts = g2({
      changes: [
        { path: 'src/b.ts', status: 'deleted' },
        { path: 'docs/z.md', status: 'modified' },
        { path: 'package.json', status: 'modified' },
        { path: 'src/a.ts', status: 'modified' },
      ],
      inventory: [{ rule: 'new-skip-marker', detail: 'b' }, { rule: 'removed-test', detail: 'a' }],
      delta: [{ name: 'b', reason: 'regressed' }, { name: 'a', reason: 'missing' }],
    });
    const reversed: G2Facts = {
      ...facts,
      changes: [...facts.changes].reverse(),
      inventory: [...facts.inventory].reverse(),
      delta: [...facts.delta].reverse(),
      globs: { ...facts.globs, write: [...facts.globs.write].reverse(), protected: [...facts.globs.protected].reverse() },
    };
    assert.deepEqual(evaluateG2(facts), evaluateG2(facts));
    assert.deepEqual(evaluateG2(facts), evaluateG2(reversed));
  });
});

function plan(over: Partial<QuickPlan> = {}): QuickPlan {
  return { filesModified: ['src/lib/copy.ts'], taskFiles: ['src/lib/copy.ts'], decisionCheckpoints: [], acceptanceRefs: ['AC1'], ...over };
}

function g1(over: Partial<G1Facts> = {}): G1Facts {
  return {
    plan: plan(),
    globs: { write: ['src/**'], create: ['src/**', 'test/**'], protected: ['.github/**'] },
    itemSpec: { files: ['src/**'], derived: ['files'] },
    outcome: 'progressed',
    ownerChoices: [],
    itemAcceptance: ['AC1'],
    ...over,
  };
}

describe('evaluateG1 (tracer: write scope, item spec, an unasked owner choice)', () => {
  it('lists the rules in their fixed order', () => {
    assert.deepEqual([...G1_RULES], ['plan-present', 'plan-within-write-scope', 'plan-within-spec', 'decision-checkpoint-unresolved', 'owner-choice-unasked', 'plan-cites-acceptance']);
  });

  it('passes a plan whose paths sit inside the write set and the spec, with nothing unasked', () => {
    assert.deepEqual(evaluateG1(g1()), { passed: true, failures: [] });
  });

  it('fails plan-present when there is no plan text, and judges nothing else on a missing plan', () => {
    const verdict = evaluateG1(g1({ plan: null, ownerChoices: [{ acceptanceId: 'AC3', key: 'k', answered: false }] }));
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-present']);
  });

  it('fails plan-within-write-scope naming the path outside files.write and files.create', () => {
    const verdict = evaluateG1(g1({ plan: plan({ filesModified: ['src/lib/copy.ts', 'docs/x.md'], taskFiles: ['docs/x.md'] }) }));
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-within-write-scope']);
    assert.match(verdict.failures[0]?.detail ?? '', /docs\/x\.md/);
    assert.doesNotMatch(verdict.failures[0]?.detail ?? '', /src\/lib\/copy\.ts/);
  });

  it('lets a plan path that only files.create allows pass, and a protected glob win over the write set', () => {
    assert.equal(evaluateG1(g1({ globs: { write: ['src/**'], create: ['test/**'], protected: [] }, plan: plan({ filesModified: ['test/new.test.ts'], taskFiles: [] }), itemSpec: { files: [], derived: ['files'] } })).passed, true);
    const verdict = evaluateG1(g1({ globs: { write: ['**'], create: ['**'], protected: ['.github/**'] }, plan: plan({ filesModified: ['.github/workflows/ci.yml'], taskFiles: [] }), itemSpec: { files: [], derived: ['files'] } }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-within-write-scope']);
    assert.match(verdict.failures[0]?.detail ?? '', /protected/);
  });

  it('treats an absolute path, a .. segment and a backslash as outside the contract whatever the globs say, and drops a leading ./', () => {
    const wide = { write: ['**'], create: ['**'], protected: [] };
    const bad = evaluateG1(g1({ globs: wide, plan: plan({ filesModified: ['../outside.ts', '/etc/passwd', 'src\\x.ts', 'src/../../y.ts'], taskFiles: [] }) }));
    assert.deepEqual(bad.failures.map((f) => f.rule), ['plan-within-write-scope']);
    for (const path of ['../outside.ts', '/etc/passwd', 'src\\x.ts', 'src/../../y.ts']) assert.ok((bad.failures[0]?.detail ?? '').includes(path), path);
    assert.equal(evaluateG1(g1({ plan: plan({ filesModified: ['./src/lib/copy.ts'], taskFiles: [] }) })).passed, true);
  });

  it('fails plan-within-spec for a path inside the write set but outside the explicit item spec files', () => {
    const verdict = evaluateG1(g1({ itemSpec: { files: ['src/lib/copy.ts'], derived: [] }, plan: plan({ filesModified: ['src/lib/dates.ts'], taskFiles: [] }) }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-within-spec']);
    assert.match(verdict.failures[0]?.detail ?? '', /src\/lib\/dates\.ts/);
  });

  it('judges against the write set only when the item spec files are derived', () => {
    const verdict = evaluateG1(g1({ itemSpec: { files: ['src/lib/copy.ts'], derived: ['files', 'symbols'] }, plan: plan({ filesModified: ['src/lib/dates.ts'], taskFiles: [] }) }));
    assert.deepEqual(verdict, { passed: true, failures: [] });
  });

  it('fails owner-choice-unasked naming the acceptance ID, and passes once the choice is answered', () => {
    const unasked = evaluateG1(g1({ ownerChoices: [{ acceptanceId: 'AC3', key: 'fallback-wording', answered: false }] }));
    assert.deepEqual(unasked.failures.map((f) => f.rule), ['owner-choice-unasked']);
    assert.match(unasked.failures[0]?.detail ?? '', /AC3/);
    assert.match(unasked.failures[0]?.detail ?? '', /fallback-wording/);
    assert.deepEqual(evaluateG1(g1({ ownerChoices: [{ acceptanceId: 'AC3', key: 'fallback-wording', answered: true }] })), { passed: true, failures: [] });
  });

  it('gives a deep-equal verdict whatever order the path lists and choices arrive in', () => {
    const a = g1({
      plan: plan({ filesModified: ['docs/b.md', 'docs/a.md', 'src/x.ts'], taskFiles: ['docs/c.md'] }),
      ownerChoices: [{ acceptanceId: 'AC9', key: 'z', answered: false }, { acceptanceId: 'AC2', key: 'y', answered: false }],
      globs: { write: ['src/**', 'lib/**'], create: ['test/**', 'src/**'], protected: [] },
    });
    const b = g1({
      plan: plan({ filesModified: ['src/x.ts', 'docs/a.md', 'docs/b.md'], taskFiles: ['docs/c.md'] }),
      ownerChoices: [{ acceptanceId: 'AC2', key: 'y', answered: false }, { acceptanceId: 'AC9', key: 'z', answered: false }],
      globs: { write: ['lib/**', 'src/**'], create: ['src/**', 'test/**'], protected: [] },
    });
    assert.deepEqual(evaluateG1(a), evaluateG1(b));
    assert.equal(evaluateG1(a).passed, false);
  });
});

describe('evaluateG1 (decision checkpoints and the acceptance citation)', () => {
  const unresolved = plan({ decisionCheckpoints: [{ hasAutoSelect: false, optionIds: ['a', 'b'] }] });

  it('fails decision-checkpoint-unresolved when a checkpoint has no auto_select and the unit progressed anyway', () => {
    const verdict = evaluateG1(g1({ plan: unresolved }));
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['decision-checkpoint-unresolved']);
    assert.match(verdict.failures[0]?.detail ?? '', /a, b/);
  });

  it('passes when the unit paused at the checkpoint, or when every checkpoint carries an auto_select', () => {
    assert.deepEqual(evaluateG1(g1({ plan: unresolved, outcome: 'paused' })), { passed: true, failures: [] });
    const resolved = plan({ decisionCheckpoints: [{ hasAutoSelect: true, optionIds: ['a'] }, { hasAutoSelect: true, optionIds: [] }] });
    assert.deepEqual(evaluateG1(g1({ plan: resolved })), { passed: true, failures: [] });
  });

  it('records plan-cites-acceptance as an advisory while the constant is false, leaving passed true', () => {
    assert.equal(PLAN_CITES_ACCEPTANCE_HARD, false);
    const verdict = evaluateG1(g1({ plan: plan({ acceptanceRefs: ['AC7'] }), itemAcceptance: ['AC1', 'AC2'] }));
    assert.equal(verdict.passed, true);
    assert.deepEqual(verdict.failures, []);
    assert.deepEqual(verdict.advisories?.map((a) => a.rule), ['plan-cites-acceptance']);
    assert.match(verdict.advisories?.[0]?.detail ?? '', /AC1, AC2/);
  });

  it('moves plan-cites-acceptance into failures when the hard option is set', () => {
    const verdict = evaluateG1(g1({ plan: plan({ acceptanceRefs: [] }), itemAcceptance: ['AC1'] }), { citesAcceptanceHard: true });
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-cites-acceptance']);
    assert.equal(verdict.advisories, undefined);
  });

  it('is satisfied by one cited ID, and by an item with no acceptance IDs, and leaves no advisories key then', () => {
    for (const hard of [false, true]) {
      assert.deepEqual(evaluateG1(g1({ plan: plan({ acceptanceRefs: ['AC2'] }), itemAcceptance: ['AC1', 'AC2'] }), { citesAcceptanceHard: hard }), { passed: true, failures: [] });
      assert.deepEqual(evaluateG1(g1({ plan: plan({ acceptanceRefs: [] }), itemAcceptance: [] }), { citesAcceptanceHard: hard }), { passed: true, failures: [] });
    }
  });

  it('lists every failing rule in the fixed G1 order', () => {
    const verdict = evaluateG1(
      g1({
        plan: plan({ filesModified: ['docs/x.md'], taskFiles: [], decisionCheckpoints: [{ hasAutoSelect: false, optionIds: ['a'] }], acceptanceRefs: [] }),
        itemSpec: { files: ['src/lib/copy.ts'], derived: [] },
        ownerChoices: [{ acceptanceId: 'AC3', key: 'k', answered: false }],
      }),
      { citesAcceptanceHard: true },
    );
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['plan-within-write-scope', 'plan-within-spec', 'decision-checkpoint-unresolved', 'owner-choice-unasked', 'plan-cites-acceptance']);
  });

  it('never lets plan text pass: a plan that claims auto_select, cites every ID and stays inside scope still fails an unanswered owner choice', () => {
    const claims = plan({ decisionCheckpoints: [{ hasAutoSelect: true, optionIds: ['a'] }], acceptanceRefs: ['AC1', 'AC2', 'AC3'] });
    const verdict = evaluateG1(g1({ plan: claims, ownerChoices: [{ acceptanceId: 'AC3', key: 'k', answered: false }] }), { citesAcceptanceHard: true });
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['owner-choice-unasked']);
  });
});

function g3(over: Partial<G3Facts> = {}): G3Facts {
  return {
    repairAttempts: 0,
    limit: 1,
    failingTests: ['copy > names the address'],
    inventoryAfter: ['copy > names the address', 'copy > other'],
    testFilesOfFailing: ['tests/unit/copy.test.ts'],
    changes: [{ path: 'src/lib/copy.ts', status: 'modified' }],
    authorizedTestPaths: [],
    ...over,
  };
}

describe('evaluateG3', () => {
  it('lists the rules in their fixed order', () => {
    assert.deepEqual([...G3_RULES], ['repair-limit', 'failing-test-present', 'failing-test-unchanged']);
  });

  it('passes a repair below the limit that kept the failing test and left its file alone', () => {
    assert.deepEqual(evaluateG3(g3()), { passed: true, failures: [] });
  });

  it('fails repair-limit once the attempts reach the limit, and a limit of 0 fails on the first look', () => {
    assert.deepEqual(evaluateG3(g3({ repairAttempts: 1, limit: 1 })).failures.map((f) => f.rule), ['repair-limit']);
    assert.deepEqual(evaluateG3(g3({ repairAttempts: 0, limit: 0 })).failures.map((f) => f.rule), ['repair-limit']);
    assert.equal(evaluateG3(g3({ repairAttempts: 1, limit: 2 })).passed, true);
  });

  it('fails failing-test-present when a failing test ID is gone from the inventory after the repair', () => {
    const verdict = evaluateG3(g3({ inventoryAfter: ['copy > other'] }));
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['failing-test-present']);
    assert.match(verdict.failures[0]?.detail ?? '', /copy > names the address/);
  });

  it('fails failing-test-unchanged when the file holding the failing test changed, whatever the change status', () => {
    for (const status of ['modified', 'deleted', 'added'] as const) {
      const verdict = evaluateG3(g3({ changes: [{ path: 'tests/unit/copy.test.ts', status }] }));
      assert.deepEqual(verdict.failures.map((f) => f.rule), ['failing-test-unchanged'], status);
      assert.match(verdict.failures[0]?.detail ?? '', /tests\/unit\/copy\.test\.ts/);
    }
  });

  it('passes the same change when an amendment authorized that test path, and not when it authorized another', () => {
    const changes = [{ path: 'tests/unit/copy.test.ts', status: 'modified' as const }];
    assert.deepEqual(evaluateG3(g3({ changes, authorizedTestPaths: ['tests/unit/copy.test.ts'] })), { passed: true, failures: [] });
    assert.equal(evaluateG3(g3({ changes, authorizedTestPaths: ['tests/unit/other.test.ts'] })).passed, false);
  });

  it('lists every failing rule in order and gives a deep-equal verdict whatever order the lists arrive in', () => {
    const a = g3({
      repairAttempts: 2,
      limit: 2,
      failingTests: ['t2', 't1'],
      inventoryAfter: [],
      testFilesOfFailing: ['tests/b.test.ts', 'tests/a.test.ts'],
      changes: [{ path: 'tests/b.test.ts', status: 'modified' }, { path: 'tests/a.test.ts', status: 'deleted' }],
    });
    const b = g3({
      repairAttempts: 2,
      limit: 2,
      failingTests: ['t1', 't2'],
      inventoryAfter: [],
      testFilesOfFailing: ['tests/a.test.ts', 'tests/b.test.ts'],
      changes: [{ path: 'tests/a.test.ts', status: 'deleted' }, { path: 'tests/b.test.ts', status: 'modified' }],
    });
    assert.deepEqual(evaluateG3(a).failures.map((f) => f.rule), ['repair-limit', 'failing-test-present', 'failing-test-unchanged']);
    assert.deepEqual(evaluateG3(a), evaluateG3(b));
  });
});

describe('the integrity gates of the routine preset', () => {
  const RULES: Record<string, readonly string[]> = { G1: G1_RULES, G2: G2_RULES, G3: G3_RULES };
  const INVENTORY_RULES = ['removed-test', 'new-skip-marker', 'lowered-test-count'];

  it('maps every integrity gate the preset lists to at least one rule that exists, and lists no gate the preset lacks', () => {
    const gates = [...ROUTINE_PRESET.verification.integrityGates];
    assert.deepEqual(Object.keys(INTEGRITY_GATE_RULES).sort(), [...gates].sort());
    for (const gate of gates) {
      const refs = INTEGRITY_GATE_RULES[gate] ?? [];
      assert.ok(refs.length > 0, `${gate} maps to nothing`);
      for (const ref of refs) {
        const [which, rule, sub] = ref.split(':');
        assert.ok(RULES[which as string]?.includes(rule as string), `${gate} -> ${ref}: no such rule`);
        if (sub !== undefined) {
          assert.equal(rule, 'test-inventory', `${gate} -> ${ref}: only test-inventory has sub-rules`);
          assert.ok(INVENTORY_RULES.includes(sub), `${gate} -> ${ref}: no such inventory rule`);
        }
      }
    }
  });

  it('names the broken integrity gates of a set of verdicts, sorted, and none for a clean set', () => {
    const gates = ROUTINE_PRESET.verification.integrityGates;
    assert.deepEqual(integrityFailures({ G1: { passed: true, failures: [] }, G2: { passed: true, failures: [] } }, gates), []);
    const g2 = { passed: false, failures: [{ rule: 'no-new-overrides', detail: '1 new VERIFICATION override(s)' }, { rule: 'prune-is-decision', detail: '1 node-repair PRUNE entry' }] };
    assert.deepEqual(integrityFailures({ G2: g2 }, gates), ['no-new-overrides', 'prune-is-decision']);
  });

  it('attributes a test-inventory failure to the gate of its inventory rule only', () => {
    const gates = ROUTINE_PRESET.verification.integrityGates;
    const removed = { passed: false, failures: [{ rule: 'test-inventory', detail: 'the test inventory weakened: removed-test: test IDs present at base and missing after: b works' }] };
    assert.deepEqual(integrityFailures({ G2: removed }, gates), ['no-test-deletion']);
    const marker = { passed: false, failures: [{ rule: 'test-inventory', detail: 'the test inventory weakened: new-skip-marker: skip or focus markers added in: a.test.ts' }] };
    assert.deepEqual(integrityFailures({ G2: marker }, gates), ['no-skip-markers']);
  });

  it('attributes a G1 scope failure and a G3 failing-test-unchanged failure, and ignores advisories', () => {
    const gates = ROUTINE_PRESET.verification.integrityGates;
    assert.deepEqual(integrityFailures({ G1: { passed: false, failures: [{ rule: 'plan-within-write-scope', detail: 'x' }] } }, gates), ['scope-conformance']);
    assert.deepEqual(integrityFailures({ G3: { passed: false, failures: [{ rule: 'failing-test-unchanged', detail: 'x' }] } }, gates), ['no-test-deletion']);
    assert.deepEqual(integrityFailures({ G1: { passed: true, failures: [], advisories: [{ rule: 'plan-cites-acceptance', detail: 'x' }] } }, gates), []);
  });

  it('judges only the gates it is asked about', () => {
    const g2 = { passed: false, failures: [{ rule: 'no-new-overrides', detail: 'x' }, { rule: 'scope-conformance', detail: 'y' }] };
    assert.deepEqual(integrityFailures({ G2: g2 }, ['scope-conformance']), ['scope-conformance']);
    assert.deepEqual(integrityFailures({ G2: g2 }, ['not-a-gate']), []);
  });
});
