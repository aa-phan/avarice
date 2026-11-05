// RunSource adapter (plan 02-07; D-04, D-16, RC-2): conventions and staleness from git objects alone, on scratch repositories.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { GitRunSource } from '../../src/adapters/git/run-source.ts';
import type { Result } from '../../src/domain/result.ts';
import { git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

const CONFIG = '.avarice/config.json';
const BASE_FILES = { 'README.md': '# scratch\n', 'src/a.ts': 'export const a = 1;\n' };
const source = new GitRunSource();

function scratch(files: Record<string, string> = BASE_FILES): ScratchRepo {
  const repo = makeScratchRepo({ files });
  cleanups.push(repo.dispose);
  return repo;
}

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function mustFail<T>(result: Result<T>): { kind: string; [key: string]: unknown } {
  assert.equal(result.ok, false, 'expected an error result');
  return (result as { ok: false; error: { kind: string } }).error;
}

// A commit with a chosen committer date, so an age can be asserted exactly.
function commitAt(repo: ScratchRepo, files: Record<string, string>, iso = '2026-03-01T00:00:00Z'): string {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  execFileSync('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'c'], {
    cwd: repo.path,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
  return git(repo.path, ['rev-parse', 'HEAD']).trim();
}

const conventions = (repo: ScratchRepo, pin: string, head: string): Result<{ revision: string; text: string }> => source.conventionsAt(repo.path, pin, head);

describe('GitRunSource.conventionsAt (D-16)', () => {
  it('HEAD is the pin and the pin has the file: the pin and its text', () => {
    const repo = scratch({ ...BASE_FILES, [CONFIG]: '{"commands":{"test":"npm test"}}\n' });
    assert.deepEqual(must(conventions(repo, repo.head, repo.head)), { revision: repo.head, text: '{"commands":{"test":"npm test"}}\n' });
    assert.equal(must(source.head(repo.path)), repo.head);
  });

  it('the pin has no file and HEAD is one commit that adds only .avarice/config.json: HEAD and its text', () => {
    const repo = scratch();
    const pin = repo.head;
    const head = commitAt(repo, { [CONFIG]: '{"v":1}\n' });
    assert.deepEqual(must(conventions(repo, pin, head)), { revision: head, text: '{"v":1}\n' });
  });

  it('a commit touching src/ between the pin and the config commit makes the config commit unusable: not_found', () => {
    const repo = scratch();
    const pin = repo.head;
    commitAt(repo, { 'src/x.ts': 'export const x = 1;\n' });
    const head = commitAt(repo, { [CONFIG]: '{"v":1}\n' });
    assert.equal(mustFail(conventions(repo, pin, head)).kind, 'not_found');
  });

  it('config commit, then two commits touching src/: the config commit, and staleness counts the two with the age of the first', () => {
    const repo = scratch();
    const pin = repo.head;
    const configCommit = commitAt(repo, { [CONFIG]: '{"v":2}\n', '.avarice/notes.md': 'notes\n' }, '2026-01-05T00:00:00Z');
    commitAt(repo, { 'src/x.ts': 'export const x = 1;\n' }, '2026-01-10T00:00:00Z');
    const head = commitAt(repo, { 'src/y.ts': 'export const y = 1;\n' }, '2026-02-01T00:00:00Z');

    assert.deepEqual(must(conventions(repo, pin, head)), { revision: configCommit, text: '{"v":2}\n' });
    assert.deepEqual(must(source.staleness(repo.path, pin, head)), { descendant: true, commitsOutside: 2, oldestOutsideCommittedAtMs: Date.parse('2026-01-10T00:00:00Z') });
  });

  it('a later commit that edits the config and src/ together is skipped for the earlier config-only commit', () => {
    const repo = scratch();
    const pin = repo.head;
    const first = commitAt(repo, { [CONFIG]: '{"v":1}\n' });
    const head = commitAt(repo, { [CONFIG]: '{"v":2}\n', 'src/a.ts': 'export const a = 2;\n' });
    assert.deepEqual(must(conventions(repo, pin, head)), { revision: first, text: '{"v":1}\n' });
  });

  it('of two usable config commits the newest wins', () => {
    const repo = scratch();
    const pin = repo.head;
    commitAt(repo, { [CONFIG]: '{"v":1}\n' });
    const second = commitAt(repo, { [CONFIG]: '{"v":2}\n' });
    const head = commitAt(repo, { '.avarice/other.json': '{}\n' });
    assert.deepEqual(must(conventions(repo, pin, head)), { revision: head, text: '{"v":2}\n' }, 'a later .avarice-only commit still carries the file');
    assert.notEqual(head, second);
  });

  it('a HEAD that does not descend from the pin is a conflict, and staleness says descendant false', () => {
    const repo = makeScratchRepo({ files: BASE_FILES, commits: [{ 'src/m1.ts': 'export const m = 1;\n' }] });
    cleanups.push(repo.dispose);
    const [root, mainTip] = repo.shas as [string, string];
    git(repo.path, ['checkout', '-q', '-b', 'other', root]);
    const otherTip = commitAt(repo, { 'src/o1.ts': 'export const o = 1;\n' });
    git(repo.path, ['checkout', '-q', 'main']);

    assert.equal(mustFail(conventions(repo, otherTip, mainTip)).kind, 'conflict');
    assert.deepEqual(must(source.staleness(repo.path, otherTip, mainTip)), { descendant: false, commitsOutside: 0, oldestOutsideCommittedAtMs: null });
  });

  it('an uncommitted edit, a deletion or an untracked copy of .avarice/config.json changes nothing (RC-2)', () => {
    const repo = scratch({ ...BASE_FILES, [CONFIG]: '{"committed":true}\n' });
    const committed = { revision: repo.head, text: '{"committed":true}\n' };

    writeFileSync(join(repo.path, CONFIG), '{"edited":"in the working tree"}\n');
    assert.deepEqual(must(conventions(repo, repo.head, repo.head)), committed);
    git(repo.path, ['add', CONFIG]); // staged, still not committed
    assert.deepEqual(must(conventions(repo, repo.head, repo.head)), committed);
    rmSync(join(repo.path, CONFIG));
    assert.deepEqual(must(conventions(repo, repo.head, repo.head)), committed);
  });

  it('a config blob over 256 KiB is invalid; exactly 256 KiB is read', () => {
    const big = scratch({ ...BASE_FILES, [CONFIG]: 'x'.repeat(256 * 1024 + 1) });
    const refused = mustFail(conventions(big, big.head, big.head));
    assert.equal(refused.kind, 'invalid');
    assert.equal(refused['field'], CONFIG);

    const edge = scratch({ ...BASE_FILES, [CONFIG]: 'y'.repeat(256 * 1024) });
    assert.equal(must(conventions(edge, edge.head, edge.head)).text.length, 256 * 1024);
  });

  it('a symbolic link named .avarice/config.json is not a config file: not_found', () => {
    const repo = scratch();
    const pin = repo.head;
    mkdirSync(join(repo.path, '.avarice'), { recursive: true });
    symlinkSync('../README.md', join(repo.path, CONFIG));
    const head = commitAt(repo, {}); // stages the link with everything else
    assert.equal(git(repo.path, ['ls-tree', head, '--', CONFIG]).startsWith('120000 blob'), true, 'the fixture really is a symlink blob');
    assert.equal(mustFail(conventions(repo, pin, head)).kind, 'not_found');
  });

  it('refuses a malformed SHA and reports an unknown commit as not_found', () => {
    const repo = scratch();
    assert.equal(mustFail(conventions(repo, 'abc123', repo.head)).kind, 'invalid');
    assert.equal(mustFail(conventions(repo, repo.head, '--all')).kind, 'invalid');
    assert.equal(mustFail(conventions(repo, 'f'.repeat(40), repo.head)).kind, 'not_found');
    assert.equal(mustFail(conventions(repo, repo.head, 'f'.repeat(40))).kind, 'not_found');
    assert.equal(mustFail(source.staleness(repo.path, 'abc123', repo.head)).kind, 'invalid');
    assert.equal(mustFail(source.staleness(repo.path, 'f'.repeat(40), repo.head)).kind, 'not_found');
  });
});

describe('GitRunSource.staleness (D-04)', () => {
  it('HEAD equal to the pin is zero commits outside and no age', () => {
    const repo = scratch();
    assert.deepEqual(must(source.staleness(repo.path, repo.head, repo.head)), { descendant: true, commitsOutside: 0, oldestOutsideCommittedAtMs: null });
  });

  it('a commit touching only .planning/ or only .avarice/ is not counted; one touching both and src/ is', () => {
    const repo = scratch();
    const pin = repo.head;
    commitAt(repo, { '.planning/STATE.md': '# state\n' }, '2026-01-02T00:00:00Z');
    commitAt(repo, { '.avarice/config.json': '{}\n' }, '2026-01-03T00:00:00Z');
    commitAt(repo, { '.planning/ROADMAP.md': '# roadmap\n', '.avarice/x.json': '{}\n' }, '2026-01-04T00:00:00Z');
    const none = commitAt(repo, { '.planning/PLAN.md': 'p\n' }, '2026-01-05T00:00:00Z');
    assert.deepEqual(must(source.staleness(repo.path, pin, none)), { descendant: true, commitsOutside: 0, oldestOutsideCommittedAtMs: null });

    const mixed = commitAt(repo, { '.planning/STATE.md': '# state 2\n', 'README.md': '# changed\n' }, '2026-01-06T00:00:00Z');
    assert.deepEqual(must(source.staleness(repo.path, pin, mixed)), { descendant: true, commitsOutside: 1, oldestOutsideCommittedAtMs: Date.parse('2026-01-06T00:00:00Z') });
  });

  it('is read from git objects: an uncommitted change to src/ is not a commit', () => {
    const repo = scratch();
    writeFileSync(join(repo.path, 'src', 'a.ts'), 'export const a = 2; // uncommitted\n');
    assert.equal(must(source.staleness(repo.path, repo.head, repo.head)).commitsOutside, 0);
  });
});
