// Migration safety (NFR-9; docs/operations-and-testing.md "Backup, restore, migration and uninstall"; research
// Pattern 2): a checksum that differs from the shipped migration refuses the store, a failing migration leaves
// the previous schema intact, a pending migration is preceded by a VACUUM INTO backup, and the committed v1
// fixture database keeps working. Every case copies the fixture to a temp dir; the committed file is never opened
// read-write.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describeError, openDb } from '../../src/adapters/sqlite/db.ts';
import type { Db } from '../../src/adapters/sqlite/db.ts';
import { migrate, pendingMigrations } from '../../src/adapters/sqlite/migrate.ts';
import type { Migration } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'db', 'schema-v1.sqlite');
const TABLES = ['projects', 'onboardings', 'checkpoints', 'events', 'contracts', 'project_records', 'artifacts', 'onboarding_steps', 'schema_migrations', 'adapter_configs', 'meta'] as const;
const SHIPPED: readonly Migration[] = [MIGRATION_0001];
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

const MIGRATION_2_OK: Migration = { version: 2, sql: 'CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);' };
// Creates a table, then fails: the table must not survive.
const MIGRATION_2_FAILS: Migration = { version: 2, sql: 'CREATE TABLE half_made (id INTEGER PRIMARY KEY); INSERT INTO no_such_table VALUES (1);' };

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-mig-'));
  cleanup.push(dir);
  return dir;
}

function fixtureCopy(): { dir: string; path: string } {
  const dir = scratchDir();
  const path = join(dir, 'state.db');
  copyFileSync(FIXTURE, path);
  return { dir, path };
}

function open(path: string): Db {
  const opened = openDb(path);
  assert.ok(opened.ok, opened.ok ? '' : describeError(opened.error));
  return opened.value;
}

function counts(db: Db | DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of TABLES) out[table] = Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  return out;
}

function schemaNames(db: Db | DatabaseSync): string[] {
  return (db.prepare("SELECT type || ':' || name AS n FROM sqlite_master ORDER BY 1").all() as Array<{ n: string }>).map((r) => r.n);
}

function integrity(db: Db | DatabaseSync): string {
  return String((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
}

function tamperedStore(): { dir: string; path: string; recorded: string } {
  const copy = fixtureCopy();
  const recorded = 'f'.repeat(64);
  const raw = new DatabaseSync(copy.path);
  raw.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run(recorded);
  raw.close();
  return { ...copy, recorded };
}

describe('the committed v1 fixture database', () => {
  it('has rows in every table the onboarding writes', () => {
    const raw = new DatabaseSync(FIXTURE, { readOnly: true });
    try {
      const n = counts(raw);
      for (const table of ['projects', 'onboardings', 'checkpoints', 'events', 'contracts', 'project_records'] as const) {
        assert.ok((n[table] ?? 0) > 0, `${table} has rows`);
      }
      assert.equal(n['schema_migrations'], 1);
    } finally {
      raw.close();
    }
  });

  it('opens, migrates as a no-op, writes no backup, and keeps its row counts', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const before = counts(db);
      const namesBefore = schemaNames(db);
      const backupDir = join(dir, 'backups');
      const pending = pendingMigrations(db, SHIPPED);
      assert.ok(pending.ok);
      assert.deepEqual(pending.value, []);
      const migrated = migrate(db, SHIPPED, { nowMs: NOW, backupDir });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual(migrated.value, { from: 1, to: 1, applied: [] });
      assert.deepEqual(counts(db), before);
      assert.deepEqual(schemaNames(db), namesBefore);
      assert.equal(existsSync(backupDir), false, 'nothing pending, so no backup');
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('is read by `status` in a profile whose data root holds it (active record version 1)', () => {
    const roots = rootsWithStore(fixtureCopy().path);
    const r = runCli(['status', '--json'], { roots });
    assert.equal(r.code, 0, r.stderr);
    const [entry] = JSON.parse(r.stdout) as Array<{ state: string; recordVersion: number | null; interrupted?: unknown }>;
    assert.equal(entry?.state, 'active');
    assert.equal(entry?.recordVersion, 1);
    assert.equal(entry?.interrupted, undefined);
  });
});

function rootsWithStore(storePath: string): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true, mode: 0o700 });
  copyFileSync(storePath, join(roots.AVARICE_DATA_ROOT, 'state.db'));
  return roots;
}

describe('checksum refusal', () => {
  it('refuses a store whose recorded checksum differs from the shipped migration, naming the version and both checksums', () => {
    const { path, recorded } = tamperedStore();
    const db = open(path);
    try {
      const shipped = sha256Hex(MIGRATION_0001.sql);
      const result = migrate(db, SHIPPED, { nowMs: NOW });
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'conflict');
      const message = describeError(result.error);
      assert.match(message, /store schema v1 checksum mismatch: refusing to start/);
      assert.ok(message.includes(recorded), `names the recorded checksum: ${message}`);
      assert.ok(message.includes(shipped), `names the shipped checksum: ${message}`);
    } finally {
      db.close();
    }
  });

  it('refuses before changing anything: no backup, no new row', () => {
    const { dir, path } = tamperedStore();
    const db = open(path);
    try {
      const before = counts(db);
      const backupDir = join(dir, 'backups');
      assert.ok(!migrate(db, [MIGRATION_0001, MIGRATION_2_OK], { nowMs: NOW, backupDir }).ok);
      assert.deepEqual(counts(db), before);
      assert.equal(existsSync(backupDir), false);
    } finally {
      db.close();
    }
  });

  it('also refuses when the shipped migration text was edited in place after it was applied', () => {
    const { path } = fixtureCopy();
    const db = open(path);
    try {
      const edited: Migration = { version: 1, sql: MIGRATION_0001.sql + '\n-- edited after release\n' };
      const result = migrate(db, [edited], { nowMs: NOW });
      assert.ok(!result.ok);
      assert.match(describeError(result.error), /store schema v1 checksum mismatch: refusing to start/);
    } finally {
      db.close();
    }
  });

  it('refuses a store written by a newer build (a recorded version this build does not ship)', () => {
    const { path } = fixtureCopy();
    const raw = new DatabaseSync(path);
    raw.prepare("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (2, '2026-01-01T00:00:00.000Z', ?)").run('a'.repeat(64));
    raw.close();
    const db = open(path);
    try {
      const result = migrate(db, SHIPPED, { nowMs: NOW });
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'conflict');
    } finally {
      db.close();
    }
  });

  it('stops `status` and `onboard` at startup with exit 70 and the actionable message', () => {
    const { path, recorded } = tamperedStore();
    for (const argv of [['status'], ['status', '--json'], ['onboard', '--policy', 'onboarding', tmpdir()]]) {
      const r = runCli(argv, { roots: rootsWithStore(path) });
      assert.equal(r.code, 70, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /store schema v1 checksum mismatch: refusing to start/);
      assert.ok(r.stderr.includes(recorded));
    }
  });
});

describe('a migration that throws midway', () => {
  it('leaves the previous schema intact: no partial table, schema_migrations unchanged, integrity ok', () => {
    const { path } = fixtureCopy();
    const db = open(path);
    try {
      const namesBefore = schemaNames(db);
      const before = counts(db);
      const result = migrate(db, [MIGRATION_0001, MIGRATION_2_FAILS], { nowMs: NOW });
      assert.ok(!result.ok, 'the failure is reported');
      assert.deepEqual(schemaNames(db), namesBefore, 'no half_made table survives');
      assert.deepEqual(counts(db), before);
      assert.equal(db.isTransaction, false, 'no transaction is left open');
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '1' });
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('rolls back only the failing migration: an earlier pending migration stays applied, one transaction each', () => {
    const { path } = fixtureCopy();
    const db = open(path);
    try {
      const third: Migration = { version: 3, sql: 'CREATE TABLE partial_three (id INTEGER); SELECT * FROM no_such_table_either;' };
      const result = migrate(db, [MIGRATION_0001, MIGRATION_2_OK, third], { nowMs: NOW });
      assert.ok(!result.ok);
      const names = schemaNames(db);
      assert.ok(names.includes('table:widgets'), 'migration 2 committed on its own');
      assert.ok(!names.includes('table:partial_three'), 'migration 3 rolled back');
      assert.equal(counts(db)['schema_migrations'], 2);
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '2' });
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('keeps a backup taken before the failed attempt', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const backupDir = join(dir, 'backups');
      assert.ok(!migrate(db, [MIGRATION_0001, MIGRATION_2_FAILS], { nowMs: NOW, backupDir }).ok);
      assert.equal(readdirSync(backupDir).length, 1);
    } finally {
      db.close();
    }
  });
});

describe('pre-migration backup', () => {
  it('writes {backupDir}/pre-migration-{ts}.db with VACUUM INTO before applying a pending migration', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const before = counts(db);
      const backupDir = join(dir, 'backups');
      const migrated = migrate(db, [MIGRATION_0001, MIGRATION_2_OK], { nowMs: NOW, backupDir });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual(migrated.value, { from: 1, to: 2, applied: [2] });

      const files = readdirSync(backupDir);
      assert.equal(files.length, 1);
      assert.match(files[0] as string, /^pre-migration-.+\.db$/);
      assert.ok((files[0] as string).includes('2026-06-01'), 'the timestamp comes from the caller clock');
      assert.equal(statSync(join(backupDir, files[0] as string)).mode & 0o777, 0o600);

      // The backup is the store as it was before migration 2, and is itself a healthy database.
      const backup = new DatabaseSync(join(backupDir, files[0] as string), { readOnly: true });
      try {
        assert.deepEqual(counts(backup), before);
        assert.equal(integrity(backup), 'ok');
        assert.ok(!schemaNames(backup).includes('table:widgets'));
      } finally {
        backup.close();
      }
      assert.ok(schemaNames(db).includes('table:widgets'), 'the live store moved on');
    } finally {
      db.close();
    }
  });

  it('defaults the backup directory to backups/ beside the store', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      assert.ok(migrate(db, [MIGRATION_0001, MIGRATION_2_OK], { nowMs: NOW }).ok);
      assert.equal(readdirSync(join(dir, 'backups')).length, 1);
    } finally {
      db.close();
    }
  });

  it('writes no backup for a store that has never been migrated (nothing to protect)', () => {
    const dir = scratchDir();
    const db = open(join(dir, 'state.db'));
    try {
      const backupDir = join(dir, 'backups');
      const migrated = migrate(db, SHIPPED, { nowMs: NOW, backupDir });
      assert.ok(migrated.ok);
      assert.deepEqual(migrated.value, { from: 0, to: 1, applied: [1] });
      assert.equal(existsSync(backupDir), false);
    } finally {
      db.close();
    }
  });

  it('refuses to migrate when the backup cannot be written', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      // A regular file where the backup directory should be.
      const blocker = join(dir, 'not-a-directory');
      copyFileSync(FIXTURE, blocker);
      const before = counts(db);
      const result = migrate(db, [MIGRATION_0001, MIGRATION_2_OK], { nowMs: NOW, backupDir: join(blocker, 'backups') });
      assert.ok(!result.ok);
      assert.deepEqual(counts(db), before);
      assert.ok(!schemaNames(db).includes('table:widgets'), 'no migration without a backup');
    } finally {
      db.close();
    }
  });
});
