// computeRunScope: the run purpose's write, read and command scope, computed from the run contract's globs (CON-1, CON-2,
// CON-3, CON-5, CON-6, RC-4, RC-5; plan 02-08). Pure: every path is a string. The onboarding purposes are covered by
// invocation-scope.test.ts, which this plan does not edit.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DENIED_COMMAND_PREFIXES,
  GSD_READ_VERBS,
  INVOCATION_PURPOSES,
  PURPOSE_EXTENSIONS,
  PURPOSE_SUBAGENT_TYPES,
  computeRunScope,
  runScopeDirs,
} from '../../src/domain/invocation-scope.ts';
import type { RunScopeInput, RunWorkspaceShape } from '../../src/domain/invocation-scope.ts';
import { RootRefusedError } from '../../src/domain/normalized-root.ts';

const WORK = '/work';
const RUN = 'run_A';
const CLONE: string = `${WORK}/${RUN}/clone`;
const SCRATCH = `${WORK}/${RUN}/scratch`;
const REPO = '/home/u/repo';
const DATA = '/home/u/.local/share/avarice/p1';
const HOME = '/home/u';

const WORKSPACE: RunWorkspaceShape = {
  topLevelEntries: ['src', 'tests', '.planning', 'node_modules', 'package.json', '.github'],
  entriesByDir: {
    src: ['hooks', 'lib'],
    'src/hooks': ['useSwipeStep.ts', 'useTheme.ts'],
    tests: ['unit', 'e2e'],
    'tests/unit': ['swipe-step.test.ts', 'dates.test.ts'],
    '.planning': ['quick', 'ROADMAP.md'],
    node_modules: ['.vite', 'react'],
  },
  gitPaths: [`${CLONE}/.git`],
  repoReadAllow: [],
};

interface Over {
  write?: string[];
  create?: string[];
  artifacts?: string[];
  protectedGlobs?: string[];
  commands?: string[];
  workspace?: RunWorkspaceShape;
  clonePath?: string;
  workRoot?: string;
  scratchDir?: string;
}

function input(over: Over = {}): RunScopeInput {
  return {
    contract: {
      files: {
        write: over.write ?? ['src/hooks/useSwipeStep.ts', 'tests/unit/swipe-step.test.ts'],
        create: over.create ?? [],
        artifacts: over.artifacts ?? ['.planning/quick/**', 'node_modules/.vite/**'],
        protected: over.protectedGlobs ?? ['package.json', '.github/**'],
        secretGlobs: ['**/.env', '**/*.pem'],
      },
      execution: { commands: over.commands ?? ['npm run typecheck', 'npm test', 'npx vitest run <paths>'] },
      budgets: { subagentsTotal: 10, subagentsConcurrent: 2 },
    },
    clonePath: over.clonePath ?? CLONE,
    repoPath: REPO,
    dataRoot: DATA,
    home: HOME,
    workRoot: over.workRoot ?? WORK,
    scratchDir: over.scratchDir ?? SCRATCH,
    workspace: over.workspace ?? WORKSPACE,
    readRoots: ['/gsd/core', '/gsd/agents'],
  };
}

describe('the run purpose spec (CON-1, CON-6)', () => {
  it('is a fourth purpose with its own skill, agents and no extra subagent types', () => {
    assert.equal(INVOCATION_PURPOSES.run.cwd, 'staging');
    assert.equal(INVOCATION_PURPOSES.run.writeDir, '');
    assert.deepEqual(PURPOSE_EXTENSIONS.run, { skills: ['gsd-quick'], agents: ['gsd-planner', 'gsd-plan-checker', 'gsd-executor', 'gsd-verifier'] });
    assert.deepEqual(PURPOSE_SUBAGENT_TYPES.run, []);
  });

  it('admits the Phase 1 GSD read verbs and query init.quick, and no verb that writes', () => {
    assert.ok(GSD_READ_VERBS.run.includes('query init.quick'));
    assert.ok(GSD_READ_VERBS.run.includes('runtime-identity'));
    for (const verb of GSD_READ_VERBS.run) assert.doesNotMatch(verb, /^(config-set|query commit|stamp-codebase-map|init onboard|intel patch-meta|intel snapshot)/);
    // The onboarding purposes keep their lists.
    assert.equal(GSD_READ_VERBS.map.includes('query init.quick'), false);
    assert.equal(GSD_READ_VERBS.intel.includes('query init.quick'), false);
  });
});

describe('computeRunScope: write roots and files from the contract globs (CON-2)', () => {
  it('turns the first example into file roots, directory roots and the full denyWrite list', () => {
    const scope = computeRunScope(input());
    assert.equal(scope.purpose, 'run');
    assert.equal(scope.cwd, CLONE);
    assert.equal(scope.stagingPath, CLONE);
    assert.deepEqual(scope.writeFiles, [`${CLONE}/src/hooks/useSwipeStep.ts`, `${CLONE}/tests/unit/swipe-step.test.ts`]);
    assert.deepEqual(scope.writeRoots, [`${CLONE}/.planning/quick`, `${CLONE}/node_modules/.vite`]);
    assert.equal(scope.scratchDir, SCRATCH);
    // Sorted: the clone entries named in the plan, then the Phase 1 data-root and credential denials.
    assert.deepEqual(
      scope.denyWrite,
      [
        `${CLONE}/.git`,
        `${CLONE}/.github`,
        `${CLONE}/.planning/ROADMAP.md`,
        `${CLONE}/.planning/config.json`,
        `${CLONE}/node_modules/react`,
        `${CLONE}/package.json`,
        `${CLONE}/src/hooks/useTheme.ts`,
        `${CLONE}/src/lib`,
        `${CLONE}/tests/e2e`,
        `${CLONE}/tests/unit/dates.test.ts`,
        `${HOME}/.aws`,
        `${HOME}/.config/gh`,
        `${HOME}/.ssh`,
        DATA,
      ].sort(),
    );
  });

  it('carries the globs the hook matches: write, create and artifact globs together, and the protected globs with the always-protected paths', () => {
    const scope = computeRunScope(input({ create: ['src/hooks/new-*.ts'] }));
    assert.deepEqual(scope.writeGlobs, ['src/hooks/useSwipeStep.ts', 'tests/unit/swipe-step.test.ts', 'src/hooks/new-*.ts', '.planning/quick/**', 'node_modules/.vite/**']);
    assert.deepEqual(scope.protectedGlobs, ['package.json', '.github/**', '.git/**', '.planning/config.json']);
  });

  it('uses the static prefix of a glob up to its first wildcard segment as the root, and drops roots another root already holds', () => {
    const scope = computeRunScope(input({ write: ['src/**/*.ts', 'src/hooks/useSwipeStep.ts', 'tests/unit/*.test.ts'], artifacts: [] }));
    assert.deepEqual(scope.writeRoots, [`${CLONE}/src`, `${CLONE}/tests/unit`]);
    assert.deepEqual(scope.writeFiles, []);
    // src is a root now, so nothing below it is denied; tests/e2e and the rest of the top level still are.
    assert.ok(scope.denyWrite.includes(`${CLONE}/tests/e2e`));
    assert.ok(scope.denyWrite.includes(`${CLONE}/node_modules`));
    assert.ok(!scope.denyWrite.includes(`${CLONE}/src/lib`));
  });

  it('a brace and a bracket stop the prefix like a star', () => {
    const scope = computeRunScope(input({ write: ['src/{hooks,lib}/x.ts', 'tests/[ue]*/a.ts'], artifacts: [] }));
    assert.deepEqual(scope.writeRoots, [`${CLONE}/src`, `${CLONE}/tests`]);
  });

  it('lists the directories whose entries it needs (runScopeDirs), the ancestors of every root and never a write root itself', () => {
    assert.deepEqual(runScopeDirs(input().contract.files), ['.planning', 'node_modules', 'src', 'src/hooks', 'tests', 'tests/unit']);
  });

  it('refuses a workspace that lacks the listing of an ancestor directory (fail closed, never an open directory)', () => {
    const { 'src/hooks': _gone, ...rest } = WORKSPACE.entriesByDir;
    assert.throws(() => computeRunScope(input({ workspace: { ...WORKSPACE, entriesByDir: rest } })), /entriesByDir.*src\/hooks/);
  });
});

describe('computeRunScope: reads, subagents and commands', () => {
  it('keeps the repository, data root, credentials and work root out of reach, with the own clone and scratch re-allowed', () => {
    const scope = computeRunScope(input());
    assert.deepEqual(scope.denyRead, [REPO, DATA, `${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.config/gh`, WORK]);
    assert.deepEqual(scope.allowRead, [CLONE, SCRATCH]);
    assert.deepEqual(scope.denyReadGlobs, ['**/.env', '**/*.pem']);
    assert.deepEqual(scope.readRoots, ['/gsd/core', '/gsd/agents']);
    assert.deepEqual(scope.allowedDomains, []);
    assert.deepEqual(scope.subagents, { total: 10, concurrent: 2 });
  });

  it('keeps the Phase 1 denied prefixes except npm and npx, which leave only because the contract lists them', () => {
    const scope = computeRunScope(input());
    assert.deepEqual(
      scope.commands.deniedPrefixes,
      DENIED_COMMAND_PREFIXES.filter((p) => p !== 'npm' && p !== 'npx'),
    );
    for (const refused of ['git push', 'git commit', 'git -c', 'git config', 'gh', 'claude', 'avarice', 'curl', 'wget']) assert.ok(scope.commands.deniedPrefixes.includes(refused), refused);
    assert.deepEqual(scope.commands.agentCommands, [
      { words: ['npm', 'run', 'typecheck'], paths: false },
      { words: ['npm', 'test'], paths: false },
      { words: ['npx', 'vitest', 'run'], paths: true },
    ]);
  });

  it('keeps npm denied when no agent command starts with it, and npx when none starts with npx', () => {
    const none = computeRunScope(input({ commands: [] }));
    assert.deepEqual(none.commands.deniedPrefixes, [...DENIED_COMMAND_PREFIXES]);
    assert.deepEqual(none.commands.agentCommands, []);
    const npmOnly = computeRunScope(input({ commands: ['npm test'] }));
    assert.ok(npmOnly.commands.deniedPrefixes.includes('npx'));
    assert.ok(!npmOnly.commands.deniedPrefixes.includes('npm'));
  });

  it('never admits a command that starts with a word the contract may not grant, or with a prefix that stays denied (RC-5)', () => {
    const scope = computeRunScope(input({ commands: ['git status', '/usr/bin/git log', 'avarice status', 'claude -p x', 'curl x', 'make test', 'pnpm test', 'npm test; curl x', 'node --test', 'npm run lint <paths>', 'npm test > out'] }));
    assert.deepEqual(scope.commands.agentCommands, [
      { words: ['node', '--test'], paths: false },
      { words: ['npm', 'run', 'lint'], paths: true },
    ]);
    // Dropping git from the commands never removes it from the denied prefixes.
    assert.ok(scope.commands.deniedPrefixes.includes('git commit'));
    assert.ok(scope.commands.deniedPrefixes.includes('make'));
  });

  it('loads no network domain and no subagent beyond the contract totals', () => {
    const scope = computeRunScope({ ...input(), contract: { ...input().contract, budgets: { subagentsTotal: 3, subagentsConcurrent: 1 } } });
    assert.deepEqual(scope.allowedDomains, []);
    assert.deepEqual(scope.subagents, { total: 3, concurrent: 1 });
  });

  it('marks AskUserQuestion denied and background shell denied for the run purpose only', () => {
    const scope = computeRunScope(input());
    assert.deepEqual(scope.deniedTools, ['AskUserQuestion']);
    assert.equal(scope.denyBackgroundShell, true);
    assert.equal(scope.commands.strategy, 'blanket-bash-hook-identity');
  });
});

describe('computeRunScope: the three edges (CON-2)', () => {
  it('adjacency: src-evil and a sibling run whose ID shares a prefix are outside the scope', () => {
    const scope = computeRunScope(input({ write: ['src/**'], artifacts: [], workspace: { ...WORKSPACE, topLevelEntries: [...WORKSPACE.topLevelEntries, 'src-evil'] } }));
    assert.deepEqual(scope.writeRoots, [`${CLONE}/src`]);
    assert.ok(scope.denyWrite.includes(`${CLONE}/src-evil`), 'the existing sibling of src is denied');
    // The sibling run's clone is not the clone, not under it and not re-allowed for reads: roots compare whole.
    const sibling = `${WORK}/run_A2/clone`;
    assert.ok(!(sibling === CLONE || sibling.startsWith(`${CLONE}/`)));
    assert.ok(!scope.allowRead.some((root) => sibling === root || sibling.startsWith(`${root}/`)));
    assert.ok(scope.denyRead.some((root) => sibling === root || sibling.startsWith(`${root}/`)));
  });

  it('empty: a contract with an empty write set has no clone write or file roots and every top-level entry in denyWrite', () => {
    const scope = computeRunScope(input({ write: [], artifacts: [], create: [] }));
    assert.deepEqual(scope.writeRoots, []);
    assert.deepEqual(scope.writeFiles, []);
    for (const entry of WORKSPACE.topLevelEntries) assert.ok(scope.denyWrite.includes(`${CLONE}/${entry}`), entry);
    assert.ok(scope.denyWrite.includes(`${CLONE}/.git`));
  });

  it('ordering: denyWrite is sorted and free of duplicates whatever the order of the globs and the workspace entries', () => {
    const a = computeRunScope(input());
    const reversed: RunWorkspaceShape = {
      ...WORKSPACE,
      topLevelEntries: [...WORKSPACE.topLevelEntries].reverse(),
      entriesByDir: Object.fromEntries(Object.entries(WORKSPACE.entriesByDir).reverse().map(([dir, names]) => [dir, [...names].reverse()])),
      gitPaths: [`${CLONE}/.git`, `${CLONE}/.git`],
    };
    const b = computeRunScope(
      input({ write: ['tests/unit/swipe-step.test.ts', 'src/hooks/useSwipeStep.ts'], artifacts: ['node_modules/.vite/**', '.planning/quick/**'], protectedGlobs: ['.github/**', 'package.json', 'package.json'], workspace: reversed }),
    );
    assert.deepEqual(b.denyWrite, a.denyWrite);
    assert.deepEqual(a.denyWrite, [...new Set(a.denyWrite)].sort());
    assert.deepEqual([...b.writeRoots].sort(), [...a.writeRoots].sort());
  });
});

describe('computeRunScope: the work root check of Phase 1 (WR-01) applies', () => {
  for (const bad of ['', '/', 'work', '/work/../etc', '/work//x', '/work/./x']) {
    it(`refuses the work root ${JSON.stringify(bad)} with RootRefusedError`, () => {
      assert.throws(() => computeRunScope(input({ workRoot: bad })), RootRefusedError);
    });
  }

  it('trims trailing slashes', () => {
    const scope = computeRunScope(input({ workRoot: `${WORK}/` }));
    assert.deepEqual(scope.denyRead.at(-1), WORK);
  });
});
