// Preflight classification (docs/repository-onboarding.md "Existing state and migration", ONB-6): the pure
// rules that turn repository facts and the ledger's view into findings or a refusal.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ONBOARDING_STATES } from '../../src/domain/onboarding-lifecycle.ts';
import type { OnboardingState } from '../../src/domain/onboarding-lifecycle.ts';
import { EXISTING_MAP_OUTCOME, classifyExistingMap, classifyPreflight } from '../../src/domain/preflight.ts';
import type { LedgerView, MapFileFacts, RepoFacts } from '../../src/domain/preflight.ts';

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

const NO_STATE: LedgerView = { activeRecord: false, onboardings: [] };

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
    assert.deepEqual(findings['existingState'], { planningExists: true, codebaseMap: 'none', adoptionDeferred: false, outcome: EXISTING_MAP_OUTCOME });
  });

  it('a repository like the target (committed PROJECT, ROADMAP and STATE, no map) proceeds with planningExists true and codebaseMap none', () => {
    const result = classifyPreflight(facts({ planningFiles: ['.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/STATE.md'] }), NO_STATE, {});
    assert.ok(result.ok);
    assert.deepEqual(result.value.findings['existingState'], { planningExists: true, codebaseMap: 'none', adoptionDeferred: false, outcome: 'isolated-regeneration' });
  });

  it('every existing map regenerates in isolation, and only a complete stamped map defers adoption', () => {
    const complete = classifyPreflight(facts({ codebaseMapFiles: SEVEN.map((n) => mapFile(n)), planningFiles: ['.planning/codebase/STACK.md'] }), NO_STATE, {});
    assert.ok(complete.ok);
    assert.deepEqual(complete.value.findings['existingState'], { planningExists: true, codebaseMap: 'stamped-complete', adoptionDeferred: true, outcome: 'isolated-regeneration' });
    const partial = classifyPreflight(facts({ codebaseMapFiles: FOUR.map((n) => mapFile(n)) }), NO_STATE, {});
    assert.ok(partial.ok);
    assert.deepEqual(partial.value.findings['existingState'], { planningExists: false, codebaseMap: 'stamped-partial', adoptionDeferred: false, outcome: 'isolated-regeneration' });
  });
});

describe('classifyPreflight refusals (ONB-6)', () => {
  function refusal(result: ReturnType<typeof classifyPreflight>): { kind: string; text: string } {
    assert.equal(result.ok, false, 'expected a refusal');
    const error = (result as { ok: false; error: { kind: string; expected?: string; actual?: string; field?: string; reason?: string } }).error;
    return { kind: error.kind, text: JSON.stringify(error) };
  }

  it('refuses with existing_state_conflict when an active record exists for the project', () => {
    const r = refusal(classifyPreflight(facts(), { activeRecord: true, onboardings: [{ onboardingId: 'onb_x', state: 'active' }] }, {}));
    assert.equal(r.kind, 'conflict');
    assert.match(r.text, /existing_state_conflict/);
  });

  const NON_STOP: OnboardingState[] = ['contract_proposed', 'mapping', 'paused', 'validating', 'validation_failed', 'planning', 'planning_ready', 'stale'];
  for (const state of NON_STOP) {
    it(`refuses with existing_state_conflict while another onboarding is ${state}`, () => {
      const r = refusal(classifyPreflight(facts(), { activeRecord: false, onboardings: [{ onboardingId: 'onb_other', state }] }, {}));
      assert.equal(r.kind, 'conflict');
      assert.match(r.text, /existing_state_conflict/);
      assert.match(r.text, /onb_other/);
    });
  }

  for (const state of ['blocked', 'incompatible', 'deactivated'] as const) {
    it(`does not refuse because of an onboarding that stopped as ${state}`, () => {
      assert.ok(classifyPreflight(facts(), { activeRecord: false, onboardings: [{ onboardingId: 'onb_old', state }] }, {}).ok);
    });
  }

  it('continues an onboarding that is still in discovered instead of creating a second one', () => {
    const r = classifyPreflight(facts(), { activeRecord: false, onboardings: [{ onboardingId: 'onb_first', state: 'discovered' }] }, {});
    assert.ok(r.ok);
    assert.equal(r.value.continueOnboardingId, 'onb_first');
  });

  it('refuses when a discovered onboarding exists next to one that is already running', () => {
    const r = refusal(classifyPreflight(facts(), { activeRecord: false, onboardings: [{ onboardingId: 'onb_a', state: 'discovered' }, { onboardingId: 'onb_b', state: 'mapping' }] }, {}));
    assert.equal(r.kind, 'conflict');
  });

  it('knows every lifecycle state: each is either refused, continued, or ignored', () => {
    for (const state of ONBOARDING_STATES) {
      const result = classifyPreflight(facts(), { activeRecord: false, onboardings: [{ onboardingId: 'onb_s', state }] }, {});
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
    const r = refusal(classifyPreflight(facts(), { activeRecord: true, onboardings: [] }, { promote: 'copy' }));
    assert.equal(r.kind, 'invalid');
  });
});
