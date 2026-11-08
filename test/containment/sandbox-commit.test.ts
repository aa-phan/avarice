// Plan 02-18 Task 1, spike S2-D (host limitation 8): which writes under a run clone's `.git` does `git commit` need when
// it runs inside AVARICE's own Seatbelt sandbox, and does a commit with only the object store and the run ref writable
// fail? No model is involved. The result is documentation only: per D-03 the supervisor commits outside the invocation, and
// no agent gets any of these paths. The set below is what the spike measured, asserted exactly: the commit passes with it,
// and fails when any one entry is removed (so nothing in it is spare).
//
// This drives AVARICE's SandboxedExecutor, not Claude Code's sandbox. Both use Seatbelt on macOS, but the host also treats
// `.git` as a protected path, which this test does not exercise (see the record in spikes/phase-2-wave-0/S2-D-sandbox-commit.md).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import type { CommandResult } from '../../src/ports/command-executor.ts';
import { spec, TEST_PATH } from '../helpers/sandbox.ts';

const SANDBOX_AVAILABLE = existsSync('/usr/bin/sandbox-exec');
const GIT = '/usr/bin/git';
const BRANCH = 'avarice/run_s2d';
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The minimal write set, relative to the clone's `.git`. Each entry is a file or a directory the commit touches:
//   objects                      the new blob, tree and commit objects
//   refs/heads/avarice           the run ref and its `.lock` file
//   logs/HEAD, logs/refs/heads/avarice   the reflogs `core.logAllRefUpdates` writes in a non-bare clone
//   index, index.lock            the index is rewritten through a lock file and renamed over
//   COMMIT_EDITMSG               the message file `git commit` writes before it creates the commit
//   HEAD.lock                    HEAD is locked while its reflog entry is written (HEAD itself is not rewritten)
const MINIMAL_GIT_WRITE_SET: readonly string[] = [
  'objects',
  'refs/heads/avarice',
  'logs/HEAD',
  'logs/refs/heads/avarice',
  'index',
  'index.lock',
  'COMMIT_EDITMSG',
  'HEAD.lock',
];

// The set of the plan's first attempt: the object store and the run ref only.
const OBJECTS_AND_REF: readonly string[] = ['objects', 'refs/heads/avarice'];

interface Clone {
  path: string;
  git: string;
}

function gitEnv(home: string): Record<string, string> {
  return {
    PATH: TEST_PATH,
    HOME: home,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'AVARICE',
    GIT_AUTHOR_EMAIL: 'avarice@localhost.invalid',
    GIT_COMMITTER_NAME: 'AVARICE',
    GIT_COMMITTER_EMAIL: 'avarice@localhost.invalid',
  };
}

// A clone on the run branch with one staged change: the state the supervisor commits from (it stages outside the sandbox).
function makeClone(): { clone: Clone; base: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-s2d-')));
  cleanup.push(base);
  const path = join(base, 'clone');
  mkdirSync(path);
  const git = (...args: string[]): string => execFileSync(GIT, args, { cwd: path, encoding: 'utf8', env: gitEnv(base) });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(path, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '--no-verify', '-m', 'base');
  git('checkout', '-q', '-b', BRANCH);
  writeFileSync(join(path, 'a.txt'), 'two\n');
  git('add', 'a.txt');
  return { clone: { path, git: join(path, '.git') }, base };
}

function headOf(clone: Clone, base: string, ref = 'HEAD'): string {
  return execFileSync(GIT, ['rev-parse', ref], { cwd: clone.path, encoding: 'utf8', env: gitEnv(base) }).trim();
}

async function sandboxedCommit(clone: Clone, base: string, relativeWrites: readonly string[]): Promise<CommandResult> {
  const result = await new SandboxedExecutor().run(
    spec(clone.path, [GIT, 'commit', '--no-verify', '--no-gpg-sign', '-q', '-m', 'in-sandbox commit'], {
      env: gitEnv(base),
      writePaths: relativeWrites.map((entry) => join(clone.git, entry)),
    }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

describe('S2-D: git commit inside the Seatbelt sandbox (host limitation 8)', { skip: !SANDBOX_AVAILABLE }, () => {
  it('fails with only the object store and the run ref writable: the index lock is refused', async () => {
    const { clone, base } = makeClone();
    const before = headOf(clone, base);
    const result = await sandboxedCommit(clone, base, OBJECTS_AND_REF);
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 128);
    assert.match(result.stderr, /Unable to create '.*\.git\/index\.lock': Operation not permitted/);
    assert.equal(headOf(clone, base), before, 'the run ref did not move');
  });

  it('succeeds with exactly the minimal set, and moves only the run ref', async () => {
    const { clone, base } = makeClone();
    const mainBefore = headOf(clone, base, 'main');
    const before = headOf(clone, base);
    const result = await sandboxedCommit(clone, base, MINIMAL_GIT_WRITE_SET);
    assert.equal(result.status, 'passed', result.stderr);
    const after = headOf(clone, base);
    assert.notEqual(after, before, 'the run ref moved');
    assert.equal(headOf(clone, base, 'main'), mainBefore, 'no other ref moved');
    assert.equal(execFileSync(GIT, ['show', 'HEAD:a.txt'], { cwd: clone.path, encoding: 'utf8', env: gitEnv(base) }), 'two\n');
    assert.equal(execFileSync(GIT, ['log', '-1', '--format=%s'], { cwd: clone.path, encoding: 'utf8', env: gitEnv(base) }).trim(), 'in-sandbox commit');
  });

  for (const dropped of MINIMAL_GIT_WRITE_SET) {
    it(`fails without ${dropped}: no entry of the minimal set is spare`, async () => {
      const { clone, base } = makeClone();
      const before = headOf(clone, base);
      const result = await sandboxedCommit(clone, base, MINIMAL_GIT_WRITE_SET.filter((entry) => entry !== dropped));
      assert.equal(result.status, 'failed', `a commit without ${dropped} must fail, got ${result.status}`);
      // git words the refusal by the file it could not write; without `index` it reports the rename of the new index.
      assert.match(result.stderr, /Operation not permitted|unable to write new_index file/);
      assert.equal(headOf(clone, base), before, 'the run ref did not move');
    });
  }

  it('leaves hooks, config and every other ref unwritable under the minimal set', async () => {
    const { clone, base } = makeClone();
    const writes = MINIMAL_GIT_WRITE_SET.map((entry) => join(clone.git, entry));
    const attempts: Array<{ target: string; label: string }> = [
      { target: join(clone.git, 'hooks', 'post-commit'), label: 'a hook' },
      { target: join(clone.git, 'config'), label: 'the repository config' },
      { target: join(clone.git, 'refs', 'heads', 'main'), label: 'another branch ref' },
      { target: join(clone.git, 'refs', 'heads', 'planted'), label: 'a new branch ref outside avarice/' },
      { target: join(clone.git, 'info', 'exclude'), label: 'info/exclude' },
    ];
    for (const attempt of attempts) {
      const before = existsSync(attempt.target) ? readFileSync(attempt.target, 'utf8') : null;
      const result = await new SandboxedExecutor().run(spec(clone.path, ['/bin/sh', '-c', 'echo hostile >> "$1"', 'sh', attempt.target], { env: gitEnv(base), writePaths: writes }));
      assert.ok(result.ok);
      assert.equal(result.value.status, 'failed', `${attempt.label} must not be writable`);
      const after = existsSync(attempt.target) ? readFileSync(attempt.target, 'utf8') : null;
      assert.equal(after, before, `${attempt.label} is unchanged`);
    }
  });

  it('stages in the sandbox with a subset: `git add` needs only the object store, index and index.lock', async () => {
    const { clone, base } = makeClone();
    writeFileSync(join(clone.path, 'b.txt'), 'new\n');
    const writes = ['objects', 'index', 'index.lock'].map((entry) => join(clone.git, entry));
    const result = await new SandboxedExecutor().run(spec(clone.path, [GIT, 'add', 'b.txt'], { env: gitEnv(base), writePaths: writes }));
    assert.ok(result.ok);
    assert.equal(result.value.status, 'passed', result.value.stderr);
    assert.match(execFileSync(GIT, ['diff', '--cached', '--name-only'], { cwd: clone.path, encoding: 'utf8', env: gitEnv(base) }), /b\.txt/);
  });
});
