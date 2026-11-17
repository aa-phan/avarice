// Preflight classification (docs/repository-onboarding.md "Existing state and migration", ONB-6): the pure
// rules that turn repository facts and the ledger's view into findings or a refusal.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ONBOARDING_STATES } from '../../src/domain/onboarding-lifecycle.ts';
import type { OnboardingState } from '../../src/domain/onboarding-lifecycle.ts';
import { classifyExistingMap, classifyPreflight, existingMapOutcome, userOwnedPaths } from '../../src/domain/preflight.ts';
import type { ExistingMapClass, LedgerView, MapFileFacts, RepoFacts } from '../../src/domain/preflight.ts';

const SEVEN = ['STACK', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'INTEGRATIONS', 'CONCERNS'];
const FOUR = ['STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE'];
const STAMP = 'a'.repeat(40);
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);

function mapFile(name: string, over: Partial<MapFileFacts> = {}): MapFileFacts {
  return { path: `.planning/codebase/${name}.md`, lastMappedCommit: STAMP, stampCommit: C1, lastCommit: C1, ...over };
}

function facts(over: Partial<RepoFacts> = {}): RepoFacts {
  return {
    gitRoot: '/work/repo',
    rootCommit: 'f'.repeat(40),
    pin: 'e'.repeat(40),
    branch: 'main',
    defaultBranch: 'main',
    modified: [],
    untracked: [],
    planningFiles: [],
    codebaseMapFiles: [],
    submodules: [],
    nestedRepos: [],
    workspaceManifests: [],
    instructionFiles: [],
    adrDirs: [],
    runtimes: [],
    trackedFiles: 3,
    trackedBytes: 120,
    ...over,
  };
}

const NO_STATE: LedgerView = { activeRecord: null, onboardings: [] };
const ACTIVE = { recordVersion: 3, onboardedRevision: 'a'.repeat(40) };

describe('classifyExistingMap', () => {
  const cases: Array<[string, Partial<RepoFacts>, string]> = [
    ['no codebase map', {}, 'none'],
    ['no codebase map and unrelated dirty files', { modified: ['src/a.ts'], untracked: ['notes.txt'] }, 'none'],
    ['seven stamped, untouched files', { codebaseMapFiles: SEVEN.map((n) => mapFile(n)) }, 'stamped-complete'],
    ['four stamped files (a fast map)', { codebaseMapFiles: FOUR.map((n) => mapFile(n)) }, 'stamped-partial'],
    ['files without last_mapped_commit', { codebaseMapFiles: SEVEN.map((n) => mapFile(n, { lastMappedCommit: null, stampCommit: null })) }, 'unstamped'],
    ['one file without a stamp among stamped files', { codebaseMapFiles: SEVEN.map((n, i) => mapFile(n, i === 0 ? { lastMappedCommit: null, stampCommit: null } : {})) }, 'unstamped'],
    ['a file set that is not the seven or the four', { codebaseMapFiles: [mapFile('STACK'), mapFile('NOTES')] }, 'unknown-format'],
    ['a commit touching a map file after its stamp commit', { codebaseMapFiles: SEVEN.map((n) => mapFile(n, n === 'TESTING' ? { lastCommit: C2 } : {})) }, 'user-edited'],
    ['an uncommitted change to a map file', { codebaseMapFiles: SEVEN.map((n) => mapFile(n)), modified: ['.planning/codebase/STACK.md'] }, 'user-edited'],
    ['an uncommitted change elsewhere under .planning/', { codebaseMapFiles: SEVEN.map((n) => mapFile(n)), untracked: ['.planning/notes.md'] }, 'user-edited'],
    ['an uncommitted map that is not in the commit at all', { untracked: ['.planning/codebase/STACK.md'] }, 'user-edited'],
    ['an unknown file set that was also edited (unknown wins)', { codebaseMapFiles: [mapFile('STACK', { lastCommit: C2 }), mapFile('NOTES')] }, 'unknown-format'],
    ['an unstamped map that was also edited (the edit wins)', { codebaseMapFiles: SEVEN.map((n) => mapFile(n, { lastMappedCommit: null, stampCommit: null })), modified: ['.planning/codebase/STACK.md'] }, 'user-edited'],
    ['a stamp whose introducing commit is not known is not evidence of an edit', { codebaseMapFiles: SEVEN.map((n) => mapFile(n, { stampCommit: null })) }, 'stamped-complete'],
  ];
  for (const [name, over, expected] of cases) {
    it(`${name} is ${expected}`, () => {
      assert.equal(classifyExistingMap(facts(over)), expected);
    });
  }
});

describe('classifyPreflight findings', () => {
  it('records the existing-state signals and the names that stay unmapped, nothing else', () => {
    const result = classifyPreflight(
      facts({
        modified: ['src/b.ts', 'src/a.ts'],
        untracked: ['.env', 'src/a.ts'],
        planningFiles: ['.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/STATE.md'],
        instructionFiles: ['CLAUDE.md', '.claude/'],
        submodules: ['vendor/sub'],
        nestedRepos: ['apps/other/'],
        workspaceManifests: ['package.json', 'turbo.json'],
        adrDirs: ['docs/decisions'],
        runtimes: ['.nvmrc:22'],
        trackedFiles: 42,
        trackedBytes: 4242,
      }),
      NO_STATE,
      {},
    );
    assert.ok(result.ok);
    const { findings, continueOnboardingId } = result.value;
    assert.equal(continueOnboardingId, null);
    assert.deepEqual(findings['notMapped'], ['.env', 'src/a.ts', 'src/b.ts']);
    assert.deepEqual(findings['untracked'], ['.env', 'src/a.ts']);
    assert.deepEqual(findings['instructionFiles'], ['.claude/', 'CLAUDE.md']);
    assert.deepEqual(findings['submodules'], ['vendor/sub']);
    assert.deepEqual(findings['nestedRepos'], ['apps/other/']);
    assert.deepEqual(findings['workspaceManifests'], ['package.json', 'turbo.json']);
    assert.deepEqual(findings['adrDirs'], ['docs/decisions']);
    assert.deepEqual(findings['adrDirectories'], ['docs/decisions'], 'the contract compiler reads this name');
    assert.deepEqual(findings['runtimes'], ['.nvmrc:22']);
    assert.equal(findings['trackedFiles'], 42);
    assert.equal(findings['trackedBytes'], 4242);
    assert.deepEqual(findings['existingState'], { planningExists: true, codebaseMap: 'none', outcome: 'map', drift: null, userOwned: [] });
  });

  it('a repository like the target (committed PROJECT, ROADMAP and STATE, no map) proceeds with planningExists true and codebaseMap none', () => {
    const result = classifyPreflight(facts({ planningFiles: ['.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/STATE.md'] }), NO_STATE, {});
    assert.ok(result.ok);
    assert.deepEqual(result.value.findings['existingState'], { planningExists: true, codebaseMap: 'none', outcome: 'map', drift: null, userOwned: [] });
  });

  it('records the class and the outcome without a drift verdict: a complete stamped map waits for GSD in staging, a partial one is mapped in full', () => {
    const complete = classifyPreflight(facts({ codebaseMapFiles: SEVEN.map((n) => mapFile(n)), planningFiles: ['.planning/codebase/STACK.md'] }), NO_STATE, {});
    assert.ok(complete.ok);
    assert.deepEqual(complete.value.findings['existingState'], { planningExists: true, codebaseMap: 'stamped-complete', outcome: 'full-in-staging', drift: null, userOwned: [] });
    const partial = classifyPreflight(facts({ codebaseMapFiles: FOUR.map((n) => mapFile(n)) }), NO_STATE, {});
    assert.ok(partial.ok);
    assert.deepEqual(partial.value.findings['existingState'], { planningExists: false, codebaseMap: 'stamped-partial', outcome: 'full-in-staging', drift: null, userOwned: [] });
  });
});

describe('classifyPreflight refusals (ONB-6)', () => {
  function refusal(result: ReturnType<typeof classifyPreflight>): { kind: string; text: string } {
    assert.equal(result.ok, false, 'expected a refusal');
    const error = (result as { ok: false; error: { kind: string; expected?: string; actual?: string; field?: string; reason?: string } }).error;
    return { kind: error.kind, text: JSON.stringify(error) };
  }

  it('plans a refresh, not a refusal, when an active record exists for the project (ONB-11)', () => {
    const result = classifyPreflight(facts(), { activeRecord: ACTIVE, onboardings: [{ onboardingId: 'onb_x', state: 'active' }] }, {});
    assert.ok(result.ok, 'an active project is refreshed');
    assert.deepEqual(result.value.findings['refreshOf'], { recordVersion: 3, onboardedRevision: 'a'.repeat(40) });
    assert.equal(result.value.continueOnboardingId, null, 'the stopped onboarding of the earlier record is not continued');
  });

  it('states no refresh for a project without an active record', () => {
    const result = classifyPreflight(facts(), NO_STATE, {});
    assert.ok(result.ok);
    assert.equal('refreshOf' in result.value.findings, false);
  });

  it('still refuses a refresh while another onboarding of the project is running', () => {
    const r = refusal(classifyPreflight(facts(), { activeRecord: ACTIVE, onboardings: [{ onboardingId: 'onb_run', state: 'mapping' }] }, {}));
    assert.equal(r.kind, 'conflict');
    assert.match(r.text, /existing_state_conflict/);
    assert.match(r.text, /onb_run/);
  });

  const NON_STOP: OnboardingState[] = ['contract_proposed', 'mapping', 'paused', 'validating', 'validation_failed', 'planning', 'planning_ready', 'stale'];
  for (const state of NON_STOP) {
    it(`refuses with existing_state_conflict while another onboarding is ${state}`, () => {
      const r = refusal(classifyPreflight(facts(), { activeRecord: null, onboardings: [{ onboardingId: 'onb_other', state }] }, {}));
      assert.equal(r.kind, 'conflict');
      assert.match(r.text, /existing_state_conflict/);
      assert.match(r.text, /onb_other/);
    });
  }

  for (const state of ['blocked', 'incompatible', 'deactivated'] as const) {
    it(`does not refuse because of an onboarding that stopped as ${state}`, () => {
      assert.ok(classifyPreflight(facts(), { activeRecord: null, onboardings: [{ onboardingId: 'onb_old', state }] }, {}).ok);
    });
  }

  it('continues an onboarding that is still in discovered instead of creating a second one', () => {
    const r = classifyPreflight(facts(), { activeRecord: null, onboardings: [{ onboardingId: 'onb_first', state: 'discovered' }] }, {});
    assert.ok(r.ok);
    assert.equal(r.value.continueOnboardingId, 'onb_first');
  });

  it('refuses when a discovered onboarding exists next to one that is already running', () => {
    const r = refusal(classifyPreflight(facts(), { activeRecord: null, onboardings: [{ onboardingId: 'onb_a', state: 'discovered' }, { onboardingId: 'onb_b', state: 'mapping' }] }, {}));
    assert.equal(r.kind, 'conflict');
  });

  it('knows every lifecycle state: each is either refused, continued, or ignored', () => {
    for (const state of ONBOARDING_STATES) {
      const result = classifyPreflight(facts(), { activeRecord: null, onboardings: [{ onboardingId: 'onb_s', state }] }, {});
      assert.ok(typeof result.ok === 'boolean', state);
    }
  });

  for (const promote of ['copy', 'commit', '', 'NONE']) {
    it(`refuses promotion ${JSON.stringify(promote)}`, () => {
      const r = refusal(classifyPreflight(facts(), NO_STATE, { promote }));
      assert.equal(r.kind, 'invalid');
      assert.match(r.text, /request\.promote/);
    });
  }

  it('accepts promotion none, and no promotion', () => {
    assert.ok(classifyPreflight(facts(), NO_STATE, { promote: 'none' }).ok);
    assert.ok(classifyPreflight(facts(), NO_STATE, {}).ok);
  });

  it('reports a promotion request before a state conflict', () => {
    const r = refusal(classifyPreflight(facts(), { activeRecord: ACTIVE, onboardings: [] }, { promote: 'copy' }));
    assert.equal(r.kind, 'invalid');
  });
});

describe('existingMapOutcome (ONB-6, D-10)', () => {
  type Drift = 'pass' | 'block' | 'unreadable' | null;
  const DRIFTS: Drift[] = ['pass', 'block', 'unreadable', null];
  // The oracle is the table of docs/repository-onboarding.md "Repositories already using GSD", written out per class and drift value.
  const expected: Record<ExistingMapClass, Record<string, string>> = {
    none: { pass: 'map', block: 'map', unreadable: 'map', null: 'map' },
    'stamped-complete': { pass: 'adopt', block: 'refresh', unreadable: 'full-in-staging', null: 'full-in-staging' },
    'stamped-partial': { pass: 'full-in-staging', block: 'full-in-staging', unreadable: 'full-in-staging', null: 'full-in-staging' },
    unstamped: { pass: 'full-in-staging', block: 'full-in-staging', unreadable: 'full-in-staging', null: 'full-in-staging' },
    'unknown-format': { pass: 'isolated-regeneration', block: 'isolated-regeneration', unreadable: 'isolated-regeneration', null: 'isolated-regeneration' },
    'user-edited': { pass: 'isolated-regeneration', block: 'isolated-regeneration', unreadable: 'isolated-regeneration', null: 'isolated-regeneration' },
  };
  for (const [cls, byDrift] of Object.entries(expected) as Array<[ExistingMapClass, Record<string, string>]>) {
    for (const drift of DRIFTS) {
      it(`${cls} with drift ${String(drift)} is ${byDrift[String(drift)]}`, () => {
        assert.equal(existingMapOutcome(cls, drift), byDrift[String(drift)]);
      });
    }
  }

  it('adopts nothing without a drift pass: the stamp alone never makes a map adoptable (T-04-26)', () => {
    for (const cls of Object.keys(expected) as ExistingMapClass[]) {
      for (const drift of DRIFTS.filter((d) => d !== 'pass')) assert.notEqual(existingMapOutcome(cls, drift), 'adopt', `${cls} ${String(drift)}`);
    }
    for (const cls of Object.keys(expected).filter((c) => c !== 'stamped-complete') as ExistingMapClass[]) assert.notEqual(existingMapOutcome(cls, 'pass'), 'adopt', cls);
  });

  it('refuses a class it does not know', () => {
    assert.throws(() => existingMapOutcome('sideways' as ExistingMapClass, 'pass'), TypeError);
  });
});

describe('userOwnedPaths (ONB-6)', () => {
  const edited = (n: string): MapFileFacts => mapFile(n, { lastCommit: C2 });

  it('lists the map files edited after their stamp commit, and every changed file under .planning/, for an edited map', () => {
    const map = facts({
      codebaseMapFiles: SEVEN.map((n) => (n === 'TESTING' || n === 'STACK' ? edited(n) : mapFile(n))),
      modified: ['.planning/codebase/CONCERNS.md', 'src/a.ts'],
      untracked: ['.planning/notes.md', 'scratch.txt'],
    });
    assert.equal(classifyExistingMap(map), 'user-edited');
    assert.deepEqual(userOwnedPaths(map, 'user-edited'), ['.planning/codebase/CONCERNS.md', '.planning/codebase/STACK.md', '.planning/codebase/TESTING.md', '.planning/notes.md']);
  });

  it('lists every file of a map of another format, and nothing for the classes that are the owner\'s generated output', () => {
    const other = facts({ codebaseMapFiles: [mapFile('STACK'), mapFile('NOTES')] });
    assert.deepEqual(userOwnedPaths(other, 'unknown-format'), ['.planning/codebase/NOTES.md', '.planning/codebase/STACK.md']);
    for (const cls of ['none', 'stamped-complete', 'stamped-partial', 'unstamped'] as const) {
      assert.deepEqual(userOwnedPaths(facts({ codebaseMapFiles: SEVEN.map((n) => edited(n)), modified: ['.planning/x.md'] }), cls), [], cls);
    }
  });

  it('is part of the findings for an edited map and for a map of another format, and empty otherwise', () => {
    const editedMap = classifyPreflight(facts({ codebaseMapFiles: SEVEN.map((n) => (n === 'STACK' ? edited(n) : mapFile(n))) }), NO_STATE, {});
    assert.ok(editedMap.ok);
    assert.deepEqual(editedMap.value.findings['existingState'], { planningExists: false, codebaseMap: 'user-edited', outcome: 'isolated-regeneration', drift: null, userOwned: ['.planning/codebase/STACK.md'] });
    const unknown = classifyPreflight(facts({ codebaseMapFiles: [mapFile('STACK'), mapFile('NOTES')] }), NO_STATE, {});
    assert.ok(unknown.ok);
    assert.deepEqual((unknown.value.findings['existingState'] as { userOwned: string[] }).userOwned, ['.planning/codebase/NOTES.md', '.planning/codebase/STACK.md']);
    const clean = classifyPreflight(facts({ codebaseMapFiles: SEVEN.map((n) => mapFile(n)) }), NO_STATE, {});
    assert.ok(clean.ok);
    assert.deepEqual((clean.value.findings['existingState'] as { userOwned: string[] }).userOwned, []);
  });
});
