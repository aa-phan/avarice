// Fixtures for the run slice (plan 02-10; plan 02-09's spike reuses makeRunRepo). A scratch GSD project with one small
// bug and one failing test, onboarded to `active` through the real CLI with the fake hosts, plus the repository
// conventions and the brief a routine run starts from. Every repository lives under os.tmpdir() as a realpath, so the
// model is never handed a symlinked /var path (02-01 carried finding).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
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
