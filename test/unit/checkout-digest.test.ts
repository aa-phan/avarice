// Plan 01-19 Task 1: the exit-run tooling. checkout-digest compares a checkout before and after; assert-exit judges the
// SC1 record fields from a ledger; exit-run.sh --dry-run checks every precondition without spending. Scratch
// repositories, temp ledgers and a fake claude only: nothing here touches a real repository or a model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { makeScratchRepo, git, writeExecutable } from '../helpers/scratch-repo.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';

const DIGEST = join(REPO_ROOT, 'scripts', 'checkout-digest.ts');
const ASSERT_EXIT = join(REPO_ROOT, 'scripts', 'assert-exit.ts');
const EXIT_RUN = join(REPO_ROOT, 'scripts', 'exit-run.sh');
const SECRET = 'CHECKOUT-DIGEST-SECRET-5c0e19aa7d';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

interface Digest {
  head: string;
  branch: string;
  statusDigest: string;
  filesDigest: string;
  refsDigest: string;
  worktreesDigest: string;
}

function digestOf(repo: string, ...extra: string[]): { code: number | null; stdout: string; stderr: string; json: Digest } {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', DIGEST, repo, ...extra], { encoding: 'utf8' });
  let json = {} as Digest;
  try {
    json = JSON.parse(r.stdout) as Digest;
  } catch {
    // the assertions on code and keys report it
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function scratch(options: Parameters<typeof makeScratchRepo>[0] = {}) {
  const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n', 'src/a.ts': 'export const a = 1;\n' }, untracked: { '.env': `KEY=${SECRET}\n` }, ...options });
  cleanups.push(repo.dispose);
  return repo;
}

describe('scripts/checkout-digest.ts', () => {
  it('prints the five keys and is stable across two runs', () => {
    const repo = scratch();
    const one = digestOf(repo.path);
    const two = digestOf(repo.path);
    assert.equal(one.code, 0, one.stderr);
    for (const key of ['head', 'branch', 'statusDigest', 'filesDigest', 'refsDigest'] as const) assert.equal(typeof one.json[key], 'string', key);
    assert.equal(one.json.head, repo.head);
    assert.equal(one.json.branch, 'main');
    assert.match(one.json.filesDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(two.json, one.json);
  });

  it('changes when a tracked file, an untracked file or the index changes, and only the matching parts', () => {
    const repo = scratch();
    const base = digestOf(repo.path).json;

    writeFileSync(join(repo.path, 'src', 'a.ts'), 'export const a = 2;\n');
    const tracked = digestOf(repo.path).json;
    assert.notEqual(tracked.filesDigest, base.filesDigest, 'a tracked edit changes the files digest');
    assert.notEqual(tracked.statusDigest, base.statusDigest, 'a tracked edit changes the status digest');
    assert.equal(tracked.refsDigest, base.refsDigest);

    git(repo.path, ['checkout', '--', 'src/a.ts']);
    assert.deepEqual(digestOf(repo.path).json, base, 'restoring the file restores every digest');

    writeFileSync(join(repo.path, 'notes.txt'), 'new\n');
    const untracked = digestOf(repo.path).json;
    assert.notEqual(untracked.filesDigest, base.filesDigest, 'an untracked file changes the files digest');
    assert.notEqual(untracked.statusDigest, base.statusDigest);
    rmSync(join(repo.path, 'notes.txt'));

    writeFileSync(join(repo.path, '.env'), 'KEY=other\n');
    assert.notEqual(digestOf(repo.path).json.filesDigest, base.filesDigest, 'an edit of the untracked .env is seen');
    writeFileSync(join(repo.path, '.env'), `KEY=${SECRET}\n`);
    assert.deepEqual(digestOf(repo.path).json, base);

    writeFileSync(join(repo.path, 'src', 'a.ts'), 'export const a = 3;\n');
    const unstaged = digestOf(repo.path).json;
    git(repo.path, ['add', 'src/a.ts']);
    const staged = digestOf(repo.path).json;
    assert.equal(staged.filesDigest, unstaged.filesDigest, 'staging does not change a byte of a file');
    assert.notEqual(staged.statusDigest, unstaged.statusDigest, 'staging changes the index, so the status digest');
  });

  it('is changed by a new branch ref, unless --allow-ref names it', () => {
    const repo = scratch();
    const plain = digestOf(repo.path).json;
    const allowed = digestOf(repo.path, '--allow-ref', 'refs/heads/avarice/onboard-*').json;
    git(repo.path, ['branch', 'avarice/onboard-onb_x']);

    const after = digestOf(repo.path).json;
    assert.notEqual(after.refsDigest, plain.refsDigest, 'a new ref changes the refs digest');
    assert.equal(digestOf(repo.path, '--allow-ref', 'refs/heads/avarice/onboard-*').json.refsDigest, allowed.refsDigest, 'the allowed ref is left out');
    assert.equal(digestOf(repo.path, '--allow-ref=refs/heads/avarice/onboard-*').json.refsDigest, allowed.refsDigest, 'the --allow-ref=glob form works');
    assert.equal(after.filesDigest, plain.filesDigest);
    assert.equal(after.head, plain.head);

    git(repo.path, ['branch', 'feature/other']);
    assert.notEqual(digestOf(repo.path, '--allow-ref', 'refs/heads/avarice/onboard-*').json.refsDigest, allowed.refsDigest, 'a ref the glob does not match still counts');
  });

  it('never prints file contents', () => {
    const repo = scratch();
    const r = digestOf(repo.path);
    assert.equal(r.stdout.includes(SECRET), false);
    assert.equal(r.stderr.includes(SECRET), false);
    assert.equal(r.stdout.includes('export const a'), false);
  });

  it('does not refresh the index or add a lock to the checkout', () => {
    const repo = scratch();
    const before = digestOf(repo.path).json;
    assert.equal(existsSync(join(repo.path, '.git', 'index.lock')), false);
    assert.deepEqual(digestOf(repo.path).json, before);
  });

  it('exits 2 on a missing argument, an unknown option and a path that is not a repository', () => {
    const none = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', DIGEST], { encoding: 'utf8' });
    assert.equal(none.status, 2);
    assert.match(none.stderr, /usage/);
    const bad = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', DIGEST, '--nope', tmpdir()], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    const dir = mkdtempSync(join(tmpdir(), 'avarice-not-a-repo-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(digestOf(dir).code, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// assert-exit
// ---------------------------------------------------------------------------------------------------------------

const REV = 'a'.repeat(40);

interface Fixture {
  state?: string;
  promotion?: string;
  nodes?: Record<string, number>;
  documentNodes?: number | null;
  documentsExpected?: number | null;
  unread?: number | null;
  builtAtCommit?: string;
  refreshedAtCommit?: string;
  onboardedRevision?: string;
  noIntel?: boolean;
  noGraph?: boolean;
  noRecord?: boolean;
}

function ledgerWith(f: Fixture = {}): { db: string; onboardingId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-assert-exit-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db');
  const opened = openDb(path);
  assert.ok(opened.ok);
  assert.ok(migrate(opened.value, [MIGRATION_0001]).ok);
  const db = opened.value;
  const now = '2026-11-03T12:00:00.000Z';
  db.prepare('INSERT INTO projects (project_id, root_commit, repo_path, created_at) VALUES (?, ?, ?, ?)').run('prj_1', REV, '/repo/aa-phan-portfolio-v2', now);
  db.prepare('INSERT INTO onboardings (onboarding_id, project_id, state, version, preflight_json, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(
    'onb_1',
    'prj_1',
    f.state ?? 'active',
    '{}',
    now,
    now,
  );
  if (f.noRecord !== true) {
    const indexes: Record<string, unknown> = {};
    if (f.noGraph !== true) {
      const documentNodes = f.documentNodes ?? 3;
      const knowledge =
        f.documentNodes === null
          ? undefined
          : {
              documentNodes,
              ...(f.documentsExpected === null ? {} : { documentsExpected: f.documentsExpected ?? 3 }),
              dropped: { dangling: 0, astDocument: 0, ...(f.unread === null ? {} : { unread: f.unread ?? 0 }) },
            };
      indexes['graph'] = { builtAtCommit: f.builtAtCommit ?? `git:${REV}`, nodes: f.nodes ?? { code: 12, document: 3 }, edges: { EXTRACTED: 4 }, ...(knowledge !== undefined ? { knowledge } : {}) };
    }
    if (f.noIntel !== true) indexes['intel'] = { refreshedAtCommit: f.refreshedAtCommit ?? `git:${REV}`, files: 5 };
    const body = { promotion: f.promotion ?? 'none', revisions: { onboardedAt: `git:${REV}`, active: `git:${REV}` }, indexes };
    db.prepare(
      `INSERT INTO project_records (project_id, version, state, body_json, digest, gsd_version, onboarded_revision, created_at, activated_at)
       VALUES (?, 1, 'active', ?, 'sha256:x', '1.17.0', ?, ?, ?)`,
    ).run('prj_1', JSON.stringify(body), f.onboardedRevision ?? `git:${REV}`, now, now);
  }
  db.close();
  return { db: path, onboardingId: 'onb_1' };
}

function assertExit(f: Fixture): { code: number | null; stdout: string; stderr: string } {
  const { db, onboardingId } = ledgerWith(f);
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ASSERT_EXIT, '--db', db, onboardingId], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('scripts/assert-exit.ts', () => {
  it('prints a JSON summary and exits 0 for an active record with code and document nodes at the onboarded revision', () => {
    const r = assertExit({});
    assert.equal(r.code, 0, r.stderr);
    const summary = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(summary['ok'], true);
    assert.equal(summary['state'], 'active');
    assert.equal(summary['promotion'], 'none');
    assert.equal(summary['onboardedRevision'], REV);
    assert.deepEqual(summary['nodes'], { code: 12, document: 3 });
    assert.equal(summary['documentNodes'], 3);
    assert.equal(summary['documentsExpected'], 3);
    assert.equal(summary['unreadDocuments'], 0);
    assert.equal(summary['graphBuiltAtCommit'], REV);
    assert.equal(summary['intelRefreshedAtCommit'], REV);
  });

  const failures: Array<[string, Fixture, RegExp]> = [
    ['the onboarding is not active', { state: 'blocked' }, /state is blocked, not active/],
    ['there is no active record', { noRecord: true }, /no active project record/],
    ['promotion is not none', { promotion: 'branch' }, /promotion is branch, not none/],
    ['the graph has zero code nodes', { nodes: { code: 0, document: 3 } }, /no code nodes/],
    ['the graph has zero document nodes', { nodes: { code: 12, document: 0 }, documentNodes: 0 }, /no document nodes/],
    ['the knowledge section counts no document nodes', { documentNodes: 0 }, /no document nodes/],
    ['the graph is absent', { noGraph: true }, /no graph index/],
    ['the graph was built at another commit', { builtAtCommit: `git:${'b'.repeat(40)}` }, /graph builtAtCommit .* is not the onboarded revision/],
    ['the intel index was refreshed at another commit', { refreshedAtCommit: `git:${'c'.repeat(40)}` }, /intel refreshedAtCommit .* is not the onboarded revision/],
    ['the intel index is absent', { noIntel: true }, /no intel index/],
  ];
  for (const [name, fixture, message] of failures) {
    it(`exits 1 when ${name}`, () => {
      const r = assertExit(fixture);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stderr, message);
    });
  }

  it('fails a run that left corpus documents unread (UAT 154, plan 01-26)', () => {
    const r = assertExit({ documentNodes: 9, documentsExpected: 25, unread: 16 });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /16 of 25 corpus documents have no document node/);
    const summary = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(summary['documentsExpected'], 25);
    assert.equal(summary['unreadDocuments'], 16);
  });

  for (const [name, fixture] of [
    ['documentsExpected is absent', { documentsExpected: null }],
    ['dropped.unread is absent', { unread: null }],
    ['both are absent', { documentsExpected: null, unread: null }],
  ] as Array<[string, Fixture]>) {
    it(`fails a knowledge section without per-document accounting when ${name} (plan 01-26)`, () => {
      const r = assertExit(fixture);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /no per-document accounting/);
      assert.doesNotMatch(r.stderr, /corpus documents have no document node/);
    });
  }

  it('reports only the no-document-nodes problem for a record with no knowledge section (plan 01-26)', () => {
    const r = assertExit({ documentNodes: null, nodes: { code: 12, document: 3 } });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no document nodes/);
    assert.doesNotMatch(r.stderr, /per-document accounting/);
    const summary = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.equal(summary['documentsExpected'], null);
    assert.equal(summary['unreadDocuments'], null);
  });

  it('compares revisions without the git: prefix, so either spelling of the same commit passes', () => {
    const r = assertExit({ onboardedRevision: REV, builtAtCommit: REV, refreshedAtCommit: `git:${REV}` });
    assert.equal(r.code, 0, r.stderr);
  });

  it('exits 2 for an unknown onboarding ID and for a missing argument', () => {
    const { db } = ledgerWith({});
    const unknown = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ASSERT_EXIT, '--db', db, 'onb_nope'], { encoding: 'utf8' });
    assert.equal(unknown.status, 2);
    const none = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ASSERT_EXIT, '--db', db], { encoding: 'utf8' });
    assert.equal(none.status, 2);
  });

  it('opens the ledger read-only', () => {
    const { db, onboardingId } = ledgerWith({});
    const before = spawnSync('cksum', [db], { encoding: 'utf8' }).stdout;
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ASSERT_EXIT, '--db', db, onboardingId], { encoding: 'utf8' });
    assert.equal(spawnSync('cksum', [db], { encoding: 'utf8' }).stdout, before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// exit-run.sh --dry-run
// ---------------------------------------------------------------------------------------------------------------

function fakeClaude(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-fake-claude-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  // The launch line is never run by a dry run; only `--version` is.
  return writeExecutable(join(dir, 'claude'), `#!/bin/sh\necho "${version} (Claude Code)"\n`);
}

function dryRun(args: string[], env: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string; data: string } {
  const base = mkdtempSync(join(tmpdir(), 'avarice-dry-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const r = spawnSync('bash', [EXIT_RUN, '--dry-run', ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
      AVARICE_CONFIG_HOME: join(base, 'config'),
      AVARICE_DATA_ROOT: join(base, 'data'),
      AVARICE_WORK_ROOT: join(base, 'work'),
      ...env,
    },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, data: join(base, 'data') };
}

describe('scripts/exit-run.sh --dry-run', () => {
  it('prints "dry run ok" for a repository whose only change is the known untracked .env, and writes nothing', () => {
    const repo = scratch();
    const r = dryRun(['--target', repo.path], { AVARICE_CLAUDE_BIN: fakeClaude('2.1.316') });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /dry run ok/);
    assert.equal(existsSync(join(r.data, 'state.db')), false, 'a dry run opens no ledger, so it can record no invocation');
    assert.equal(existsSync(r.data), false, 'a dry run creates no profile directory');
  });

  it('refuses a claude version that is not admitted', () => {
    const repo = scratch();
    const r = dryRun(['--target', repo.path], { AVARICE_CLAUDE_BIN: fakeClaude('2.1.999') });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout + r.stderr, /claude 2\.1\.999 is not an admitted version/);
    assert.doesNotMatch(r.stdout, /dry run ok/);
  });

  it('refuses a target with a modified tracked file, naming the path and not the content', () => {
    const repo = scratch({ modified: { 'src/a.ts': `export const a = '${SECRET}';\n` } });
    const r = dryRun(['--target', repo.path], { AVARICE_CLAUDE_BIN: fakeClaude('2.1.316') });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout + r.stderr, /src\/a\.ts/);
    assert.equal((r.stdout + r.stderr).includes(SECRET), false);
    assert.doesNotMatch(r.stdout, /dry run ok/);
  });

  it('refuses an unknown untracked file unless it is named in EXIT_RUN_KNOWN_UNTRACKED', () => {
    const repo = scratch({ untracked: { '.env': 'K=1\n', 'stray.txt': 'x\n' } });
    const claude = fakeClaude('2.1.316');
    const refused = dryRun(['--target', repo.path], { AVARICE_CLAUDE_BIN: claude });
    assert.notEqual(refused.code, 0);
    assert.match(refused.stdout + refused.stderr, /stray\.txt/);
    const allowed = dryRun(['--target', repo.path], { AVARICE_CLAUDE_BIN: claude, EXIT_RUN_KNOWN_UNTRACKED: 'stray.txt' });
    assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
  });

  it('needs exactly one of --rehearsal and --target, and refuses a target that is not a git repository', () => {
    const both = dryRun([]);
    assert.notEqual(both.code, 0);
    assert.match(both.stdout + both.stderr, /usage/);
    const dir = mkdtempSync(join(tmpdir(), 'avarice-not-a-repo-'));
    mkdirSync(dir, { recursive: true });
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const r = dryRun(['--target', dir], { AVARICE_CLAUDE_BIN: fakeClaude('2.1.316') });
    assert.notEqual(r.code, 0);
  });

  it('contains the kill and the resume steps of the exit run', () => {
    const text = spawnSync('cat', [EXIT_RUN], { encoding: 'utf8' }).stdout;
    assert.match(text, /kill -9/);
    assert.match(text, /resume/);
  });
});
