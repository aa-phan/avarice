// ONB-3, ONB-4, ONB-5 for the parts AVARICE itself performs: no code that lives in the user's repository
// runs, no ref of the user's repository moves, no commit appears that onboarding did not document, and the
// staging strategy the owner chose (clone, plan 01-08 Task 1) satisfies the same port contract as the
// worktree alternative. Every repository is a scratch repository under os.tmpdir().
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import { SAFE_GIT_ENV, runGit } from '../../src/adapters/git/safe-git.ts';
import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { STAGING_STRATEGY, createStagingWorkspace } from '../../src/adapters/git/staging-strategy.ts';
import { WorktreeStagingWorkspace } from '../../src/adapters/git/staging-worktree.ts';
import type { Result } from '../../src/domain/result.ts';
import type { StagingInfo, StagingWorkspace } from '../../src/ports/staging-workspace.ts';
import { makeHostileRepo } from '../helpers/hostile-repo.ts';
import type { HostileRepo } from '../helpers/hostile-repo.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { git, makeScratchRepo, treeDigest } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const ONB = 'onb_01TESTNOREPOEXEC00000000';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function hostile(options?: Parameters<typeof makeHostileRepo>[0]): HostileRepo {
  const h = makeHostileRepo(options);
  cleanups.push(h.dispose);
  return h;
}

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function mustFail<T>(result: Result<T>): { kind: string } {
  assert.equal(result.ok, false, 'expected an error result');
  return (result as { ok: false; error: { kind: string } }).error;
}

// Reads through runGit, never plain git: plain git would fire the traps of a hostile repository.
function safe(cwd: string, args: readonly string[]): string {
  return must(runGit(args, { cwd, neutralizeFilters: true })).stdout;
}

function allFilesDigest(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(relative(root, full)).update('\0').update(readFileSync(full)).update('\0');
      else hash.update(relative(root, full)).update('\0symlink-or-special\0');
    }
  };
  walk(root);
  return hash.digest('hex');
}

// What the owner means by "the user's repository is unchanged" (ONB-5, S-32): refs, HEAD, branch, the
// porcelain status including untracked files, the working-tree bytes, and every byte under `.git`.
function userSnapshot(root: string): Record<string, string> {
  return {
    refs: safe(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    head: safe(root, ['rev-parse', 'HEAD']).trim(),
    branch: safe(root, ['branch', '--show-current']).trim(),
    status: safe(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    worktrees: safe(root, ['worktree', 'list', '--porcelain']),
    files: treeDigest(root),
    gitDir: allFilesDigest(join(root, '.git')),
  };
}

describe('staging strategy decision (plan 01-08 Task 1: clone)', () => {
  it('names the clone strategy and builds the matching adapter; the worktree adapter stays available', () => {
    assert.equal(STAGING_STRATEGY, 'clone');
    assert.ok(createStagingWorkspace(STAGING_STRATEGY) instanceof CloneStagingWorkspace);
    assert.ok(createStagingWorkspace('clone') instanceof CloneStagingWorkspace);
    assert.ok(createStagingWorkspace('worktree') instanceof WorktreeStagingWorkspace);
  });
});

describe('safe git (T-01-14)', () => {
  it('carries GIT_CONFIG_NOSYSTEM and GIT_ATTR_NOSYSTEM next to the hooksPath and fsmonitor overrides', () => {
    assert.equal(SAFE_GIT_ENV['GIT_CONFIG_NOSYSTEM'], '1');
    assert.equal(SAFE_GIT_ENV['GIT_ATTR_NOSYSTEM'], '1');
    const entries = Object.entries(SAFE_GIT_ENV);
    assert.ok(entries.some(([, value]) => value === 'core.hooksPath'));
    assert.ok(entries.some(([, value]) => value === 'core.fsmonitor'));
  });

  it('does not read the system git configuration (plain git is the positive control)', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const plain = execFileSync('git', ['config', '--show-scope', '--list'], { cwd: repo.path, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null' } });
    const guarded = safe(repo.path, ['config', '--show-scope', '--list']);
    assert.doesNotMatch(guarded, /^system\t/m, 'the guarded call must not load the system scope');
    if (!/^system\t/m.test(plain)) return; // this machine has no system configuration; nothing to contrast
    assert.match(plain, /^system\t/m);
  });

  it('refuses a caller-supplied -c or --config-env before git runs', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    for (const args of [
      ['-c', 'core.fsmonitor=/bin/true', 'status'],
      ['-ccore.fsmonitor=/bin/true', 'status'],
      ['--config-env=core.fsmonitor=EVIL', 'status'],
      ['status', '--config-env', 'core.fsmonitor=EVIL'],
      ['clone', '-c', 'core.fsmonitor=/bin/true', '--', repo.path, join(tempDir('avarice-never-'), 'x')],
      ['clone', '--config=core.fsmonitor=/bin/true', '--', repo.path, join(tempDir('avarice-never-'), 'x')],
    ]) {
      assert.equal(mustFail(runGit(args, { cwd: repo.path })).kind, 'invalid', `argv ${JSON.stringify(args)}`);
    }
    // `switch -c` is a subcommand option, not a config override, and stays allowed.
    must(runGit(['switch', '-c', 'allowed-branch'], { cwd: repo.path }));
  });
});

describe('positive control: plain git runs the traps of a hostile repository', () => {
  it('fires the hook, the fsmonitor command and the clean filter', () => {
    const control = hostile();
    assert.deepEqual(control.markers(), []);
    control.fireTrapsWithPlainGit();
    assert.deepEqual(control.markers(), ['filter-ran', 'fsmonitor-ran', 'hook-ran']);
    assert.match(readFileSync(join(control.markerDir, 'hook-ran'), 'utf8'), /post-checkout/);
    assert.match(readFileSync(join(control.markerDir, 'hook-ran'), 'utf8'), /post-commit/);
  });
});

const STRATEGIES: ReadonlyArray<readonly [string, () => StagingWorkspace]> = [
  ['clone', () => new CloneStagingWorkspace()],
  ['worktree', () => new WorktreeStagingWorkspace()],
];

for (const [name, make] of STRATEGIES) {
  describe(`staging contract: ${name}`, () => {
    function prepared(repo: ScratchRepo, workRoot: string): { ws: StagingWorkspace; info: StagingInfo } {
      const ws = make();
      const info = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head }));
      return { ws, info };
    }

    it('prepare puts staging at the pin on avarice/onboard-{onb}, head equals the pin, and the branch tip is the pin', () => {
      const repo = makeScratchRepo({ files: { 'README.md': '# r\n', 'src/index.ts': 'export {};\n' }, commits: [{ 'src/later.ts': 'x\n' }] });
      cleanups.push(repo.dispose);
      const workRoot = tempDir('avarice-work-');
      const pin = repo.shas[0] as string;
      const ws = make();
      const info = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin }));

      assert.equal(info.strategy, name);
      assert.equal(info.branch, `avarice/onboard-${ONB}`);
      assert.equal(info.path, join(workRoot, ONB, 'staging'));
      assert.equal(must(ws.head(info.path)), pin);
      assert.equal(safe(info.path, ['rev-parse', `refs/heads/${info.branch}`]).trim(), pin, 'the staging branch tip is the pin: no commit was made');
      assert.equal(safe(info.path, ['rev-list', '--count', `${pin}..HEAD`]).trim(), '0');
      assert.equal(existsSync(join(info.path, 'src', 'later.ts')), false);
    });

    it('changes reports an edit staged in staging, a new file and a deletion against the pin', () => {
      const repo = makeScratchRepo({ files: { 'README.md': '# r\n', 'src/index.ts': 'export {};\n', 'src/gone.ts': 'x\n' } });
      cleanups.push(repo.dispose);
      const { ws, info } = prepared(repo, tempDir('avarice-work-'));
      writeFileSync(join(info.path, 'src', 'index.ts'), 'export const edited = true;\n');
      writeFileSync(join(info.path, 'src', 'fresh.ts'), 'export const fresh = 1;\n');
      rmSync(join(info.path, 'src', 'gone.ts'));
      must(runGit(['add', 'src/index.ts'], { cwd: info.path }));

      assert.deepEqual(must(ws.changes(info.path, repo.head)), { modified: ['src/index.ts'], added: ['src/fresh.ts'], deleted: ['src/gone.ts'] });
    });

    it('listTracked names the files at the pin, describe names the git paths the sandbox must deny', () => {
      const repo = makeScratchRepo({ files: { 'README.md': '# r\n', 'src/index.ts': 'export {};\n', '.planning/PROJECT.md': '# p\n' } });
      cleanups.push(repo.dispose);
      const { ws, info } = prepared(repo, tempDir('avarice-work-'));

      assert.deepEqual(must(ws.listTracked(info.path, repo.head)), ['.planning/PROJECT.md', 'README.md', 'src/index.ts']);
      const description = must(ws.describe(info.path, repo.head));
      assert.deepEqual(description.topLevelEntries.sort(), ['.planning', 'README.md', 'src']);
      assert.deepEqual(description.planningEntries, ['.planning/PROJECT.md']);
      if (name === 'clone') {
        assert.deepEqual(description.gitPaths, [join(realpathSync(info.path), '.git')], 'the clone has exactly one git directory, inside staging');
        assert.deepEqual(description.repoReadAllow, [], 'the sandbox needs no read access to the user repository');
      } else {
        const common = join(realpathSync(repo.path), '.git');
        assert.ok(description.gitPaths.includes(common), 'the worktree strategy must deny the shared .git');
        assert.ok(description.gitPaths.length >= 2, 'and the worktree gitdir');
        assert.deepEqual(description.repoReadAllow, [common]);
      }
    });

    it('never runs a hook, an fsmonitor command or a repository filter (ONB-4)', () => {
      const h = hostile();
      const workRoot = tempDir('avarice-work-');
      const ws = make();
      const facts = must(ws.inspectRepo(h.repo.path));
      assert.equal(facts.pin, h.repo.head);
      const info = must(ws.prepare({ repoPath: h.repo.path, workRoot, onboardingId: ONB, pin: h.repo.head }));
      must(ws.head(info.path));
      must(ws.changes(info.path, h.repo.head));
      must(ws.describe(info.path, h.repo.head));
      must(ws.listTracked(info.path, h.repo.head));
      must(ws.read(info.path, 'README.md', 1024));
      assert.deepEqual(h.markers(), [], 'no marker file may exist');
    });
  });
}

describe('the clone strategy and the user repository (ONB-5, S-32)', () => {
  it('writes nothing under the user .git, never runs the clean filter, and leaves refs, HEAD, branch and status as they were', () => {
    const h = hostile();
    const before = userSnapshot(h.repo.path);
    assert.deepEqual(h.markers(), [], 'reading the snapshot through safe git runs nothing');

    const ws = new CloneStagingWorkspace();
    const workRoot = tempDir('avarice-work-');
    const facts = must(ws.inspectRepo(h.repo.path));
    assert.deepEqual(facts.modified, ['notes.txt']);
    const info = must(ws.prepare({ repoPath: h.repo.path, workRoot, onboardingId: ONB, pin: facts.pin }));
    must(ws.changes(info.path, facts.pin));

    assert.deepEqual(h.markers(), [], 'no hook, fsmonitor command or filter ran');
    assert.deepEqual(userSnapshot(h.repo.path), before);
    assert.equal(safe(h.repo.path, ['for-each-ref', 'refs/heads/avarice']).trim(), '', 'no avarice ref in the user repository');
  });

  it('prepare refuses a path outside the work root and creates nothing', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const workRoot = tempDir('avarice-work-');
    const ws = new CloneStagingWorkspace();
    for (const onboardingId of ['../escape', 'a/b', '', '..', '/abs']) {
      assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, onboardingId, pin: repo.head })).kind, 'invalid', JSON.stringify(onboardingId));
    }
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: 'relative/root', onboardingId: ONB, pin: repo.head })).kind, 'invalid');
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: '--upload-pack=evil' })).kind, 'invalid');
    assert.deepEqual(readdirSync(workRoot), []);
  });

  it('reuses its own staging at the pin without resetting it', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const workRoot = tempDir('avarice-work-');
    const ws = new CloneStagingWorkspace();
    const first = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head }));
    writeFileSync(join(first.path, 'mark.txt'), 'kept\n');
    const second = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head }));
    assert.deepEqual(second, first);
    assert.equal(readFileSync(join(first.path, 'mark.txt'), 'utf8'), 'kept\n');
  });

  it('leaves a staging path it does not own alone and reports a conflict', () => {
    const repo = makeScratchRepo({ commits: [{ 'src/later.ts': 'x\n' }] });
    cleanups.push(repo.dispose);
    const ws = new CloneStagingWorkspace();

    // A directory that is not a clone of this repository.
    const foreignRoot = tempDir('avarice-work-');
    const foreign = join(foreignRoot, ONB, 'staging');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'precious.txt'), 'not yours\n');
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: foreignRoot, onboardingId: ONB, pin: repo.head })).kind, 'conflict');
    assert.equal(readFileSync(join(foreign, 'precious.txt'), 'utf8'), 'not yours\n');

    // Our own clone, but at a commit other than the pin.
    const ownRoot = tempDir('avarice-work-');
    const own = must(ws.prepare({ repoPath: repo.path, workRoot: ownRoot, onboardingId: ONB, pin: repo.head }));
    git(own.path, ['-c', 'user.name=S', '-c', 'user.email=s@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'drift']);
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: ownRoot, onboardingId: ONB, pin: repo.head })).kind, 'conflict');
    assert.ok(existsSync(join(own.path, '.git')), 'the conflicting staging is not removed');

    // Our own clone, asked to stage another commit.
    const otherRoot = tempDir('avarice-work-');
    must(ws.prepare({ repoPath: repo.path, workRoot: otherRoot, onboardingId: ONB, pin: repo.shas[0] as string }));
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: otherRoot, onboardingId: ONB, pin: repo.head })).kind, 'conflict');
  });

  it('finishes after a crash during the clone and does not touch a leftover that is not its own', () => {
    const repo = makeScratchRepo();
    cleanups.push(repo.dispose);
    const ws = new CloneStagingWorkspace();

    // Leftover half-clone at the staging.partial path: ours (a clone of this repository), so it is replaced.
    const crashed = tempDir('avarice-work-');
    mkdirSync(join(crashed, ONB), { recursive: true });
    git(join(crashed, ONB), ['clone', '-q', '--local', '--no-hardlinks', '--no-checkout', '--', repo.path, 'staging.partial']);
    const info = must(ws.prepare({ repoPath: repo.path, workRoot: crashed, onboardingId: ONB, pin: repo.head }));
    assert.equal(must(ws.head(info.path)), repo.head);
    assert.equal(existsSync(join(crashed, ONB, 'staging.partial')), false);

    // Leftover at the same path that is not a clone of this repository: refused, kept.
    const alien = tempDir('avarice-work-');
    mkdirSync(join(alien, ONB, 'staging.partial'), { recursive: true });
    writeFileSync(join(alien, ONB, 'staging.partial', 'precious.txt'), 'not yours\n');
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: alien, onboardingId: ONB, pin: repo.head })).kind, 'conflict');
    assert.equal(readFileSync(join(alien, ONB, 'staging.partial', 'precious.txt'), 'utf8'), 'not yours\n');
  });
});

describe('onboard a hostile repository with the fake host (ONB-4, ONB-5, S-32)', () => {
  function onboard(roots: CliRoots, repoPath: string) {
    return runCli(['onboard', '--policy', 'onboarding', repoPath], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
  }

  it('reaches active, runs no repository code, makes no commit, and leaves the user repository byte-identical', () => {
    const h = hostile();
    const roots = makeRoots();
    cleanups.push(() => rmSync(roots.base, { recursive: true, force: true }));
    const before = userSnapshot(h.repo.path);

    const result = onboard(roots, h.repo.path);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /: active/);
    const status = runCli(['status'], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
    assert.equal(status.code, 0, status.stderr);

    assert.deepEqual(h.markers(), [], 'neither the hooks, the fsmonitor command nor the filter ran during onboard or status');
    assert.deepEqual(userSnapshot(h.repo.path), before, 'the user repository is byte-identical, .git included');

    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      const row = db.prepare('SELECT staging_worktree FROM onboardings').get() as { staging_worktree: string };
      const staging = row.staging_worktree;
      assert.equal(safe(staging, ['rev-parse', 'HEAD']).trim(), h.repo.head, 'staging HEAD is the pin');
      const branch = safe(staging, ['branch', '--show-current']).trim();
      assert.match(branch, /^avarice\/onboard-onb_/);
      assert.equal(safe(staging, ['rev-parse', `refs/heads/${branch}`]).trim(), h.repo.head, 'the staging branch tip equals the pin');
      assert.equal(safe(staging, ['rev-list', '--count', `${h.repo.head}..HEAD`]).trim(), '0', 'onboarding created no commit');
    } finally {
      db.close();
    }
  });
});
