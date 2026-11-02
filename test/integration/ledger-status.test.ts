import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeRoots, PRODUCTION_ENTRY, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function freshRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

function rawDb(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
}

describe('status on a fresh profile (tracer)', () => {
  it('exits 0 with an empty project list and migrates the store to schema version 1', () => {
    const roots = freshRoots();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /No projects registered/);
    assert.equal(r.stderr, '');
    const db = rawDb(roots);
    try {
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '1' });
      assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n, 1);
      assert.deepEqual({ ...(db.prepare('PRAGMA journal_mode').get() as object) }, { journal_mode: 'wal' });
    } finally {
      db.close();
    }
  });

  it('prints [] with --json', () => {
    const r = runCli(['status', '--json'], { roots: freshRoots() });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });

  it('creates the data and work roots with mode 0700', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    for (const dir of [roots.AVARICE_DATA_ROOT, roots.AVARICE_WORK_ROOT, roots.AVARICE_CONFIG_HOME]) {
      assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
    }
  });

  it('is repeatable: a second run applies no migration', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    assert.equal(runCli(['status', '--json'], { roots }).stdout.trim(), '[]');
    const db = rawDb(roots);
    try {
      assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n, 1);
    } finally {
      db.close();
    }
  });

  it('runs through the shebang entry as an executable', () => {
    const roots = freshRoots();
    const r = spawnSync(PRODUCTION_ENTRY, ['status', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ...roots, NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });

  const sandbox = '/usr/bin/sandbox-exec';
  it('works with the network denied', { skip: !existsSync(sandbox) }, () => {
    const roots = freshRoots();
    const r = runCli(['status', '--json'], { roots, wrap: [sandbox, '-p', '(version 1)(allow default)(deny network*)'] });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });
});

describe('CLI dispatch', () => {
  it('exits 64 for an unknown command and does not touch the profile', () => {
    const roots = freshRoots();
    const r = runCli(['bogus'], { roots });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /unknown command 'bogus'/);
    assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false);
  });

  it('exits 64 for an allowlisted command whose module is not built yet', () => {
    const r = runCli(['context'], { roots: freshRoots() });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /not available in this build/);
  });

  it('never imports a name outside the allowlist (path traversal)', () => {
    const r = runCli(['../main'], { roots: freshRoots() });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /unknown command/);
  });
});

describe('store failures exit 70 with the reason on stderr', () => {
  it('a file that is not a database', () => {
    const roots = freshRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    writeFileSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), 'this is not a sqlite database, '.repeat(40));
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /cannot open .*state\.db/);
  });

  it('a recorded migration checksum that differs from the shipped one', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
    db.exec("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
    db.close();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /checksum/);
  });

  it('a store written by a newer build', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
    db.exec("INSERT INTO schema_migrations VALUES (2, '2030-01-01T00:00:00.000Z', 'x')");
    db.close();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /newer build/);
  });
});
