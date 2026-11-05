// Fixtures for the run slice (plan 02-10; plan 02-09's spike reuses makeRunRepo). A scratch GSD project with one small
// bug and one failing test, onboarded to `active` through the real CLI with the fake hosts, plus the repository
// conventions and the brief a routine run starts from. Every repository lives under os.tmpdir() as a realpath, so the
// model is never handed a symlinked /var path (02-01 carried finding).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { FakeAgentHost } from './fake-agent-host.ts';
import { FakeIntelHost } from './fake-intel-host.ts';
import { writeFakeGraphify } from './fake-graphify.ts';
import { git, makeScratchRepo } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';
import { REPO_ROOT, runCli } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');

export const RUN_REPO_FILES: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "slugger",\n  "version": "1.0.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "node --test test/"\n  }\n}\n',
  'src/slug.ts': [
    '// Turns a title into a URL slug.',
    'export function slugify(title: string): string {',
    "  return title.toLowerCase().trim().replace(/[^a-z0-9]/g, '-');",
    '}',
    '',
  ].join('\n'),
  'test/slug.test.ts': [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { slugify } from '../src/slug.ts';",
    '',
    "test('repeated separators collapse to one dash', () => {",
    "  assert.equal(slugify('Hello,  World!'), 'hello-world');",
    '});',
    '',
  ].join('\n'),
  '.planning/PROJECT.md': '# Slugger\n\nA tiny slug library.\n',
  '.planning/ROADMAP.md': '# Roadmap\n\n## Phase 1: Slugs\n\nGoal: a correct slugify.\n',
  '.planning/STATE.md': '# State\n\nPhase 1 in progress.\n',
};

// The repository conventions a routine run needs: one required check and a write set under src and test.
export const RUN_CONVENTIONS = {
  schema: 1,
  checks: [{ name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true }],
  paths: { write: ['src/**', 'test/**'], protected: [], artifacts: [] },
} as const;

export const RUN_BRIEF = [
  '---',
  'title: Collapse repeated dashes in slugs',
  '---',
  '## Behavior',
  'A slug never contains two dashes in a row.',
  '',
  '## Acceptance criteria',
  '- AC1: Repeated separators collapse to one dash | verifiedBy: check:test',
  '',
  '## Write',
  '- src/**',
  '- test/**',
  '',
  '## Target checks',
  '- test',
  '',
].join('\n');

// A scratch GSD project, committed, not yet onboarded. `omit` names tracked files to leave out (a repository without planning).
export function makeRunRepo(extra: Readonly<Record<string, string>> = {}, omit: readonly string[] = []): ScratchRepo {
  const files: Record<string, string> = { ...RUN_REPO_FILES, ...extra };
  for (const name of omit) delete files[name];
  return makeScratchRepo({ files });
}

// Onboards the repository to `active` through the test CLI with the fake host and returns the pinned revision.
export function onboardRunRepo(roots: CliRoots, repo: ScratchRepo): string {
  const result = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /onboarding onb_[0-9A-Z]{26}: active/);
  return repo.head;
}

// Commits `.avarice/config.json` as the next commit on the current branch and returns its SHA. `json` is the conventions
// object (or its text).
export function commitConventions(repo: ScratchRepo, json: unknown = RUN_CONVENTIONS): string {
  return commitFiles(repo, { '.avarice/config.json': typeof json === 'string' ? json : `${JSON.stringify(json, null, 2)}\n` }, 'conventions');
}

// Writes the files and commits exactly them as the next commit; returns its SHA. `atMs` sets the author and committer time.
export function commitFiles(repo: ScratchRepo, files: Readonly<Record<string, string>>, message: string, atMs?: number): string {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    LANG: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (atMs !== undefined) {
    const stamp = `${Math.floor(atMs / 1000)} +0000`;
    env['GIT_AUTHOR_DATE'] = stamp;
    env['GIT_COMMITTER_DATE'] = stamp;
  }
  execFileSync('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message], {
    cwd: repo.path,
    env,
    encoding: 'utf8',
  });
  const sha = git(repo.path, ['rev-parse', 'HEAD']).trim();
  repo.shas.push(sha);
  repo.head = sha;
  return sha;
}

// Writes a brief file under `dir` and returns its path.
export function writeBrief(dir: string, text: string = RUN_BRIEF, name = 'brief.md'): string {
  const path = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, text);
  return path;
}

// A graph that has a node for `term` (a code node with a source file and a concept node), written the way graphify writes graph.json.
export function graphAnswering(term: string, builtAtCommit: string): Record<string, unknown> {
  return {
    directed: false,
    multigraph: false,
    built_at_commit: builtAtCommit,
    nodes: [
      { id: 'g1', label: term, file_type: 'code', source_file: 'src/slug.ts' },
      { id: 'g2', label: `${term} rules`, file_type: 'concept' },
    ],
    links: [{ source: 'g1', target: 'g2', relation: 'relates_to', confidence: 'EXTRACTED', confidence_score: 1 }],
  };
}

// Onboards the repository like onboardRunRepo, but with an intel index (the fixture documents of test/fixtures/index-fixtures.ts, written by
// FakeIntelHost) and a graph that answers `term`, both recorded on the active record (plan 02-13, S-41). In process, through the real onboarding
// stages with the real sandboxed GSD verbs; the graph the fake graphify builds is replaced by one with a node for `term`.
export async function onboardRunRepoWithIndexes(roots: CliRoots, repo: ScratchRepo, term: string): Promise<{ pin: string; staging: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(mkdtempSync(join(tmpdir(), 'avarice-fake-graphify-')), 'ok'),
    AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
  };
  const composed = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok && outcome.value.state === 'active', 'the repository is onboarded');
  } finally {
    composed.value.close();
  }
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  let staging: string;
  try {
    staging = (db.prepare('SELECT staging_worktree FROM onboardings').get() as { staging_worktree: string }).staging_worktree;
  } finally {
    db.close();
  }
  writeFileSync(join(staging, '.planning', 'graphs', 'graph.json'), JSON.stringify(graphAnswering(term, repo.head)));
  return { pin: repo.head, staging };
}

// ---- a whole run with the fake run host (plan 02-13) ------------------------------------------------------------------------------

export const FIXED_SLUG = [
  '// Turns a title into a URL slug.',
  'export function slugify(title: string): string {',
  "  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');

// The conventions the run tests commit: the one required check and the one command the unit may run.
export const RUN_CONVENTIONS_WITH_COMMANDS = { ...RUN_CONVENTIONS, agentCommands: ['npm test'] };

// ---- checks that already fail at the pin, declared writes, dependencies and a test inventory (plan 02-14) ---------------------------------------

// A `format` check that exits 1 at the pin and writes nothing: a pre-existing failure (D-12).
export const FORMAT_CHECK_SCRIPT = "process.stderr.write('format check failed: src/slug.ts is not formatted\\n');\nprocess.exit(1);\n";

// A repository that has the format script at the pin.
export function makeRunRepoWithFormat(extra: Readonly<Record<string, string>> = {}): ScratchRepo {
  return makeRunRepo({ 'scripts/format-check.mjs': FORMAT_CHECK_SCRIPT, ...extra });
}

export const FORMAT_CHECK = { name: 'format', argv: ['node', 'scripts/format-check.mjs'], timeoutSec: 60, required: true } as const;

// The conventions of the pre-existing failure: `test` (fails at the pin too: that is the bug) and `format` (fails at the pin and stays failing).
export const RUN_CONVENTIONS_WITH_FORMAT = {
  ...RUN_CONVENTIONS,
  checks: [...RUN_CONVENTIONS.checks, FORMAT_CHECK],
  agentCommands: ['npm test'],
};

// The standard brief with its target checks replaced.
export function briefTargeting(...targets: readonly string[]): string {
  return RUN_BRIEF.replace('## Target checks\n- test\n', `## Target checks\n${targets.map((t) => `- ${t}`).join('\n')}\n`);
}

// Rows of the ledger of a profile, read-only.
export function ledgerRows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

// `start --brief <brief> --policy routine --wait` through the test entry with the fake run host playing `run`; returns the CLI result.
export function startWithFakeRunHost(roots: CliRoots, repo: ScratchRepo, brief: string, run: Record<string, unknown>, extraArgs: readonly string[] = []): ReturnType<typeof runCli> {
  return runCli(['start', '--brief', brief, '--policy', 'routine', '--wait', ...extraArgs], {
    roots,
    cwd: repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run }) },
    timeoutMs: 300_000,
  });
}
