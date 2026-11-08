// Preflight detection, ONB-6 refusals and `avarice repo add` (plan 01-08 Task 3). Every repository is a
// scratch repository under os.tmpdir() and every CLI run uses a temp profile; nothing here touches the
// user's real profile or repositories.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { classifyExistingMap } from '../../src/domain/preflight.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { runWithFault } from '../helpers/fault-run.ts';
import { checkoutSnapshot, git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const SECRET = 'PREFLIGHT-FIXTURE-SECRET-5e2c1f9a7b';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function commit(repo: ScratchRepo, message: string): string {
  git(repo.path, ['add', '-A']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
  return git(repo.path, ['rev-parse', 'HEAD']).trim();
}

function frontmatter(stamp: string, body: string): string {
  return `---\nlast_mapped_commit: ${stamp}\nlast_mapped_at: 2026-01-01T00:00:00.000Z\n---\n${body}\n`;
}

const SEVEN = ['STACK', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'INTEGRATIONS', 'CONCERNS'];

// The shape of the owner's target repository: committed .planning/ state, instruction files, a workspace
// manifest, an ADR directory, a pinned runtime, a submodule entry; then uncommitted edits, an untracked .env
// holding a secret, and a nested repository that is not a submodule.
const TARGET_FILES: Readonly<Record<string, string>> = {
  'README.md': '# target\n',
  'package.json': JSON.stringify({ name: 'target', workspaces: ['packages/*'], engines: { node: '>=22' } }) + '\n',
  'turbo.json': '{}\n',
  '.nvmrc': '22\n',
  'CLAUDE.md': '# rules\n',
  'packages/a/AGENTS.md': '# a\n',
  '.claude/settings.json': '{}\n',
  'docs/decisions/0001-use-x.md': '# ADR 1\n',
  '.planning/PROJECT.md': '# project\n',
  '.planning/ROADMAP.md': '# roadmap\n',
  '.planning/STATE.md': '# state\n',
  'src/index.ts': 'export const answer = 42;\n',
};

function targetShaped(): { repo: ScratchRepo; pin: string } {
  const repo = makeScratchRepo({ files: TARGET_FILES });
  cleanups.push(repo.dispose);
  // A gitlink (mode 160000), committed straight from the index.
  git(repo.path, ['update-index', '--add', '--cacheinfo', `160000,${repo.head},vendor/sub`]);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add a submodule entry']);
  const pin = git(repo.path, ['rev-parse', 'HEAD']).trim();
  // git leaves an empty directory where an uninitialized submodule is; without it status reports a deletion.
  mkdirSync(join(repo.path, 'vendor', 'sub'), { recursive: true });
  writeFileSync(join(repo.path, 'src', 'index.ts'), 'export const answer = 43;\n');
  writeFileSync(join(repo.path, '.env'), `API_KEY=${SECRET}\n`);
  mkdirSync(join(repo.path, 'scratch'));
  writeFileSync(join(repo.path, 'scratch', 'notes.txt'), 'untracked notes\n');
  mkdirSync(join(repo.path, 'nested-app'));
  git(join(repo.path, 'nested-app'), ['init', '-q', '-b', 'main']);
  return { repo, pin };
}

describe('collectRepoFacts through the staging port', () => {
  it('records existing state, instruction files, manifests, ADR dirs, runtimes, nested repos and counts', () => {
    const { repo, pin } = targetShaped();
    const facts = must(new CloneStagingWorkspace().inspectRepo(repo.path));

    assert.equal(facts.gitRoot, repo.path);
    assert.equal(facts.pin, pin);
    assert.equal(facts.rootCommit, repo.shas[0]);
    assert.equal(facts.branch, 'main');
    assert.equal(facts.defaultBranch, 'main');
    assert.deepEqual(facts.modified, ['src/index.ts']);
    assert.deepEqual(facts.untracked, ['.env', 'nested-app/', 'scratch/notes.txt']);
    assert.deepEqual(facts.nestedRepos, ['nested-app/']);
    assert.deepEqual(facts.submodules, ['vendor/sub']);
    assert.deepEqual(facts.planningFiles, ['.planning/PROJECT.md', '.planning/ROADMAP.md', '.planning/STATE.md']);
    assert.deepEqual(facts.codebaseMapFiles, []);
    assert.deepEqual(facts.workspaceManifests, ['package.json', 'turbo.json']);
    assert.deepEqual(facts.instructionFiles, ['.claude/', 'CLAUDE.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(facts.adrDirs, ['docs/decisions']);
    assert.deepEqual(facts.runtimes, ['.nvmrc:22', 'package.json engines.node:>=22']);
    assert.equal(facts.trackedFiles, Object.keys(TARGET_FILES).length);
    assert.equal(facts.trackedBytes, Object.values(TARGET_FILES).reduce((sum, text) => sum + Buffer.byteLength(text), 0));
    assert.equal(classifyExistingMap(facts), 'none');
  });

  it('never opens an untracked file: an unreadable .env is listed by name and its content appears nowhere', () => {
    const { repo } = targetShaped();
    chmodSync(join(repo.path, '.env'), 0o000);
    cleanups.push(() => chmodSync(join(repo.path, '.env'), 0o600));
    const facts = must(new CloneStagingWorkspace().inspectRepo(repo.path));
    assert.ok(facts.untracked.includes('.env'));
    assert.ok(!JSON.stringify(facts).includes(SECRET));
  });

  it('reads map stamps from committed content only, and finds the commit that wrote the stamp', () => {
    const repo = makeScratchRepo({ files: { 'README.md': '# r\n' } });
    cleanups.push(repo.dispose);
    const first = repo.head;
    for (const name of SEVEN) {
      mkdirSync(join(repo.path, '.planning', 'codebase'), { recursive: true });
      writeFileSync(join(repo.path, '.planning', 'codebase', `${name}.md`), frontmatter(first, `# ${name}`));
    }
    const mapped = commit(repo, 'add the codebase map');

    const ws = new CloneStagingWorkspace();
    let facts = must(ws.inspectRepo(repo.path));
    assert.equal(facts.codebaseMapFiles.length, 7);
    for (const file of facts.codebaseMapFiles) {
      assert.equal(file.lastMappedCommit, first);
      assert.equal(file.stampCommit, mapped);
      assert.equal(file.lastCommit, mapped);
    }
    assert.equal(classifyExistingMap(facts), 'stamped-complete');

    // An uncommitted edit that forges a stamp changes `modified`, not the stamp the facts report.
    writeFileSync(join(repo.path, '.planning', 'codebase', 'STACK.md'), frontmatter('b'.repeat(40), '# forged'));
    facts = must(ws.inspectRepo(repo.path));
    assert.equal(facts.codebaseMapFiles.find((f) => f.path.endsWith('STACK.md'))?.lastMappedCommit, first);
    assert.ok(facts.modified.includes('.planning/codebase/STACK.md'));
    assert.equal(classifyExistingMap(facts), 'user-edited');
    git(repo.path, ['checkout', '--', '.planning/codebase/STACK.md']);

    // A later commit touches STACK.md and keeps its stamp: the stamp commit is older than the last commit.
    writeFileSync(join(repo.path, '.planning', 'codebase', 'STACK.md'), frontmatter(first, '# STACK, edited by the user'));
    const edited = commit(repo, 'user edits the map');
    facts = must(ws.inspectRepo(repo.path));
    const stack = facts.codebaseMapFiles.find((f) => f.path.endsWith('STACK.md'));
    assert.equal(stack?.stampCommit, mapped);
    assert.equal(stack?.lastCommit, edited);
    assert.equal(classifyExistingMap(facts), 'user-edited');

    // A regeneration writes a new stamp in a new commit: stamp commit and last commit agree again.
    writeFileSync(join(repo.path, '.planning', 'codebase', 'STACK.md'), frontmatter(edited, '# STACK, regenerated'));
    const regenerated = commit(repo, 'regenerate STACK');
    facts = must(ws.inspectRepo(repo.path));
    const refreshed = facts.codebaseMapFiles.find((f) => f.path.endsWith('STACK.md'));
    assert.equal(refreshed?.lastMappedCommit, edited);
    assert.equal(refreshed?.stampCommit, regenerated);
    assert.equal(refreshed?.lastCommit, regenerated);
    assert.equal(classifyExistingMap(facts), 'stamped-complete');
  });

  it('reports a file without frontmatter and a stamp that is not a commit as unstamped', () => {
    const repo = makeScratchRepo({
      files: {
        '.planning/codebase/STACK.md': '# no frontmatter\n',
        '.planning/codebase/ARCHITECTURE.md': frontmatter('not-a-sha', '# bad stamp'),
      },
    });
    cleanups.push(repo.dispose);
    const facts = must(new CloneStagingWorkspace().inspectRepo(repo.path));
    assert.deepEqual(facts.codebaseMapFiles.map((f) => f.lastMappedCommit), [null, null]);
    assert.equal(classifyExistingMap(facts), 'unstamped');
  });
});

function fixtureProfile(): CliRoots {
  const roots = makeRoots();
  cleanups.push(() => rmSync(roots.base, { recursive: true, force: true }));
  return roots;
}

function cli(roots: CliRoots, argv: readonly string[]): CliResult {
  return runCli(argv, { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  // A command that fails its argument check never creates the ledger.
  if (!existsSync(join(roots.AVARICE_DATA_ROOT, 'state.db'))) return [];
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

function holdsText(root: string, text: string): boolean {
  return filesUnder(root).some((file) => readFileSync(file).includes(text));
}

describe('avarice repo add (ONB-3, ONB-6)', () => {
  it('registers the repository and records preflight without creating a staging workspace', () => {
    const { repo, pin } = targetShaped();
    const roots = fixtureProfile();
    const before = checkoutSnapshot(repo.path);

    const result = cli(roots, ['repo', 'add', repo.path]);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout.split('\n')[0] ?? '', /^project proj_[0-9A-Z]{26}: registered$/);
    assert.match(result.stdout, /project proj_[0-9A-Z]{26}/);
    assert.match(result.stdout, /onboarding onb_[0-9A-Z]{26}: discovered/);
    assert.ok(result.stdout.includes(pin), 'prints the pin');

    const [project] = rows<{ project_id: string; repo_path: string; root_commit: string }>(roots, 'SELECT project_id, repo_path, root_commit FROM projects');
    assert.equal(project?.repo_path, repo.path);
    assert.equal(project?.root_commit, repo.shas[0]);
    const onboardings = rows<{ state: string; staging_worktree: string | null; contract_run_id: string | null; preflight_json: string }>(
      roots,
      'SELECT state, staging_worktree, contract_run_id, preflight_json FROM onboardings',
    );
    assert.equal(onboardings.length, 1);
    assert.equal(onboardings[0]?.state, 'discovered');
    assert.equal(onboardings[0]?.staging_worktree, null);
    assert.equal(onboardings[0]?.contract_run_id, null);
    assert.deepEqual(readdirSync(roots.AVARICE_WORK_ROOT), [], 'no staging workspace');
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'the checkout is unchanged');

    const preflight = JSON.parse(onboardings[0]?.preflight_json as string) as Record<string, unknown>;
    assert.equal(preflight['pin'], pin);
    assert.deepEqual(preflight['request'], { repoPath: repo.path, policy: 'onboarding', promote: 'none', mode: 'full', budgetOverrides: {} });
    assert.deepEqual(preflight['notMapped'], ['.env', 'nested-app/', 'scratch/notes.txt', 'src/index.ts']);
    assert.deepEqual(preflight['untracked'], ['.env', 'nested-app/', 'scratch/notes.txt']);
    assert.deepEqual(preflight['existingState'], { planningExists: true, codebaseMap: 'none', adoptionDeferred: false, outcome: 'isolated-regeneration' });
    assert.deepEqual(preflight['instructionFiles'], ['.claude/', 'CLAUDE.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(preflight['submodules'], ['vendor/sub']);
    assert.deepEqual(preflight['workspaceManifests'], ['package.json', 'turbo.json']);
    assert.deepEqual(preflight['adrDirs'], ['docs/decisions']);
    assert.deepEqual(preflight['nestedRepos'], ['nested-app/']);
    assert.equal(preflight['trackedFiles'], Object.keys(TARGET_FILES).length);
  });

  it('never stores the content of an untracked file: the fixture secret is in neither the ledger nor the data root', () => {
    const { repo } = targetShaped();
    const roots = fixtureProfile();
    const result = cli(roots, ['repo', 'add', repo.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes(SECRET) && !result.stderr.includes(SECRET));
    assert.ok(readFileSync(join(repo.path, '.env'), 'utf8').includes(SECRET), 'the fixture really holds the secret');
    assert.deepEqual(rows<{ preflight_json: string }>(roots, 'SELECT preflight_json FROM onboardings').filter((r) => !r.preflight_json.includes('".env"')), [], 'the name is recorded');
    assert.equal(holdsText(roots.AVARICE_DATA_ROOT, SECRET), false, 'no file in the data root holds the secret');

    // Positive control: the scan does see a planted copy.
    const planted = join(roots.AVARICE_DATA_ROOT, 'planted.txt');
    writeFileSync(planted, SECRET);
    assert.equal(holdsText(roots.AVARICE_DATA_ROOT, SECRET), true);
    rmSync(planted);
  });

  it('is idempotent, and a later onboard continues that onboarding instead of creating a second one', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const roots = fixtureProfile();
    const first = cli(roots, ['repo', 'add', repo.path]);
    const second = cli(roots, ['repo', 'add', repo.path]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    const idOf = (r: CliResult): string => /onboarding (onb_[0-9A-Z]{26})/.exec(r.stdout)?.[1] as string;
    assert.equal(idOf(second), idOf(first));
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 1);

    const onboarded = cli(roots, ['onboard', '--policy', 'onboarding', repo.path]);
    assert.equal(onboarded.code, 0, onboarded.stderr + onboarded.stdout);
    assert.match(onboarded.stdout, new RegExp(`onboarding ${idOf(first)}: active`));
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 1, 'no second onboarding');
    assert.equal(rows(roots, 'SELECT 1 FROM projects').length, 1);
  });

  it('is a usage error for a path that is not a repository, a missing path and an unknown subcommand', () => {
    const roots = fixtureProfile();
    const plain = mkdtempSync(join(tmpdir(), 'avarice-not-a-repo-'));
    cleanups.push(() => rmSync(plain, { recursive: true, force: true }));
    const notRepo = cli(roots, ['repo', 'add', realpathSync(plain)]);
    assert.equal(notRepo.code, 64);
    assert.match(notRepo.stderr, /as a git repository/);
    // OPS-7: the error line is prefixed with the command and subcommand, and one line names the command that inspects the problem.
    const errorLines = notRepo.stderr.split('\n');
    assert.match(errorLines[0] ?? '', /^avarice repo add: .*as a git repository/);
    assert.equal(errorLines[1], `run: git -C ${realpathSync(plain)} rev-parse --show-toplevel`);
    assert.equal(errorLines[2], '', 'exactly one resolving line');
    for (const argv of [['repo', 'add'], ['repo', 'frobnicate', plain], ['repo']]) {
      const usage = cli(roots, argv);
      assert.equal(usage.code, 64, argv.join(' '));
      assert.match(usage.stderr, /^avarice repo: /, 'a usage error is prefixed with the command and followed by the usage text');
      assert.match(usage.stderr, /usage: avarice repo add <path>/);
    }
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 0);
  });
});

describe('ONB-6 refusals through the CLI', () => {
  it('refuses a second onboarding of a project that already has an active record', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const roots = fixtureProfile();
    assert.equal(cli(roots, ['onboard', '--policy', 'onboarding', repo.path]).code, 0);

    for (const argv of [['onboard', '--policy', 'onboarding', repo.path], ['repo', 'add', repo.path]]) {
      const refused = cli(roots, argv);
      assert.equal(refused.code, 3, refused.stderr + refused.stdout);
      assert.match(refused.stderr, /existing_state_conflict/);
    }
    // OPS-7: a refusal by `repo add` is prefixed with the command and subcommand and followed by the command that shows the state.
    const refusedAdd = cli(roots, ['repo', 'add', repo.path]);
    assert.match(refusedAdd.stderr.split('\n')[0] ?? '', /^avarice repo add: refused: /);
    assert.equal(refusedAdd.stderr.split('\n')[1], 'run: avarice status');
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 1);
    assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 1);
  });

  it('refuses a new onboarding while another onboarding of the project is mid-flight', () => {
    // Brownfield (a package file), so the mapper is invoked: a README-only repository is skipped (plan 01-09).
    const repo = makeScratchRepo({ files: { 'README.md': '# r\n', 'package.json': '{"name":"scratch"}\n' } });
    cleanups.push(repo.dispose);
    const roots = fixtureProfile();
    runWithFault(roots, repo, 'mid-invocation');
    const [interrupted] = rows<{ onboarding_id: string; state: string }>(roots, 'SELECT onboarding_id, state FROM onboardings');
    assert.equal(interrupted?.state, 'mapping');

    const refused = cli(roots, ['onboard', '--policy', 'onboarding', repo.path]);
    assert.equal(refused.code, 3, refused.stderr + refused.stdout);
    assert.match(refused.stderr, /existing_state_conflict/);
    assert.ok(refused.stderr.includes(interrupted?.onboarding_id as string), 'names the onboarding to resume');
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 1);
  });

  it('refuses promotion other than none before any onboarding, contract or staging exists', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const roots = fixtureProfile();
    const before = checkoutSnapshot(repo.path);
    for (const mode of ['copy', 'commit']) {
      const refused = cli(roots, ['onboard', '--policy', 'onboarding', '--promote', mode, repo.path]);
      assert.equal(refused.code, 64, refused.stderr + refused.stdout);
      assert.match(refused.stderr, /request\.promote/);
    }
    assert.equal(rows(roots, 'SELECT 1 FROM onboardings').length, 0);
    assert.deepEqual(readdirSync(roots.AVARICE_WORK_ROOT), []);
    assert.deepEqual(checkoutSnapshot(repo.path), before);
  });
});
