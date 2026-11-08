// RunWorkspace adapter (plan 02-07; D-01, D-02, D-03; CON-9, CON-16): a run's clone, the supervisor's commit and the hand-off of
// the run branch to the source. Every repository is a scratch repository under os.tmpdir(); nothing here runs git against the
// AVARICE checkout or the owner's repositories.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { checkoutDigest, RUN_REF_GLOB } from '../../scripts/checkout-digest.ts';
import { AVARICE_COMMIT_IDENTITY, CloneRunWorkspace } from '../../src/adapters/git/run-workspace.ts';
import { runGit } from '../../src/adapters/git/safe-git.ts';
import { checkRelative } from '../../src/adapters/git/staging-base.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunWorkspaceInfo } from '../../src/ports/run-workspace.ts';
import { git, makeScratchRepo, treeDigest, writeExecutable } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

const RUN = 'run_TESTRUN1';
const BASE_FILES = {
  'README.md': '# scratch\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  '.gitignore': 'ignored.log\n.cache/\n',
};

function scratch(options?: Parameters<typeof makeScratchRepo>[0]): ScratchRepo {
  const repo = makeScratchRepo({ files: BASE_FILES, ...options });
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

function mustFail<T>(result: Result<T>): { kind: string; [key: string]: unknown } {
  assert.equal(result.ok, false, 'expected an error result');
  return (result as { ok: false; error: { kind: string } }).error;
}

const ws = new CloneRunWorkspace();

function prepared(repo: ScratchRepo, workRoot: string, runId = RUN, pin = repo.head): RunWorkspaceInfo {
  return must(ws.prepare({ repoPath: repo.path, workRoot, runId, pin }));
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

// Everything D-02 says the hand-off leaves alone: the digest script's view, every file outside .git including ignored ones, the
// index and config bytes, HEAD, and every ref outside the one new run ref.
function sourceState(repo: ScratchRepo): Record<string, unknown> {
  const gitDir = join(repo.path, '.git');
  const digest = checkoutDigest(repo.path, [RUN_REF_GLOB]);
  return {
    // refsAllowed counts the run refs left out of the refs digest, which is the one thing that is meant to change.
    digest: { ...digest, counts: { ...digest.counts, refsAllowed: 0 } },
    files: treeDigest(repo.path),
    index: sha256(readFileSync(join(gitDir, 'index'))),
    config: sha256(readFileSync(join(gitDir, 'config'))),
    head: readFileSync(join(gitDir, 'HEAD'), 'utf8'),
    refs: refLines(repo).filter((line) => !line.includes('refs/heads/avarice/run_')),
    fetchHead: existsSync(join(gitDir, 'FETCH_HEAD')),
  };
}

function refLines(repo: ScratchRepo): string[] {
  return git(repo.path, ['for-each-ref']).split('\n').filter((l) => l !== '');
}

function write(root: string, rel: string, content: string): void {
  const target = join(root, rel);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

describe('CloneRunWorkspace.prepare (D-01)', () => {
  it('clones the source at the pin onto avarice/<runId> under {workRoot}/{runId}/clone and leaves the source alone', () => {
    const repo = scratch({ commits: [{ 'src/later.ts': 'export const later = 1;\n' }] });
    const workRoot = tempDir('avarice-runws-');
    const before = sourceState(repo);
    const pin = repo.shas[0] as string;

    const info = prepared(repo, workRoot, RUN, pin);
    assert.equal(info.path, join(workRoot, RUN, 'clone'));
    assert.equal(info.branch, `avarice/${RUN}`);
    assert.equal(git(info.path, ['rev-parse', 'HEAD']).trim(), pin);
    assert.equal(git(info.path, ['branch', '--show-current']).trim(), `avarice/${RUN}`);
    assert.equal(existsSync(join(info.path, 'src', 'later.ts')), false, 'the working tree is the pin, not the source HEAD');
    assert.equal(existsSync(join(workRoot, RUN, 'clone.partial')), false, 'the partial directory was renamed away');
    assert.equal(must(ws.head(info.path)), pin);
    assert.deepEqual(sourceState(repo), before, 'preparation wrote nothing to the source');
  });

  it('reuses a complete clone under the staging-clone rules and leaves it as it was', () => {
    const repo = scratch();
    const workRoot = tempDir('avarice-runws-');
    const info = prepared(repo, workRoot);
    writeFileSync(join(info.path, 'marker.txt'), 'kept\n');

    assert.deepEqual(prepared(repo, workRoot), info);
    assert.equal(readFileSync(join(info.path, 'marker.txt'), 'utf8'), 'kept\n');

    git(info.path, ['switch', '-q', '-c', 'somewhere-else']);
    const conflict = mustFail(ws.prepare({ repoPath: repo.path, workRoot, runId: RUN, pin: repo.head }));
    assert.equal(conflict.kind, 'conflict', 'a clone on another branch is not reusable');
    assert.equal(existsSync(join(info.path, 'marker.txt')), true);
  });

  it('reports a foreign clone.partial as a conflict and leaves it; an interrupted own partial is replaced', () => {
    const repo = scratch();
    const workRoot = tempDir('avarice-runws-');
    const partial = join(workRoot, RUN, 'clone.partial');
    write(partial, 'precious.txt', 'not ours\n');
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, runId: RUN, pin: repo.head })).kind, 'conflict');
    assert.equal(readFileSync(join(partial, 'precious.txt'), 'utf8'), 'not ours\n');
    assert.equal(existsSync(join(workRoot, RUN, 'clone')), false);

    rmSync(partial, { recursive: true, force: true });
    mkdirSync(join(partial, '.git'), { recursive: true });
    const info = prepared(repo, workRoot);
    assert.equal(existsSync(info.path), true);
    assert.equal(existsSync(partial), false);
  });

  it('validates pin, run ID and work root before any side effect', () => {
    const repo = scratch();
    const workRoot = tempDir('avarice-runws-');
    for (const input of [
      { runId: RUN, pin: 'abc123' },
      { runId: 'run/../x', pin: repo.head },
      { runId: '', pin: repo.head },
      { runId: RUN, pin: repo.head.toUpperCase() },
    ]) {
      assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, ...input })).kind, 'invalid', JSON.stringify(input));
    }
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot: 'relative/root', runId: RUN, pin: repo.head })).kind, 'invalid');
    assert.equal(existsSync(join(workRoot, RUN)), false, 'nothing was created');
    const unknown = 'f'.repeat(40);
    assert.equal(mustFail(ws.prepare({ repoPath: repo.path, workRoot, runId: RUN, pin: unknown })).kind, 'not_found');
  });
});

describe('CloneRunWorkspace.describe, status, readText and ensureDir', () => {
  it('lists the top level and the requested directories at HEAD and names only the clone git directory', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const described = must(ws.describe(info.path, ['src', 'missing']));
    assert.deepEqual([...described.topLevelEntries].sort(), ['.gitignore', 'README.md', 'src']);
    assert.deepEqual(described.entriesByDir, { src: ['a.ts', 'b.ts'], missing: [] });
    assert.deepEqual(described.gitPaths.map((p) => realpathSync(p)), [realpathSync(join(info.path, '.git'))]);
    assert.deepEqual(described.repoReadAllow, []);
    assert.equal(mustFail(ws.describe(info.path, ['../etc'])).kind, 'denied');
  });

  it('status lists added, modified and deleted paths against HEAD and leaves the real index alone', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    assert.deepEqual(must(ws.status(info.path)), []);
    const indexBefore = readFileSync(join(info.path, '.git', 'index'));

    write(info.path, 'src/new.ts', 'export const n = 1;\n');
    write(info.path, 'src/a.ts', 'export const a = 100;\n');
    rmSync(join(info.path, 'src', 'b.ts'));
    write(info.path, 'ignored.log', 'noise\n');
    assert.deepEqual(must(ws.status(info.path)), [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'deleted' },
      { path: 'src/new.ts', status: 'added' },
    ]);
    assert.deepEqual(readFileSync(join(info.path, '.git', 'index')), indexBefore, 'the clone index is byte-identical');
    assert.equal(existsSync(join(info.path, '.git', 'index.lock')), false);
  });

  it('readText is confined to the clone and ensureDir makes a plain directory', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    assert.equal(must(ws.readText(info.path, 'src/a.ts', 1024)), BASE_FILES['src/a.ts']);
    assert.equal(must(ws.readText(info.path, 'src/none.ts', 1024)), null);
    assert.equal(mustFail(ws.readText(info.path, '../outside', 1024)).kind, 'denied');
    assert.equal(mustFail(ws.readText(info.path, 'src/a.ts', 3)).kind, 'invalid');
    must(ws.ensureDir(info.path, 'out/deep'));
    assert.equal(statSync(join(info.path, 'out', 'deep')).isDirectory(), true);
  });
});

describe('checkRelative splits on a slash only (R-IN-04)', () => {
  it('a backslash is an ordinary file-name character; a slash separates; .. is still refused', () => {
    assert.deepEqual(must(checkRelative('a\\b')), ['a\\b']);
    assert.deepEqual(must(checkRelative('a/b')), ['a', 'b']);
    assert.deepEqual(must(checkRelative('dir/a\\b/c')), ['dir', 'a\\b', 'c']);
    assert.equal(mustFail(checkRelative('a/../b')).kind, 'denied');
    assert.equal(mustFail(checkRelative('../b')).kind, 'denied');
  });
});

describe('CloneRunWorkspace.commit (D-03)', () => {
  it('commits exactly the given paths with the fixed identity and the trailers, leaving other changes and other staged paths out', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 2;\n');
    write(info.path, 'src/c.ts', 'export const c = 3;\n');
    write(info.path, 'src/b.ts', 'export const b = 22;\n');
    git(info.path, ['add', 'src/b.ts']); // staged by someone else: must not ride along

    const sha = must(ws.commit(info.path, { paths: ['src/a.ts', 'src/c.ts'], message: 'avarice: t', trailers: ['Avarice-Run: run_X', 'Avarice-Attempt: att_Y'] }));
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(git(info.path, ['rev-parse', 'HEAD']).trim(), sha);
    assert.equal(git(info.path, ['rev-parse', 'HEAD~1']).trim(), repo.head);
    assert.deepEqual(git(info.path, ['diff', '--name-only', repo.head, sha]).trim().split('\n'), ['src/a.ts', 'src/c.ts']);
    const who = git(info.path, ['log', '-1', '--format=%an|%ae|%cn|%ce', sha]).trim();
    assert.equal(who, `${AVARICE_COMMIT_IDENTITY.name}|${AVARICE_COMMIT_IDENTITY.email}|${AVARICE_COMMIT_IDENTITY.name}|${AVARICE_COMMIT_IDENTITY.email}`);
    assert.equal(AVARICE_COMMIT_IDENTITY.name, 'AVARICE');
    assert.equal(AVARICE_COMMIT_IDENTITY.email, 'avarice@localhost.invalid');
    const body = git(info.path, ['log', '-1', '--format=%B', sha]).trim();
    assert.ok(body.startsWith('avarice: t'), body);
    assert.ok(body.endsWith('Avarice-Run: run_X\nAvarice-Attempt: att_Y'), body);
    assert.deepEqual(must(ws.status(info.path)), [{ path: 'src/b.ts', status: 'modified' }], 'the uncommitted edit is still there');
    assert.equal(readFileSync(join(info.path, 'src', 'b.ts'), 'utf8'), 'export const b = 22;\n');
  });

  it('commits a deletion and a path that looks like a glob literally', () => {
    const repo = scratch({ files: { ...BASE_FILES, 'pages/[id].tsx': 'export default 1;\n', 'pages/x.tsx': 'export default 2;\n' } });
    const info = prepared(repo, tempDir('avarice-runws-'));
    rmSync(join(info.path, 'src', 'a.ts'));
    write(info.path, 'pages/[id].tsx', 'export default 11;\n');
    write(info.path, 'pages/x.tsx', 'export default 22;\n');

    const sha = must(ws.commit(info.path, { paths: ['src/a.ts', 'pages/[id].tsx'], message: 'avarice: literal' }));
    assert.deepEqual(git(info.path, ['diff', '--name-status', repo.head, sha]).trim().split('\n'), ['M\tpages/[id].tsx', 'D\tsrc/a.ts']);
    assert.deepEqual(must(ws.status(info.path)), [{ path: 'pages/x.tsx', status: 'modified' }], 'the glob did not sweep pages/x.tsx in');
  });

  it('a global commit.gpgsign=true does not prompt or fail, and hooks and filters of the clone do not run', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const marks = tempDir('avarice-runws-marks-');
    for (const hook of ['pre-commit', 'commit-msg', 'prepare-commit-msg', 'post-commit']) {
      writeExecutable(join(info.path, '.git', 'hooks', hook), `#!/bin/sh\ntouch "${join(marks, hook)}"\nexit 1\n`);
    }
    git(info.path, ['config', 'filter.spy.clean', `touch "${join(marks, 'clean-filter')}"; cat`]);
    git(info.path, ['config', 'filter.spy.required', 'true']);
    writeFileSync(join(info.path, '.git', 'info', 'attributes'), '*.ts filter=spy\n');
    write(info.path, 'src/a.ts', 'export const a = 5;\n');

    const home = tempDir('avarice-runws-home-');
    writeFileSync(join(home, '.gitconfig'), '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /nonexistent/gpg-would-fail\n[user]\n\tname = Someone Else\n\temail = else@example.invalid\n');
    const savedHome = process.env['HOME'];
    process.env['HOME'] = home;
    let sha: string;
    try {
      sha = must(ws.commit(info.path, { paths: ['src/a.ts'], message: 'avarice: signed?' }));
    } finally {
      if (savedHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = savedHome;
    }
    assert.equal(git(info.path, ['log', '-1', '--format=%an|%G?', sha]).trim(), 'AVARICE|N', 'AVARICE identity and no signature');
    assert.deepEqual(readdirNames(marks), [], 'no hook and no clean filter ran');
  });

  it('refuses an empty list, an absolute path, .., .git and a leading dash as invalid, and runs no git', () => {
    const nowhere = join(tempDir('avarice-runws-'), 'no-such-clone'); // a git call here would be `unavailable`, not `invalid`
    for (const paths of [[], ['/etc/x'], ['../x'], ['-x'], ['src/../../x'], ['.git/config'], ['a/.git/hooks/x'], [''], ['src/a.ts', '--all']]) {
      const refused = mustFail(ws.commit(nowhere, { paths, message: 'avarice: no' }));
      assert.equal(refused.kind, 'invalid', JSON.stringify(paths));
    }
    assert.equal(mustFail(ws.commit(nowhere, { paths: ['src/a.ts'], message: '' })).kind, 'invalid');
    assert.equal(mustFail(ws.commit(nowhere, { paths: ['src/a.ts'], message: 'm', trailers: ['not a trailer'] })).kind, 'invalid');
    assert.equal(mustFail(ws.commit(nowhere, { paths: ['src/a.ts'], message: 'm', trailers: ['A: b\nC: d'] })).kind, 'invalid');
  });

  it('a commit with nothing changed in the given paths is a conflict and makes no commit', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/b.ts', 'export const b = 9;\n');
    assert.equal(mustFail(ws.commit(info.path, { paths: ['src/a.ts'], message: 'avarice: none' })).kind, 'conflict');
    assert.equal(must(ws.head(info.path)), repo.head);
  });
});

function readdirNames(dir: string): string[] {
  return execFileSync('ls', ['-A', dir], { encoding: 'utf8' }).split('\n').filter((l) => l !== '');
}

describe('CloneRunWorkspace.fetchIntoSource (D-02)', () => {
  it('creates one ref in the source and nothing else: HEAD, index, tree, config and every other ref are identical', () => {
    const repo = scratch({ modified: { 'README.md': '# scratch, edited\n' }, untracked: { '.env': 'KEY=secret\n', 'ignored.log': 'noise\n', 'notes/todo.txt': 'later\n' } });
    git(repo.path, ['add', 'README.md']); // a staged change in the user's index
    write(repo.path, 'src/a.ts', 'export const a = 1; // unstaged edit\n');
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 2;\n');
    const commit = must(ws.commit(info.path, { paths: ['src/a.ts'], message: 'avarice: t', trailers: ['Avarice-Run: run_X'] }));

    const before = sourceState(repo);
    const refsBefore = refLines(repo);
    const handed = must(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch }));
    assert.deepEqual(handed, { created: true, commit });

    assert.deepEqual(sourceState(repo), before, 'the user checkout is byte-identical');
    assert.equal(git(repo.path, ['rev-parse', `refs/heads/${info.branch}`]).trim(), commit);
    const added = refLines(repo).filter((line) => !refsBefore.includes(line));
    assert.deepEqual(added, [`${commit} commit\trefs/heads/${info.branch}`], 'the only new ref line is the run branch');
    assert.equal(refLines(repo).length, refsBefore.length + 1);
    assert.equal(existsSync(join(repo.path, '.git', 'FETCH_HEAD')), false, 'no FETCH_HEAD');
    assert.equal(git(repo.path, ['branch', '--show-current']).trim(), 'main');
    assert.equal(readFileSync(join(repo.path, 'src', 'a.ts'), 'utf8'), 'export const a = 1; // unstaged edit\n', 'no checkout happened');
  });

  it('a second call is success with created false; a moved ref is a conflict and is not changed', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 2;\n');
    const commit = must(ws.commit(info.path, { paths: ['src/a.ts'], message: 'avarice: t' }));
    assert.equal(must(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch })).created, true);
    assert.deepEqual(must(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch })), { created: false, commit });

    git(repo.path, ['update-ref', `refs/heads/${info.branch}`, repo.head]); // the user moved it
    const conflict = mustFail(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch }));
    assert.equal(conflict.kind, 'conflict');
    assert.equal(git(repo.path, ['rev-parse', `refs/heads/${info.branch}`]).trim(), repo.head, 'the ref is unchanged');
  });

  it('on a conflict nothing is fetched: the clone commit does not reach the source', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 3;\n');
    const commit = must(ws.commit(info.path, { paths: ['src/a.ts'], message: 'avarice: t' }));
    git(repo.path, ['branch', info.branch, repo.head]);
    assert.equal(mustFail(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch })).kind, 'conflict');
    assert.throws(() => git(repo.path, ['cat-file', '-e', `${commit}^{commit}`]), 'the commit object was never fetched');
  });

  it('refuses a branch outside avarice/<runId>, a missing clone branch and a non-repository', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    for (const branch of ['main', 'avarice/../x', '+avarice/run_X', 'avarice/a b', 'refs/heads/avarice/run_X', '-x']) {
      assert.equal(mustFail(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch })).kind, 'invalid', branch);
    }
    assert.equal(mustFail(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: 'avarice/run_ABSENT' })).kind, 'not_found');
    assert.deepEqual(refLines(repo).filter((l) => l.includes('avarice/')), []);
  });

  it('fsck is on: a commit whose tree has a .git entry is rejected and no ref is created', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.invalid' };
    const run = (args: string[], input?: Buffer): string => execFileSync('git', args, { cwd: info.path, env, encoding: 'utf8', ...(input ? { input } : {}) });
    const blob = run(['hash-object', '-w', '--stdin'], Buffer.from('payload\n')).trim();
    const entry = Buffer.concat([Buffer.from('100644 .git\0'), Buffer.from(blob, 'hex')]);
    const tree = run(['hash-object', '-w', '-t', 'tree', '--literally', '--stdin'], entry).trim();
    const hostile = run(['commit-tree', tree, '-p', 'HEAD', '-m', 'hostile']).trim();
    run(['update-ref', `refs/heads/${info.branch}`, hostile]);

    const before = sourceState(repo);
    const refused = mustFail(ws.fetchIntoSource({ repoPath: repo.path, clonePath: info.path, branch: info.branch }));
    assert.equal(refused.kind, 'internal');
    assert.match(String(refused['cause']), /hasDotgit/, 'git named the fsck finding');
    assert.deepEqual(refLines(repo).filter((l) => l.includes('avarice/')), [], 'no run ref was created');
    assert.deepEqual(sourceState(repo), before);
  });
});

describe('runGit option allowlists and fixed options (plan 02-07)', () => {
  const nowhere = join(tmpdir(), 'avarice-no-such-dir-02-07');

  it('fetch refuses a refspec starting with + and any option outside the four allowed', () => {
    const refused = [
      ['fetch', '--no-tags', '--', '/x', '+refs/heads/a:refs/heads/a'],
      ['fetch', '--', '/x', '+a:b'],
      ['fetch', '+a:b'],
      ['fetch', '--force', '--', '/x', 'a:b'],
      ['fetch', '-f', '--', '/x', 'a:b'],
      ['fetch', '--depth=1', '--', '/x', 'a:b'],
      ['fetch', '--update-head-ok', '--', '/x', 'a:b'],
      ['fetch', '--upload-pack=touch /tmp/x', '--', '/x', 'a:b'],
      ['fetch', '--prune', '--', '/x', 'a:b'],
    ];
    for (const args of refused) assert.equal(mustFail(runGit(args, { cwd: nowhere })).kind, 'invalid', args.join(' '));
    const allowed = ['fetch', '--no-tags', '--no-write-fetch-head', '--quiet', '-q', '--', '/x', 'refs/heads/a:refs/heads/a'];
    assert.equal(mustFail(runGit(allowed, { cwd: nowhere })).kind, 'unavailable', 'passes the allowlist and only then fails to start in a missing directory');
  });

  it('commit refuses any option outside --no-verify, --no-gpg-sign, -m, --quiet and -q', () => {
    for (const option of ['--amend', '-a', '--all', '--author=x <x@x>', '--allow-empty', '-S', '--gpg-sign', '-C', '-F', '--file=x', '--reuse-message=HEAD', '--no-edit', '-n', '--date=now', '--template=x', '--cleanup=strip', '-e']) {
      assert.equal(mustFail(runGit(['commit', option, '-m', 'x', '--', 'a'], { cwd: nowhere })).kind, 'invalid', option);
    }
    assert.equal(mustFail(runGit(['commit', '-m'], { cwd: nowhere })).kind, 'invalid', 'a dangling -m');
    const allowed = ['commit', '--no-verify', '--no-gpg-sign', '-q', '--quiet', '-m', '--amend', '--', '--all'];
    assert.equal(mustFail(runGit(allowed, { cwd: nowhere })).kind, 'unavailable', 'a message that looks like an option and a pathspec after -- are values');
    assert.equal(mustFail(runGit(['-c', 'core.x=y', 'commit'], { cwd: nowhere })).kind, 'invalid');
  });

  it('indexFile needs an absolute path and keeps the repository index out of the call; identity and fsck set fixed keys only', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    assert.equal(mustFail(runGit(['read-tree', 'HEAD'], { cwd: info.path, indexFile: 'relative/index' })).kind, 'invalid');

    const indexBefore = readFileSync(join(info.path, '.git', 'index'));
    const scratchIndex = join(tempDir('avarice-runws-idx-'), 'index');
    must(runGit(['read-tree', 'HEAD'], { cwd: info.path, indexFile: scratchIndex }));
    assert.equal(existsSync(scratchIndex), true);
    assert.deepEqual(readFileSync(join(info.path, '.git', 'index')), indexBefore);

    const who = must(runGit(['var', 'GIT_AUTHOR_IDENT'], { cwd: info.path, identity: { name: 'Fixed Name', email: 'fixed@localhost.invalid' } }));
    assert.match(who.stdout, /^Fixed Name <fixed@localhost\.invalid>/);
    const fsck = must(runGit(['config', '--get', 'transfer.fsckObjects'], { cwd: info.path, fsck: true }));
    assert.equal(fsck.stdout.trim(), 'true');
    const literal = must(runGit(['ls-files', '--', 'src/*.ts'], { cwd: info.path, literalPathspecs: true }));
    assert.equal(literal.stdout, '', 'a glob is a literal name');
  });
});

describe('snapshot, changedSince and discard (CON-16, CON-9)', () => {
  // The clone as the owner would leave it: a tracked file edited and files that are not tracked, all before the run starts.
  const USER_README = '# scratch, edited by the user before the run\n';

  function userDirtyClone(repo: ScratchRepo): RunWorkspaceInfo {
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'README.md', USER_README);
    write(info.path, 'notes.txt', 'user notes\n');
    write(info.path, 'ignored.log', 'user noise\n');
    return info;
  }

  const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');

  it('snapshot records HEAD and a tree holding the user versions, and leaves the clone index and HEAD alone', () => {
    const repo = scratch();
    const info = userDirtyClone(repo);
    const indexBefore = readFileSync(join(info.path, '.git', 'index'));

    const snap = must(ws.snapshot(info.path));
    assert.equal(snap.head, repo.head);
    assert.match(snap.tree, /^[0-9a-f]{40}$/);
    assert.equal(git(info.path, ['cat-file', 'blob', `${snap.tree}:README.md`]), USER_README);
    assert.equal(git(info.path, ['cat-file', 'blob', `${snap.tree}:notes.txt`]), 'user notes\n');
    assert.throws(() => git(info.path, ['cat-file', 'blob', `${snap.tree}:ignored.log`]), 'an ignored file is not in the tree');
    assert.deepEqual(snap.ignored, ['ignored.log']);
    assert.deepEqual(readFileSync(join(info.path, '.git', 'index')), indexBefore);
    assert.deepEqual(readdirNames(join(info.path, '..', 'tmp')), [], 'the temporary index is gone');
    assert.equal(must(ws.head(info.path)), repo.head);
  });

  it('discard restores what the run changed to the snapshot content, deletes what it added, keeps user content and ignored files', () => {
    const repo = scratch();
    const info = userDirtyClone(repo);
    const snap = must(ws.snapshot(info.path));
    const indexBefore = readFileSync(join(info.path, '.git', 'index'));

    write(info.path, 'src/new.ts', 'export const added = 1;\n'); // run: new
    write(info.path, 'src/b.ts', 'export const b = 99;\n'); // run: modified a tracked file
    write(info.path, 'README.md', '# the run rewrote the user edit\n'); // run: modified what the user already modified
    rmSync(join(info.path, 'src', 'a.ts')); // run: deleted
    write(info.path, '.cache/x', 'cache\n'); // run: ignored, new
    write(info.path, 'ignored.log', 'run noise\n'); // run: ignored, existing

    assert.deepEqual(must(ws.changedSince(info.path, snap)), [
      { path: 'README.md', status: 'modified' },
      { path: 'src/a.ts', status: 'deleted' },
      { path: 'src/b.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
    ]);

    const result = must(ws.discard(info.path, snap));
    assert.deepEqual(result.restored, ['README.md', 'src/a.ts', 'src/b.ts']);
    assert.deepEqual(result.removed, ['src/new.ts']);
    assert.deepEqual(result.ignoredLeft, ['.cache/']);

    assert.equal(read(info.path, 'README.md'), USER_README, 'the user edit survives, not HEAD content');
    assert.equal(read(info.path, 'src/b.ts'), BASE_FILES['src/b.ts']);
    assert.equal(read(info.path, 'src/a.ts'), BASE_FILES['src/a.ts']);
    assert.equal(existsSync(join(info.path, 'src', 'new.ts')), false);
    assert.equal(read(info.path, 'notes.txt'), 'user notes\n', 'a user untracked file is kept');
    assert.equal(read(info.path, '.cache/x'), 'cache\n', 'an ignored file the run made is left');
    assert.equal(read(info.path, 'ignored.log'), 'run noise\n', 'an ignored file is never rewritten');
    assert.equal(must(ws.snapshot(info.path)).tree, snap.tree, 'the tree after discard is the snapshot tree');
    assert.deepEqual(must(ws.changedSince(info.path, snap)), []);
    assert.deepEqual(readFileSync(join(info.path, '.git', 'index')), indexBefore, 'discard never touched the clone index');
    assert.equal(must(ws.head(info.path)), repo.head);
  });

  it('a run-added file named a\\b is read, listed and discarded as that one file and a tracked a/b is untouched (R-IN-04, T-02-103)', () => {
    const repo = scratch({ files: { ...BASE_FILES, 'a/b': 'tracked a/b\n' } });
    const info = prepared(repo, tempDir('avarice-runws-'));
    const snap = must(ws.snapshot(info.path));

    write(info.path, 'a\\b', 'run added backslash file\n');
    assert.equal(must(ws.readText(info.path, 'a\\b', 1024)), 'run added backslash file\n', 'readText reads the backslash file, not a/b');
    assert.equal(must(ws.readText(info.path, 'a/b', 1024)), 'tracked a/b\n');
    assert.deepEqual(must(ws.changedSince(info.path, snap)), [{ path: 'a\\b', status: 'added' }]);

    const result = must(ws.discard(info.path, snap));
    assert.deepEqual(result.removed, ['a\\b']);
    assert.equal(existsSync(join(info.path, 'a\\b')), false, 'the backslash file is gone');
    assert.equal(read(info.path, 'a/b'), 'tracked a/b\n', 'the tracked a/b keeps its content');
    assert.deepEqual(must(ws.changedSince(info.path, snap)), []);
  });

  it('discard with nothing changed is a no-op success, and a second discard after a first lists no paths and leaves the same tree', () => {
    const repo = scratch();
    const info = userDirtyClone(repo);
    const snap = must(ws.snapshot(info.path));
    const before = treeDigest(info.path);

    assert.deepEqual(must(ws.discard(info.path, snap)), { restored: [], removed: [], ignoredLeft: [] });
    assert.equal(treeDigest(info.path), before);

    write(info.path, 'src/b.ts', 'export const b = 7;\n');
    write(info.path, 'src/new.ts', 'x\n');
    const first = must(ws.discard(info.path, snap));
    assert.deepEqual(first.restored, ['src/b.ts']);
    assert.deepEqual(first.removed, ['src/new.ts']);
    const afterFirst = treeDigest(info.path);
    assert.equal(afterFirst, before);
    assert.deepEqual(must(ws.discard(info.path, snap)), { restored: [], removed: [], ignoredLeft: [] });
    assert.equal(treeDigest(info.path), afterFirst);
  });

  it('discard when HEAD moved is a head-moved conflict and changes nothing', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const snap = must(ws.snapshot(info.path));
    write(info.path, 'src/b.ts', 'export const b = 8;\n');
    must(ws.commit(info.path, { paths: ['src/b.ts'], message: 'avarice: moved' }));
    write(info.path, 'src/a.ts', 'export const a = 8;\n');
    write(info.path, 'src/extra.ts', 'extra\n');
    const before = treeDigest(info.path);

    const conflict = mustFail(ws.discard(info.path, snap));
    assert.equal(conflict.kind, 'conflict');
    assert.match(String(conflict['expected']), /head-moved/);
    assert.equal(treeDigest(info.path), before, 'nothing was touched');
  });

  it('a directory replaced by a file and a file replaced by a directory are both put back', () => {
    const repo = scratch({ files: { ...BASE_FILES, 'docs/guide.md': '# guide\n', 'docs/more/deep.md': 'deep\n', slot: 'a file\n' } });
    const info = prepared(repo, tempDir('avarice-runws-'));
    const snap = must(ws.snapshot(info.path));

    rmSync(join(info.path, 'docs'), { recursive: true });
    write(info.path, 'docs', 'now a file\n');
    rmSync(join(info.path, 'slot'));
    write(info.path, 'slot/inner.txt', 'inner\n');

    const result = must(ws.discard(info.path, snap));
    assert.deepEqual(result.removed, ['docs', 'slot/inner.txt']);
    assert.deepEqual(result.restored, ['docs/guide.md', 'docs/more/deep.md', 'slot']);
    assert.equal(read(info.path, 'docs/guide.md'), '# guide\n');
    assert.equal(read(info.path, 'docs/more/deep.md'), 'deep\n');
    assert.equal(read(info.path, 'slot'), 'a file\n');
    assert.equal(must(ws.snapshot(info.path)).tree, snap.tree);
  });

  it('a symlink the run planted is removed as a link and never followed: the target outside the clone is untouched', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const outside = tempDir('avarice-runws-outside-');
    writeFileSync(join(outside, 'a.ts'), 'outside a\n');
    writeFileSync(join(outside, 'b.ts'), 'outside b\n');
    writeFileSync(join(outside, 'precious.txt'), 'precious\n');
    const snap = must(ws.snapshot(info.path));

    rmSync(join(info.path, 'src'), { recursive: true });
    symlinkSync(outside, join(info.path, 'src')); // src is now a link to a directory outside the clone
    symlinkSync(join(outside, 'precious.txt'), join(info.path, 'link-out'));

    const result = must(ws.discard(info.path, snap));
    assert.deepEqual(result.removed, ['link-out', 'src']);
    assert.deepEqual(result.restored, ['src/a.ts', 'src/b.ts']);
    assert.equal(lstatSync(join(info.path, 'src')).isSymbolicLink(), false);
    assert.equal(read(info.path, 'src/a.ts'), BASE_FILES['src/a.ts']);
    assert.equal(readFileSync(join(outside, 'a.ts'), 'utf8'), 'outside a\n', 'nothing was written through the link');
    assert.equal(readFileSync(join(outside, 'precious.txt'), 'utf8'), 'precious\n');
    assert.deepEqual(readdirNames(outside), ['a.ts', 'b.ts', 'precious.txt']);
    assert.equal(must(ws.snapshot(info.path)).tree, snap.tree);
  });

  it('a filter and hooks of the clone do not run during snapshot or discard', () => {
    const repo = scratch();
    const info = userDirtyClone(repo);
    const marks = tempDir('avarice-runws-marks-');
    git(info.path, ['config', 'filter.spy.clean', `touch "${join(marks, 'clean')}"; cat`]);
    git(info.path, ['config', 'filter.spy.smudge', `touch "${join(marks, 'smudge')}"; cat`]);
    writeFileSync(join(info.path, '.git', 'info', 'attributes'), '*.ts filter=spy\n');
    for (const hook of ['post-checkout', 'post-merge', 'reference-transaction']) {
      writeExecutable(join(info.path, '.git', 'hooks', hook), `#!/bin/sh\ntouch "${join(marks, hook)}"\n`);
    }
    const snap = must(ws.snapshot(info.path));
    write(info.path, 'src/b.ts', 'export const b = 5;\n');
    must(ws.discard(info.path, snap));
    assert.deepEqual(readdirNames(marks), []);
    assert.equal(read(info.path, 'src/b.ts'), BASE_FILES['src/b.ts']);
  });
});

describe('restorePaths, removeUntracked and diffCommits (plan 02-13; D-17, the artifacts the supervisor keeps off the review branch)', () => {
  it('restorePaths puts tracked paths back to HEAD, refuses an untracked path and changes nothing then', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 99;\n');
    write(info.path, 'README.md', 'edited\n');
    assert.deepEqual(must(ws.restorePaths(info.path, ['src/a.ts'])), ['src/a.ts']);
    assert.equal(readFileSync(join(info.path, 'src/a.ts'), 'utf8'), BASE_FILES['src/a.ts']);
    assert.equal(readFileSync(join(info.path, 'README.md'), 'utf8'), 'edited\n', 'a path that was not named is not touched');

    write(info.path, 'fresh.txt', 'new\n');
    const error = mustFail(ws.restorePaths(info.path, ['README.md', 'fresh.txt']));
    assert.equal(error.kind, 'conflict');
    assert.equal(readFileSync(join(info.path, 'README.md'), 'utf8'), 'edited\n', 'nothing was restored');
  });

  it('restorePaths refuses an absolute path, a parent reference, a .git segment, an option and an empty list', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    for (const bad of ['/etc/passwd', '../x', '.git/config', '-n', '']) {
      mustFail(ws.restorePaths(info.path, [bad]));
    }
    assert.equal(mustFail(ws.restorePaths(info.path, [])).kind, 'invalid');
  });

  it('removeUntracked deletes the files and the directories they leave empty, keeps a directory with anything else in it, and refuses a tracked path', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, '.planning/quick/q1/q1-PLAN.md', 'plan\n');
    write(info.path, '.planning/quick/q1/q1-SUMMARY.md', 'summary\n');
    write(info.path, '.planning/quick/q2/other.md', 'other\n');
    assert.deepEqual(must(ws.removeUntracked(info.path, ['.planning/quick/q1/q1-PLAN.md', '.planning/quick/q1/q1-SUMMARY.md'])), ['.planning/quick/q1/q1-PLAN.md', '.planning/quick/q1/q1-SUMMARY.md']);
    assert.equal(existsSync(join(info.path, '.planning/quick/q1')), false, 'the emptied directory is gone');
    assert.equal(existsSync(join(info.path, '.planning/quick/q2/other.md')), true, 'a sibling directory is kept');
    assert.equal(existsSync(join(info.path, '.planning/quick')), true, 'a directory that still holds something is kept');
    const error = mustFail(ws.removeUntracked(info.path, ['src/a.ts']));
    assert.equal(error.kind, 'conflict');
    assert.equal(existsSync(join(info.path, 'src/a.ts')), true);
  });

  it('removeUntracked removes a symlink as a link and never follows it', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    const outside = tempDir('avarice-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'keep\n');
    symlinkSync(join(outside, 'secret.txt'), join(info.path, 'link.txt'));
    assert.deepEqual(must(ws.removeUntracked(info.path, ['link.txt'])), ['link.txt']);
    assert.equal(existsSync(join(outside, 'secret.txt')), true, 'the target outside the clone is untouched');
  });

  it('diffCommits lists the paths that differ between two commits and refuses anything that is not a full SHA', () => {
    const repo = scratch();
    const info = prepared(repo, tempDir('avarice-runws-'));
    write(info.path, 'src/a.ts', 'export const a = 2;\n');
    write(info.path, 'src/c.ts', 'export const c = 3;\n');
    const commit = must(ws.commit(info.path, { paths: ['src/a.ts', 'src/c.ts'], message: 'change' }));
    assert.deepEqual(must(ws.diffCommits(info.path, repo.head, commit)), [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/c.ts', status: 'added' },
    ]);
    assert.equal(mustFail(ws.diffCommits(info.path, 'HEAD', commit)).kind, 'invalid');
    assert.equal(mustFail(ws.diffCommits(info.path, repo.head, '--output=x')).kind, 'invalid');
  });
});
