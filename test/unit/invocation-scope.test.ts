// computeInvocationScope: the vendor-neutral write, read and command scope of each contained invocation
// (ONB-3, ONB-4, CON-2). Pure: every path is a string argument, nothing touches the filesystem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DENIED_COMMAND_PREFIXES,
  FIND_DENIED_ACTIONS,
  GSD_READ_VERBS,
  INVOCATION_PURPOSES,
  ONBOARDING_BASH_STRATEGY,
  PURPOSE_EXTENSIONS,
  PURPOSE_SUBAGENT_TYPES,
  READ_ONLY_COMMANDS,
  computeInvocationScope,
} from '../../src/domain/invocation-scope.ts';
import type { InvocationPurpose, ScopeInput, WorkspaceShape } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import type { OnboardingContract } from '../../src/domain/onboarding-contract.ts';

const STAGING = '/work/onb-1/staging';
const REPO = '/home/u/repo';
const DATA = '/home/u/.local/share/avarice/p1';
const HOME = '/home/u';

function contract(): OnboardingContract {
  const compiled = compileOnboardingContract({
    onboardingId: 'onb-1',
    runId: 'run-1',
    projectId: 'prj-1',
    pin: 'a'.repeat(40),
    preflight: {},
    request: {},
    nowIso: '2026-11-02T00:00:00.000Z',
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  return compiled.value;
}

function workspace(over: Partial<WorkspaceShape> = {}): WorkspaceShape {
  return {
    topLevelEntries: ['src', 'docs', '.planning', 'package.json', '.git'],
    planningEntries: ['PROJECT.md', 'ROADMAP.md', 'config.json', 'phases'],
    gitPaths: [`${STAGING}/.git`],
    repoReadAllow: [],
    ...over,
  };
}

function scopeFor(purpose: InvocationPurpose, over: Partial<ScopeInput> = {}) {
  return computeInvocationScope({
    purpose,
    contract: contract(),
    stagingPath: STAGING,
    repoPath: REPO,
    dataRoot: DATA,
    home: HOME,
    workspace: workspace(),
    readRoots: ['/gsd/core', '/gsd/agents'],
    workRoot: '/work',
    ...over,
  });
}

describe('computeInvocationScope: map', () => {
  it('allows writes only to .planning/codebase and runs in the staging directory', () => {
    const scope = scopeFor('map');
    assert.deepEqual(scope.writeRoots, [`${STAGING}/.planning/codebase`]);
    assert.equal(scope.cwd, STAGING);
    assert.equal(scope.purpose, 'map');
  });

  it('denies every existing out-of-scope staging entry, the git paths and the other .planning entries', () => {
    const { denyWrite } = scopeFor('map');
    for (const rel of ['src', 'docs', 'package.json', '.git', '.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/config.json', '.planning/phases']) {
      assert.ok(denyWrite.includes(`${STAGING}/${rel}`), `denyWrite must list ${rel}: ${JSON.stringify(denyWrite)}`);
    }
  });

  it('never denies the write directory or its parent', () => {
    const { denyWrite } = scopeFor('map', { workspace: workspace({ planningEntries: ['codebase', 'config.json', 'phases'] }) });
    assert.ok(!denyWrite.includes(`${STAGING}/.planning`), 'the parent of the write root stays writable');
    assert.ok(!denyWrite.includes(`${STAGING}/.planning/codebase`));
    assert.ok(denyWrite.includes(`${STAGING}/.planning/phases`));
  });

  it('lists every git path in denyWrite', () => {
    const gitPaths = [`${STAGING}/.git`, '/work/onb-1/gitdir', '/home/u/repo/.git/worktrees/x'];
    const { denyWrite } = scopeFor('map', { workspace: workspace({ gitPaths }) });
    for (const path of gitPaths) assert.ok(denyWrite.includes(path), `missing ${path}`);
  });

  it('denies .planning/config.json even when the staging tree has no .planning yet', () => {
    const { denyWrite } = scopeFor('map', { workspace: workspace({ topLevelEntries: ['src'], planningEntries: [] }) });
    assert.ok(denyWrite.includes(`${STAGING}/.planning/config.json`));
    assert.ok(denyWrite.includes(`${STAGING}/src`));
  });
});

describe('computeInvocationScope: intel and knowledge', () => {
  it('intel writes only .planning/intel and denies the map directory', () => {
    const scope = scopeFor('intel', { workspace: workspace({ planningEntries: ['codebase', 'intel', 'config.json'] }) });
    assert.deepEqual(scope.writeRoots, [`${STAGING}/.planning/intel`]);
    assert.equal(scope.cwd, STAGING);
    assert.ok(scope.denyWrite.includes(`${STAGING}/.planning/codebase`));
    assert.ok(!scope.denyWrite.includes(`${STAGING}/.planning/intel`));
  });

  it('knowledge writes only the extraction directory inside the corpus, whose root is its working directory and the only place it may read', () => {
    const scope = scopeFor('knowledge', {
      workspace: workspace({ topLevelEntries: ['src', '.planning', '.avarice-knowledge', 'package.json', '.git'] }),
    });
    assert.deepEqual(scope.writeRoots, [`${STAGING}/.avarice-knowledge/.extraction`]);
    assert.equal(scope.cwd, `${STAGING}/.avarice-knowledge`);
    assert.deepEqual(scope.readConfine, [`${STAGING}/.avarice-knowledge`], 'reads are confined to the corpus (decision B)');
    for (const rel of ['src', '.planning', 'package.json', '.git']) {
      assert.ok(scope.denyWrite.includes(`${STAGING}/${rel}`), `denyWrite must list ${rel}`);
    }
    assert.ok(!scope.denyWrite.includes(`${STAGING}/.avarice-knowledge`));
    // No GSD directory is readable: the pass loads no skill and runs no GSD verb.
    assert.deepEqual(scope.readRoots, []);
  });

  it('the other purposes confine no read and keep their read roots', () => {
    for (const purpose of ['map', 'intel'] as const) {
      assert.equal(scopeFor(purpose).readConfine, undefined, purpose);
      assert.deepEqual(scopeFor(purpose).readRoots, ['/gsd/core', '/gsd/agents'], purpose);
    }
  });

  it('knowledge has no shell at all: strategy none, no read-only command, no GSD verb, whatever strategy is asked for', () => {
    for (const over of [{}, { strategy: 'narrow-rules' as const }, { strategy: 'hook-allow' as const }]) {
      const { commands } = scopeFor('knowledge', over);
      assert.equal(commands.strategy, 'none');
      assert.deepEqual(commands.readOnly, []);
      assert.deepEqual(commands.gsdReadVerbs, []);
    }
    assert.equal(scopeFor('map').commands.strategy, ONBOARDING_BASH_STRATEGY);
    assert.equal(scopeFor('intel').commands.strategy, ONBOARDING_BASH_STRATEGY);
  });

  it('the purpose table names the write directory, the working-directory rule and the read confinement', () => {
    assert.equal(INVOCATION_PURPOSES.map.writeDir, '.planning/codebase');
    assert.equal(INVOCATION_PURPOSES.intel.writeDir, '.planning/intel');
    assert.equal(INVOCATION_PURPOSES.knowledge.writeDir, '.avarice-knowledge/.extraction');
    assert.equal(INVOCATION_PURPOSES.map.cwd, 'staging');
    assert.equal(INVOCATION_PURPOSES.knowledge.cwd, 'read-dir');
    assert.equal((INVOCATION_PURPOSES.knowledge as { readDir?: string }).readDir, '.avarice-knowledge');
  });

  it('loads no skill and starts no agent or subagent for the knowledge purpose (no graphify skill, no general-purpose type)', () => {
    assert.deepEqual(PURPOSE_EXTENSIONS.knowledge, { skills: [], agents: [] });
    assert.deepEqual(PURPOSE_SUBAGENT_TYPES.knowledge, []);
    assert.deepEqual(PURPOSE_EXTENSIONS.map, { skills: ['gsd-map-codebase'], agents: ['gsd-codebase-mapper'] });
    assert.deepEqual(PURPOSE_EXTENSIONS.intel, { skills: [], agents: ['gsd-intel-updater'] });
  });

  it('writes nothing when the contract does not authorize the purpose directory (fail closed)', () => {
    const c = contract();
    const narrowed = { ...c, files: { ...c.files, write: { ...c.files.write, map: ['docs/**'] } } };
    const scope = scopeFor('map', { contract: narrowed });
    assert.deepEqual(scope.writeRoots, []);
    const knowledge = scopeFor('knowledge', { contract: { ...c, files: { ...c.files, write: { ...c.files.write, knowledge: ['docs/**'] } } } });
    assert.deepEqual(knowledge.writeRoots, [], 'the nested extraction directory is authorized only by a glob that covers it');
  });

  it('authorizes the nested extraction directory through the contract glob `.avarice-knowledge/**` and through the exact glob, not through a sibling', () => {
    const c = contract();
    const withGlob = (globs: string[]) => scopeFor('knowledge', { contract: { ...c, files: { ...c.files, write: { ...c.files.write, knowledge: globs } } } }).writeRoots;
    assert.deepEqual(withGlob(['.avarice-knowledge/**']), [`${STAGING}/.avarice-knowledge/.extraction`]);
    assert.deepEqual(withGlob(['.avarice-knowledge/.extraction/**']), [`${STAGING}/.avarice-knowledge/.extraction`]);
    assert.deepEqual(withGlob(['.avarice-knowledge-other/**']), []);
    assert.deepEqual(withGlob(['.avarice-knowledge/other/**']), []);
  });
});

describe('computeInvocationScope: reads', () => {
  it('always denies the checkout, the data root and the credential directories', () => {
    for (const purpose of ['map', 'intel', 'knowledge'] as const) {
      const { denyRead } = scopeFor(purpose);
      for (const path of [REPO, DATA, `${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.config/gh`]) {
        assert.ok(denyRead.includes(path), `${purpose}: denyRead must list ${path}`);
      }
    }
  });

  it('re-allows only what the staging strategy lists, and the invocation staging (WR-03)', () => {
    assert.deepEqual(scopeFor('map').allowRead, [STAGING]);
    const scope = scopeFor('map', { workspace: workspace({ repoReadAllow: [`${REPO}/.git`] }) });
    assert.deepEqual(scope.allowRead, [`${REPO}/.git`, STAGING]);
  });

  it('carries the extra read roots, the staging path and the contract secret globs', () => {
    const scope = scopeFor('map');
    assert.deepEqual(scope.readRoots, ['/gsd/core', '/gsd/agents']);
    assert.equal(scope.stagingPath, STAGING);
    assert.equal(scope.repoPath, REPO);
    assert.equal(scope.dataRoot, DATA);
    assert.deepEqual(scope.denyReadGlobs, contract().files.secretGlobs);
  });

  it('ignores trailing slashes on the staging path', () => {
    const scope = scopeFor('map', { stagingPath: `${STAGING}/`, workspace: workspace({ gitPaths: [] }) });
    assert.deepEqual(scope.writeRoots, [`${STAGING}/.planning/codebase`]);
    assert.equal(scope.cwd, STAGING);
    assert.ok(scope.denyWrite.includes(`${STAGING}/.git`));
  });
});

describe('computeInvocationScope: commands and budgets', () => {
  it('records the owner-selected Bash strategy (S0-A, Task 1 decision)', () => {
    assert.equal(ONBOARDING_BASH_STRATEGY, 'blanket-bash-hook-identity');
    assert.equal(scopeFor('map').commands.strategy, ONBOARDING_BASH_STRATEGY);
    assert.equal(scopeFor('map', { strategy: 'narrow-rules' }).commands.strategy, 'narrow-rules');
  });

  it('lists the read-only commands, the denied prefixes and the find actions the hook refuses', () => {
    for (const command of ['ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'git ls-files', 'git log', 'git rev-parse', 'git status', 'git show']) {
      assert.ok(READ_ONLY_COMMANDS.includes(command), `READ_ONLY_COMMANDS must list ${command}`);
    }
    for (const prefix of ['git push', 'git commit', 'git -c', 'git config', 'gh', 'claude', 'avarice', 'npm', 'npx', 'pnpm', 'yarn', 'curl', 'wget', 'pip', 'uv pip', 'make']) {
      assert.ok(DENIED_COMMAND_PREFIXES.includes(prefix), `DENIED_COMMAND_PREFIXES must list ${prefix}`);
    }
    for (const action of ['-exec', '-execdir', '-delete', '-fprint']) {
      assert.ok(FIND_DENIED_ACTIONS.includes(action), `FIND_DENIED_ACTIONS must list ${action}`);
    }
    const scope = scopeFor('map');
    assert.deepEqual(scope.commands.readOnly, [...READ_ONLY_COMMANDS]);
    assert.deepEqual(scope.commands.deniedPrefixes, [...DENIED_COMMAND_PREFIXES]);
  });

  it('allows the intel mutators only for the intel purpose', () => {
    for (const verb of ['intel patch-meta', 'intel validate', 'intel snapshot']) {
      assert.ok(scopeFor('intel').commands.gsdReadVerbs.includes(verb), `intel must allow ${verb}`);
      assert.ok(!scopeFor('map').commands.gsdReadVerbs.includes(verb), `map must not allow ${verb}`);
      assert.ok(!scopeFor('knowledge').commands.gsdReadVerbs.includes(verb), `knowledge must not allow ${verb}`);
    }
    assert.ok(GSD_READ_VERBS.map.includes('runtime-identity'));
    assert.ok(GSD_READ_VERBS.map.includes('query init.map-codebase'));
  });

  it('keeps GSD verbs that write out of every purpose (stamp and config-set run in AVARICE, not the host)', () => {
    for (const purpose of ['map', 'intel', 'knowledge'] as const) {
      const verbs = scopeFor(purpose).commands.gsdReadVerbs;
      for (const verb of verbs) {
        assert.ok(!/^(config-set|stamp-codebase-map|init onboard|query commit)/.test(verb), `${purpose} must not allow ${verb}`);
      }
    }
  });

  it('carries the preamble fingerprint when given and never allows a network domain', () => {
    const scope = scopeFor('map', { preambleSha256: 'c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b' });
    assert.equal(scope.commands.preambleSha256, 'c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b');
    assert.equal(scopeFor('map').commands.preambleSha256, undefined);
    for (const purpose of ['map', 'intel', 'knowledge'] as const) assert.deepEqual(scopeFor(purpose).allowedDomains, []);
  });

  it('gives the intel and knowledge invocations no subagents (S0-D: --agent, no Agent tool; decision B) and the map the contract limits', () => {
    const c = contract();
    assert.deepEqual(scopeFor('intel').subagents, { total: 0, concurrent: 0 });
    assert.deepEqual(scopeFor('map').subagents, { total: c.budgets.subagentsTotal, concurrent: c.budgets.subagentsConcurrent });
    // The knowledge pass runs no subagent either (decision B: the model reads the chunks itself).
    assert.deepEqual(scopeFor('knowledge').subagents, { total: 0, concurrent: 0 });
  });
});

describe('the work root (CR-02, D-GAP-01)', () => {
  const FIVE = [REPO, DATA, `${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.config/gh`];

  it('denies the work root after the five existing entries and re-allows only the staging path', () => {
    for (const purpose of ['map', 'intel', 'knowledge'] as const) {
      const scope = scopeFor(purpose, { workRoot: '/work' });
      assert.deepEqual(scope.denyRead, [...FIVE, '/work'], `${purpose}: work root last`);
      assert.deepEqual(scope.allowRead, [STAGING], `${purpose}: staging only`);
    }
  });

  it('lists the strategy re-allowed roots first and the staging path last', () => {
    const scope = scopeFor('map', { workRoot: '/work', workspace: workspace({ repoReadAllow: [`${REPO}/.git`] }) });
    assert.deepEqual(scope.allowRead, [`${REPO}/.git`, STAGING]);
  });

  it('trims a trailing slash on the work root', () => {
    assert.deepEqual(scopeFor('map', { workRoot: '/work/' }).denyRead.at(-1), '/work');
  });

  it('never re-allows the onboarding directory above staging, nor a sibling whose ID shares a prefix', () => {
    const { allowRead } = scopeFor('map', { workRoot: '/work' });
    assert.equal(allowRead.includes('/work/onb-1'), false);
    assert.equal(allowRead.includes('/work/onb-11/staging'), false);
    assert.equal(allowRead.includes('/work'), false);
  });

  it('does not duplicate the work root when it is already denied', () => {
    const { denyRead } = scopeFor('map', { workRoot: DATA });
    assert.equal(denyRead.filter((path) => path === DATA).length, 1);
  });

  it('cannot be called without a work root (WR-03): the type rejects a ScopeInput that omits it', () => {
    // tsc reports an unused directive here if workRoot ever becomes optional again. The literal is never passed on.
    // @ts-expect-error WR-03: ScopeInput.workRoot is required
    const withoutWorkRoot: ScopeInput = { purpose: 'map', contract: contract(), stagingPath: STAGING, repoPath: REPO, dataRoot: DATA, home: HOME, workspace: workspace(), readRoots: [] };
    void withoutWorkRoot;
  });
});

describe('computeInvocationScope: purity', () => {
  it('is deterministic and does not mutate its inputs', () => {
    const ws = workspace();
    const frozen = Object.freeze({
      topLevelEntries: Object.freeze([...ws.topLevelEntries]) as string[],
      planningEntries: Object.freeze([...ws.planningEntries]) as string[],
      gitPaths: Object.freeze([...ws.gitPaths]) as string[],
      repoReadAllow: Object.freeze([...ws.repoReadAllow]) as string[],
    });
    const a = scopeFor('map', { workspace: frozen });
    const b = scopeFor('map', { workspace: frozen });
    assert.deepEqual(a, b);
    assert.deepEqual(frozen.topLevelEntries, ws.topLevelEntries);
  });

  it('returns sorted, duplicate-free denyWrite entries', () => {
    const { denyWrite } = scopeFor('map', { workspace: workspace({ topLevelEntries: ['src', 'src', 'docs', '.git', '.planning'] }) });
    assert.equal(new Set(denyWrite).size, denyWrite.length);
    assert.deepEqual(denyWrite, [...denyWrite].sort());
  });
});
