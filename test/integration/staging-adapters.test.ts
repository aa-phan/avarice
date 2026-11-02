// Staging adapters: pinned worktree, safe git, confined reads (ONB-3, ONB-4). Every repository is a scratch
// repository under os.tmpdir(); nothing here runs git against the AVARICE checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync as renameReal, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { runGit } from '../../src/adapters/git/safe-git.ts';
import { STAGING_STRATEGY, createStagingWorkspace } from '../../src/adapters/git/staging-strategy.ts';
import { WorktreeStagingWorkspace } from '../../src/adapters/git/staging-worktree.ts';
import { UnavailableAgentHost } from '../../src/adapters/host/unavailable-host.ts';
import type { Result } from '../../src/domain/result.ts';
import type { InvocationRequest } from '../../src/ports/agent-host.ts';
import type { StagingInfo } from '../../src/ports/staging-workspace.ts';
import { checkoutSnapshot, git, makeScratchRepo, treeDigest, writeExecutable } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function scratch(options?: Parameters<typeof makeScratchRepo>[0]): ScratchRepo {
  const repo = makeScratchRepo(options);
  cleanups.push(repo.dispose);
  return repo;
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

const ONB = 'onb_01TESTONBOARDING000000000';
const BASE_FILES = {
  'README.md': '# scratch\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  '.planning/PROJECT.md': '# Project\n',
  '.planning/ROADMAP.md': '# Roadmap\n',
};

function prepared(repo: ScratchRepo, workRoot: string, pin = repo.head): StagingInfo {
  return must(new WorktreeStagingWorkspace().prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin }));
}

describe('staging strategy', () => {
  // Plan 01-08 Task 1: the owner chose the local clone over the linked worktree. This file keeps exercising the
  // worktree adapter directly (it stays behind the same port); no-repo-exec.test.ts covers the clone.
  it('names the clone strategy and still builds the worktree adapter on request', () => {
    assert.equal(STAGING_STRATEGY, 'clone');
    assert.ok(!(createStagingWorkspace(STAGING_STRATEGY) instanceof WorktreeStagingWorkspace));
    assert.ok(createStagingWorkspace('worktree') instanceof WorktreeStagingWorkspace);
  });
});

describe('prepare', () => {
  it('creates the staging worktree at the pin on avarice/onboard-{onb}, locked, under the work root', () => {
    const repo = scratch({ files: BASE_FILES });
    const workRoot = tempDir('avarice-work-');
    const info = prepared(repo, workRoot);

    assert.deepEqual(info, { path: join(workRoot, ONB, 'staging'), branch: `avarice/onboard-${ONB}`, strategy: 'worktree' });
    assert.equal(git(info.path, ['rev-parse', 'HEAD']).trim(), repo.head);
    assert.equal(git(info.path, ['branch', '--show-current']).trim(), `avarice/onboard-${ONB}`);
    assert.equal(readFileSync(join(info.path, 'src/a.ts'), 'utf8'), BASE_FILES['src/a.ts']);
    const listing = git(repo.path, ['worktree', 'list', '--porcelain']);
    assert.match(listing, /locked avarice-onboarding/);
    const ws = new WorktreeStagingWorkspace();
    assert.equal(must(ws.head(info.path)), repo.head);
  });

  it('pins the SHA it is given, not the current HEAD of the repository', () => {
    const repo = scratch({ files: BASE_FILES, commits: [{ 'src/later.ts': 'x\n' }] });
    const workRoot = tempDir('avarice-work-');
    const root = repo.shas[0] as string;
    const info = prepared(repo, workRoot, root);

    assert.equal(git(info.path, ['rev-parse', 'HEAD']).trim(), root);
    assert.equal(existsSync(join(info.path, 'src/later.ts')), false);
  });

  it('reuses an existing staging worktree at the pin and refuses one that does not contain the pin', () => {
    const repo = scratch({ files: BASE_FILES, commits: [{ 'src/later.ts': 'x\n' }] });
    const workRoot = tempDir('avarice-work-');
    const root = repo.shas[0] as string;
    const first = prepared(repo, workRoot, root);
    writeFileSync(join(first.path, 'mark.txt'), 'kept\n');

    const second = prepared(repo, workRoot, root);
    assert.deepEqual(second, first);
    assert.equal(readFileSync(join(first.path, 'mark.txt'), 'utf8'), 'kept\n', 'reuse must not reset staging');

    const conflicting = new WorktreeStagingWorkspace().prepare({
      repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head,
    });
    assert.equal(mustFail(conflicting).kind, 'conflict');
  });

  it('refuses a target path outside the work root and a pin that is not a commit SHA', () => {
    const repo = scratch({ files: BASE_FILES });
    const workRoot = tempDir('avarice-work-');
    const ws = new WorktreeStagingWorkspace();

    for (const onboardingId of ['../escape', 'a/b', '', '..', '/abs']) {
      const result = ws.prepare({ repoPath: repo.path, workRoot, onboardingId, pin: repo.head });
      assert.equal(mustFail(result).kind, 'invalid', `onboardingId ${JSON.stringify(onboardingId)}`);
    }
    assert.deepEqual(readdirSync(workRoot), [], 'nothing is created under the work root on refusal');
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: 'relative/root', onboardingId: ONB, pin: repo.head })).kind, 'invalid');
    for (const pin of ['HEAD', '--detach', 'main', 'abc', `${repo.head}; touch x`]) {
      assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin })).kind, 'invalid', `pin ${pin}`);
    }
    const missing = 'f'.repeat(40);
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: missing })).kind, 'not_found');
  });
});

describe('describe, listTracked and changes', () => {
  it('describes top-level and planning entries at the pin, git paths and the read allowance', () => {
    const repo = scratch({ files: BASE_FILES, commits: [{ 'later.txt': 'x\n', '.planning/LATER.md': 'x\n' }] });
    const workRoot = tempDir('avarice-work-');
    const root = repo.shas[0] as string;
    const info = prepared(repo, workRoot, root);
    const ws = new WorktreeStagingWorkspace();

    const description = must(ws.describe(info.path, root));
    assert.deepEqual([...description.topLevelEntries].sort(), ['.planning', 'README.md', 'src']);
    assert.deepEqual([...description.planningEntries].sort(), ['.planning/PROJECT.md', '.planning/ROADMAP.md']);
    const commonDir = join(repo.path, '.git');
    assert.deepEqual(description.repoReadAllow, [commonDir]);
    assert.ok(description.gitPaths.includes(commonDir), 'the common dir is a git path');
    assert.ok(description.gitPaths.some((p) => p.startsWith(join(commonDir, 'worktrees'))), 'the worktree git dir is a git path');

    const tracked = must(ws.listTracked(info.path, root));
    assert.deepEqual(tracked, git(repo.path, ['ls-tree', '-r', '--name-only', root]).split('\n').filter(Boolean));
  });

  it('lists one added and one modified path after edits in staging', () => {
    const repo = scratch({ files: BASE_FILES });
    const workRoot = tempDir('avarice-work-');
    const info = prepared(repo, workRoot);
    const ws = new WorktreeStagingWorkspace();
    assert.deepEqual(must(ws.changes(info.path, repo.head)), { modified: [], added: [], deleted: [] });

    must(ws.ensureDir(info.path, '.planning/codebase'));
    writeFileSync(join(info.path, '.planning/codebase/STACK.md'), '# Stack\n');
    writeFileSync(join(info.path, 'src/a.ts'), 'export const a = 2;\n');

    assert.deepEqual(must(ws.changes(info.path, repo.head)), {
      modified: ['src/a.ts'],
      added: ['.planning/codebase/STACK.md'],
      deleted: [],
    });
  });
});

describe('read and ensureDir confinement', () => {
  it('reads staging files and returns null for an absent file', () => {
    const repo = scratch({ files: BASE_FILES });
    const info = prepared(repo, tempDir('avarice-work-'));
    const ws = new WorktreeStagingWorkspace();

    assert.equal(must(ws.read(info.path, 'src/a.ts', 1024)), BASE_FILES['src/a.ts']);
    assert.equal(must(ws.read(info.path, 'src/none.ts', 1024)), null);
    assert.equal(must(ws.read(info.path, 'nodir/none.ts', 1024)), null);
  });

  it('refuses .., absolute paths and symlinks that resolve outside staging', () => {
    const repo = scratch({ files: BASE_FILES });
    const info = prepared(repo, tempDir('avarice-work-'));
    const outside = tempDir('avarice-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    writeFileSync(join(info.path, '..', 'sibling.txt'), 'sibling\n');
    symlinkSync(join(outside, 'secret.txt'), join(info.path, 'link-file'));
    symlinkSync(outside, join(info.path, 'link-dir'));
    symlinkSync(join(outside, 'nowhere'), join(info.path, 'link-dangling'));
    const ws = new WorktreeStagingWorkspace();

    for (const rel of ['../sibling.txt', '../outside', 'src/../../sibling.txt', join(outside, 'secret.txt'), '/etc/passwd', 'link-file', 'link-dir/secret.txt', 'link-dangling']) {
      assert.equal(mustFail(ws.read(info.path, rel, 1024)).kind, 'denied', `read ${rel}`);
    }
    assert.equal(mustFail(ws.ensureDir(info.path, '../escape')).kind, 'denied');
    assert.equal(mustFail(ws.ensureDir(info.path, 'link-dir/created')).kind, 'denied');
    assert.equal(existsSync(join(outside, 'created')), false, 'ensureDir must not create a directory through a symlink');
  });

  it('refuses a file above maxBytes and a directory, and ensureDir creates nested directories', () => {
    const repo = scratch({ files: { ...BASE_FILES, 'big.txt': 'x'.repeat(100) } });
    const info = prepared(repo, tempDir('avarice-work-'));
    const ws = new WorktreeStagingWorkspace();

    assert.equal(mustFail(ws.read(info.path, 'big.txt', 99)).kind, 'invalid');
    assert.equal(must(ws.read(info.path, 'big.txt', 100)), 'x'.repeat(100));
    assert.equal(mustFail(ws.read(info.path, 'src', 1024)).kind, 'invalid');

    must(ws.ensureDir(info.path, '.planning/codebase'));
    must(ws.ensureDir(info.path, '.planning/codebase'));
    assert.ok(existsSync(join(info.path, '.planning/codebase')));
  });
});

describe('inspectRepo and the user checkout', () => {
  it('reports root commit, pin, branch and the names of changed files, never their contents', () => {
    const repo = scratch({
      files: BASE_FILES,
      commits: [{ 'src/c.ts': 'c\n' }],
      modified: { 'src/a.ts': 'MODIFIED-CONTENT-MARKER\n' },
      untracked: { '.env': 'API_KEY=UNTRACKED-SECRET-MARKER\n', 'notes/todo.txt': 'x\n' },
    });
    git(repo.path, ['remote', 'add', 'origin', 'https://user:token-123@example.invalid/org/repo.git']);
    const facts = must(new WorktreeStagingWorkspace().inspectRepo(repo.path));

    assert.equal(facts.gitRoot, repo.path);
    assert.equal(facts.rootCommit, repo.shas[0]);
    assert.equal(facts.pin, repo.head);
    assert.equal(facts.branch, 'main');
    assert.deepEqual(facts.modified, ['src/a.ts']);
    assert.deepEqual([...facts.untracked].sort(), ['.env', 'notes/todo.txt']);
    assert.equal(facts.remote, 'https://example.invalid/org/repo.git');
    const serialized = JSON.stringify(facts);
    assert.ok(!serialized.includes('UNTRACKED-SECRET-MARKER') && !serialized.includes('MODIFIED-CONTENT-MARKER') && !serialized.includes('token-123'));
  });

  it('leaves the checkout HEAD, branch, status and file bytes identical after prepare and inspectRepo', () => {
    const repo = scratch({
      files: BASE_FILES,
      commits: [{ 'src/c.ts': 'c\n' }],
      modified: { 'src/a.ts': 'dirty\n' },
      untracked: { '.env': 'K=V\n' },
    });
    const before = checkoutSnapshot(repo.path);
    const ws = new WorktreeStagingWorkspace();
    const workRoot = tempDir('avarice-work-');

    must(ws.inspectRepo(repo.path));
    const info = must(ws.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head }));
    must(ws.describe(info.path, repo.head));
    must(ws.inspectRepo(repo.path));

    assert.deepEqual(checkoutSnapshot(repo.path), before);
    assert.equal(treeDigest(repo.path), before.digest);
  });
});

describe('safe git (ONB-4)', () => {
  it('runs every call with hooks off, fsmonitor off, optional locks off and no prompt', () => {
    const repo = scratch({ files: BASE_FILES });
    assert.equal(must(runGit(['config', '--get', 'core.hooksPath'], { cwd: repo.path })).stdout.trim(), '/dev/null');
    assert.equal(must(runGit(['config', '--get', 'core.fsmonitor'], { cwd: repo.path })).stdout.trim(), 'false');
    assert.equal(must(runGit(['rev-parse', '--show-toplevel'], { cwd: repo.path })).stdout.trim(), repo.path);
  });

  it('passes arguments as argv, never through a shell', () => {
    const repo = scratch({ files: BASE_FILES });
    const marker = join(repo.base, 'shell-ran');
    const result = runGit(['rev-parse', '--verify', `HEAD; touch ${marker}`], { cwd: repo.path });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: { cause?: string } }).error.cause ?? '', /git rev-parse exited 128/);
    assert.equal(existsSync(marker), false);
  });

  it('does not run repository hooks or an fsmonitor command, while plain git does', () => {
    const repo = scratch({ files: BASE_FILES });
    const marks = tempDir('avarice-marks-');
    const hookMark = join(marks, 'hook');
    const fsmonitorMark = join(marks, 'fsmonitor');
    writeExecutable(join(repo.path, '.git/hooks/post-checkout'), `#!/bin/sh\necho ran >> '${hookMark}'\n`);
    const fsmonitor = writeExecutable(join(marks, 'fsmon.sh'), `#!/bin/sh\necho ran >> '${fsmonitorMark}'\nprintf '\\0'\n`);
    git(repo.path, ['config', 'core.fsmonitor', fsmonitor]);

    // Positive control: without the overrides both would run, so the absence below is meaningful.
    const control = join(tempDir('avarice-control-'), 'wt');
    git(repo.path, ['worktree', 'add', '-q', '--detach', control, repo.head]);
    git(repo.path, ['status', '--porcelain=v2']);
    assert.ok(existsSync(hookMark), 'control: the post-checkout hook runs under plain git');
    assert.ok(existsSync(fsmonitorMark), 'control: the fsmonitor command runs under plain git');
    rmSync(hookMark);
    rmSync(fsmonitorMark);

    const ws = new WorktreeStagingWorkspace();
    const info = must(ws.prepare({ repoPath: repo.path, workRoot: tempDir('avarice-work-'), onboardingId: ONB, pin: repo.head }));
    must(ws.inspectRepo(repo.path));
    must(ws.changes(info.path, repo.head));
    must(ws.describe(info.path, repo.head));
    must(ws.listTracked(info.path, repo.head));
    must(ws.head(info.path));

    assert.equal(existsSync(hookMark), false, 'post-checkout hook ran during staging');
    assert.equal(existsSync(fsmonitorMark), false, 'fsmonitor command ran during staging');
  });
});

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function blobFiles(dataRoot: string): string[] {
  const root = join(dataRoot, 'artifacts');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('LocalArtifactStore', () => {
  const META = { kind: 'transcript' };

  it('stores content-addressed blobs idempotently at {dataRoot}/artifacts/{sha[0:2]}/{sha} and reads them back', () => {
    const dataRoot = tempDir('avarice-data-');
    const store = new LocalArtifactStore(dataRoot);
    const bytes = new TextEncoder().encode('hello artifact\n');
    const hex = sha(bytes);

    assert.deepEqual(must(store.has(`sha256:${hex}`)), false);
    const first = must(store.put(bytes, META));
    const second = must(store.put(bytes, META));
    assert.deepEqual(first, { digest: `sha256:${hex}`, size: bytes.length });
    assert.deepEqual(second, first);
    assert.deepEqual(blobFiles(dataRoot), [join(dataRoot, 'artifacts', hex.slice(0, 2), hex)], 'one blob, no temp files');
    assert.deepEqual(must(store.has(first.digest)), true);
    assert.deepEqual(Buffer.from(must(store.get(first.digest))), Buffer.from(bytes));
    assert.equal(statSync(blobFiles(dataRoot)[0] as string).mode & 0o777, 0o600);
  });

  it('stores the empty content and refuses a digest that is not sha256 plus 64 hex characters', () => {
    const store = new LocalArtifactStore(tempDir('avarice-data-'));
    const empty = must(store.put(new Uint8Array(0), META));
    assert.equal(empty.digest, `sha256:${sha(new Uint8Array(0))}`);
    assert.equal(empty.size, 0);

    for (const bad of ['', 'sha256:', `sha256:${'A'.repeat(64)}`, `sha256:../../${'a'.repeat(52)}`, 'a'.repeat(64), `sha256:${'a'.repeat(63)}`]) {
      assert.equal(mustFail(store.get(bad)).kind, 'invalid', `get ${bad}`);
      assert.equal(mustFail(store.has(bad)).kind, 'invalid', `has ${bad}`);
    }
    assert.equal(mustFail(store.get(`sha256:${'a'.repeat(64)}`)).kind, 'not_found');
  });

  it('syncs the temp file before the rename and does not rewrite content that is already stored', () => {
    const dataRoot = tempDir('avarice-data-');
    const calls: string[] = [];
    const store = new LocalArtifactStore(dataRoot, {
      fsyncSync: () => { calls.push('fsync'); },
      renameSync: (from, to) => { calls.push('rename'); renameReal(from, to); },
    });
    const bytes = new TextEncoder().encode('ordered');
    must(store.put(bytes, META));
    assert.ok(calls.indexOf('fsync') >= 0 && calls.indexOf('fsync') < calls.indexOf('rename'), `order was ${calls.join(',')}`);
    const renames = calls.filter((c) => c === 'rename').length;
    must(store.put(bytes, META));
    assert.equal(calls.filter((c) => c === 'rename').length, renames, 'second put is a no-op');
  });

  it('leaves no file under the digest path and no temp file when the put fails after the temp write', () => {
    const dataRoot = tempDir('avarice-data-');
    const store = new LocalArtifactStore(dataRoot, {
      renameSync: () => { throw new Error('injected failure after the temp write'); },
    });
    const bytes = new TextEncoder().encode('never published');
    const result = store.put(bytes, META);

    assert.equal(mustFail(result).kind, 'internal');
    assert.deepEqual(blobFiles(dataRoot), []);
    assert.equal(must(store.has(`sha256:${sha(bytes)}`)), false);
  });

  it('reports a blob whose bytes no longer match its digest as corrupt instead of returning it', () => {
    const dataRoot = tempDir('avarice-data-');
    const store = new LocalArtifactStore(dataRoot);
    const stored = must(store.put(new TextEncoder().encode('original'), META));
    writeFileSync(blobFiles(dataRoot)[0] as string, 'tampered');

    assert.equal(mustFail(store.get(stored.digest)).kind, 'internal');
  });
});

describe('UnavailableAgentHost (ONB-12 fail-closed default)', () => {
  const REQUEST: InvocationRequest = {
    onboardingId: ONB, runId: 'run_01TEST', invocationId: 'inv_01TEST', purpose: 'map', contractVersion: 1,
    contractDigest: `sha256:${'0'.repeat(64)}`, prompt: '/gsd-map-codebase', cwd: '/nonexistent', model: 'sonnet',
    costCapUsd: 1, wallClockMs: 1000,
  };

  it('reports enforcement none and no contained-invocation capability', () => {
    const host = new UnavailableAgentHost();
    assert.equal(host.descriptor.port, 'agent-host');
    assert.equal(host.descriptor.attributes?.['enforcement'], 'none');
    assert.equal(host.descriptor.capabilities['contained-invocation'], false);
  });

  it('answers every invocation with unsupported contained-invocation and does nothing else', async () => {
    const host = new UnavailableAgentHost();
    const result = await host.invoke(REQUEST, new AbortController().signal);
    assert.equal(result.ok, false);
    assert.deepEqual((result as { ok: false; error: unknown }).error, {
      kind: 'unsupported',
      capability: 'contained-invocation',
      reducedMode: 'none until the Claude Code host adapter is admitted',
    });
  });
});
