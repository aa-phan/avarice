// Migration safety (NFR-9; docs/operations-and-testing.md "Backup, restore, migration and uninstall"; research
// Pattern 2): a checksum that differs from the shipped migration refuses the store, a failing migration leaves
// the previous schema intact, a pending migration is preceded by a VACUUM INTO backup, and the committed v1
// fixture database keeps working. Every case copies the fixture to a temp dir; the committed file is never opened
// read-write.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describeError, openDb } from '../../src/adapters/sqlite/db.ts';
import type { Db } from '../../src/adapters/sqlite/db.ts';
import { migrate, pendingMigrations } from '../../src/adapters/sqlite/migrate.ts';
import type { Migration } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { MIGRATION_0004 } from '../../src/adapters/sqlite/migrations/0004-profiles.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'db', 'schema-v1.sqlite');
const TABLES = ['projects', 'onboardings', 'checkpoints', 'events', 'contracts', 'project_records', 'artifacts', 'onboarding_steps', 'schema_migrations', 'adapter_configs', 'meta'] as const;
// What the committed fixture recorded for migration 0001 when it was generated. Migration 0001 is never edited (NFR-9).
const V1_CHECKSUM = '56c469d8a0cfb0c661908b75cf745c02892e3512d6fe0f6a5305132479f5e2cf';
const SHIPPED: readonly Migration[] = [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003, MIGRATION_0004];
// The list a version 3 build shipped: the v2 to v3 cases stay about what 0003 does.
const V3_SHIPPED: readonly Migration[] = [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003];
// The list a version 2 build shipped: the v1 to v2 cases stay about what 0002 does.
const V2_SHIPPED: readonly Migration[] = [MIGRATION_0001, MIGRATION_0002];
const V1_ONLY: readonly Migration[] = [MIGRATION_0001];
// Tables whose row count the upgrade must not change, plus the three that 0002 adds (empty after it).
const V1_RUN_TABLES = ['runs', 'attempts', 'evidence', 'gate_results', 'decisions', 'work_items', 'budgets'] as const;
const NEW_TABLES = ['run_steps', 'hook_reads', 'check_validations'] as const;
const NEW_RUNS_COLUMNS = ['reason', 'workspace_path', 'branch', 'base_revision'] as const;
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

  it('still migrates as a no-op when only migration 0001 is shipped, and writes no backup', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const before = counts(db);
      const namesBefore = schemaNames(db);
      const backupDir = join(dir, 'backups');
      const pending = pendingMigrations(db, V1_ONLY);
      assert.ok(pending.ok);
      assert.deepEqual(pending.value, []);
      const migrated = migrate(db, V1_ONLY, { nowMs: NOW, backupDir });
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

  it('records migration 0001 under the checksum of the text that shipped (0001 is never edited)', () => {
    const raw = new DatabaseSync(FIXTURE, { readOnly: true });
    try {
      const row = raw.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get() as { checksum: string };
      assert.equal(row.checksum, V1_CHECKSUM);
    } finally {
      raw.close();
    }
    assert.equal(sha256Hex(MIGRATION_0001.sql), V1_CHECKSUM);
  });

  it('migrates to version 2: backup written first, every v1 row count kept, four runs columns and three tables added (NFR-9)', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const before = counts(db);
      const runTablesBefore = Object.fromEntries(V1_RUN_TABLES.map((t) => [t, Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)]));
      const backupDir = join(dir, 'backups');
      const pending = pendingMigrations(db, V2_SHIPPED);
      assert.ok(pending.ok);
      assert.deepEqual(pending.value.map((m) => m.version), [2]);
      const migrated = migrate(db, V2_SHIPPED, { nowMs: NOW, backupDir });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual(migrated.value, { from: 1, to: 2, applied: [2] });

      const backups = readdirSync(backupDir);
      assert.equal(backups.length, 1, 'a pre-migration backup was written');
      assert.match(backups[0] as string, /^pre-migration-.+\.db$/);
      const backup = new DatabaseSync(join(backupDir, backups[0] as string), { readOnly: true });
      try {
        assert.deepEqual(counts(backup), before, 'the backup is the v1 store');
        assert.ok(!schemaNames(backup).includes('table:run_steps'), 'taken before 0002 ran');
      } finally {
        backup.close();
      }

      assert.deepEqual({ ...counts(db), schema_migrations: before['schema_migrations'] }, before, 'no v1 row changed or vanished');
      assert.equal(counts(db)['schema_migrations'], 2);
      for (const table of V1_RUN_TABLES) {
        assert.equal(Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n), runTablesBefore[table], table);
      }
      const names = schemaNames(db);
      for (const table of NEW_TABLES) {
        assert.ok(names.includes(`table:${table}`), table);
        assert.equal(Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n), 0, `${table} starts empty`);
      }
      assert.ok(names.includes('index:evidence_attempt'));
      assert.ok(names.includes('index:events_run'));
      for (const trigger of ['evidence_no_update', 'evidence_no_delete', 'gate_results_no_update', 'gate_results_no_delete']) {
        assert.ok(names.includes(`trigger:${trigger}`), trigger);
      }
      const columns = (db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>).map((c) => c.name);
      for (const column of NEW_RUNS_COLUMNS) assert.ok(columns.includes(column), `runs.${column}`);
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '2' });
      assert.equal(
        (db.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get() as { checksum: string }).checksum,
        V1_CHECKSUM,
        'the 0001 row is untouched',
      );
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('migrates a version 2 store to version 3: backup written first, every row kept, the new columns NULL, notifications empty (NFR-9)', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      assert.ok(migrate(db, V2_SHIPPED, { nowMs: NOW, backupDir: join(dir, 'backups-v1') }).ok);
      db.exec(`
        INSERT INTO projects (project_id, root_commit, repo_path, remote, default_branch, created_at) VALUES ('proj_v2', 'rootv2', '/repo/v2', NULL, 'main', '2026-06-01T12:00:00.000Z');
        INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_v2', 'proj_v2', 'running', 2, 'a v2 run', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');
        INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_v2', 'run_v2', 1, 'first', '2026-06-01T12:00:00.000Z');
        INSERT INTO decisions (decision_id, run_id, contract_version, class, issue, options_json, consequences_json, evidence_refs_json, affected_items_json, state_digest, urgency, state, opened_at)
          VALUES ('dec_v2', 'run_v2', 1, 'acceptance', 'q', '[]', '{}', '[]', '["A"]', 'd', 'blocking', 'open', '2026-06-01T12:00:00.000Z');
      `);
      const before = counts(db);
      const runTablesBefore = Object.fromEntries(['runs', 'attempts', 'decisions'].map((t) => [t, Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)]));
      const backupDir = join(dir, 'backups');
      const pending = pendingMigrations(db, V3_SHIPPED);
      assert.ok(pending.ok);
      assert.deepEqual(pending.value.map((m) => m.version), [3]);
      const migrated = migrate(db, V3_SHIPPED, { nowMs: NOW + 1000, backupDir });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual(migrated.value, { from: 2, to: 3, applied: [3] });
      const backups = readdirSync(backupDir);
      assert.equal(backups.length, 1, 'a pre-migration backup was written');
      const backup = new DatabaseSync(join(backupDir, backups[0] as string), { readOnly: true });
      try {
        assert.deepEqual(counts(backup), before, 'the backup is the version 2 store');
        assert.ok(!schemaNames(backup).includes('table:notifications'), 'taken before 0003 ran');
      } finally {
        backup.close();
      }
      assert.deepEqual({ ...counts(db), schema_migrations: before['schema_migrations'] }, before, 'no row changed or vanished');
      assert.equal(counts(db)['schema_migrations'], 3);
      for (const table of ['runs', 'attempts', 'decisions'] as const) {
        assert.equal(Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n), runTablesBefore[table], `${table} rows kept`);
      }
      assert.ok(schemaNames(db).includes('table:notifications'));
      assert.ok(schemaNames(db).includes('index:attempts_item'));
      assert.ok(schemaNames(db).includes('index:notifications_state'));
      assert.equal(Number((db.prepare('SELECT count(*) AS n FROM notifications').get() as { n: number }).n), 0);
      assert.deepEqual({ ...(db.prepare("SELECT item_id FROM attempts WHERE attempt_id = 'att_v2'").get() as object) }, { item_id: null });
      assert.deepEqual({ ...(db.prepare("SELECT supersedes FROM decisions WHERE decision_id = 'dec_v2'").get() as object) }, { supersedes: null });
      assert.deepEqual({ ...(db.prepare("SELECT cancel_requested_at, cancel_requested_by FROM runs WHERE run_id = 'run_v2'").get() as object) }, { cancel_requested_at: null, cancel_requested_by: null });
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '3' });
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('is a no-op once migrated: a second migrate applies nothing and writes no second backup', () => {
    const { dir, path } = fixtureCopy();
    const db = open(path);
    try {
      const backupDir = join(dir, 'backups');
      assert.ok(migrate(db, SHIPPED, { nowMs: NOW, backupDir }).ok);
      const again = migrate(db, SHIPPED, { nowMs: NOW + 1000, backupDir });
      assert.ok(again.ok);
      assert.deepEqual(again.value, { from: 4, to: 4, applied: [] });
      assert.equal(readdirSync(backupDir).length, 1);
    } finally {
      db.close();
    }
  });

  it('creates a fresh store at version 4 in one run and writes no backup (nothing to protect)', () => {
    const dir = scratchDir();
    const db = open(join(dir, 'state.db'));
    try {
      const backupDir = join(dir, 'backups');
      const migrated = migrate(db, SHIPPED, { nowMs: NOW, backupDir });
      assert.ok(migrated.ok);
      assert.deepEqual(migrated.value, { from: 0, to: 4, applied: [1, 2, 3, 4] });
      assert.equal(existsSync(backupDir), false);
    } finally {
      db.close();
    }
  });

  it('refuses a store whose migration 0002 is recorded under a different checksum, naming version 2', () => {
    const { path } = fixtureCopy();
    const db = open(path);
    try {
      assert.ok(migrate(db, SHIPPED, { nowMs: NOW }).ok);
      db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 2").run('e'.repeat(64));
      const result = migrate(db, SHIPPED, { nowMs: NOW + 1000 });
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'conflict');
      const message = describeError(result.error);
      assert.match(message, /store schema v2 checksum mismatch: refusing to start/);
      assert.ok(message.includes('e'.repeat(64)));
      assert.ok(message.includes(sha256Hex(MIGRATION_0002.sql)));
    } finally {
      db.close();
    }
  });

  it('is applied by `status` to a v1 store: the CLI path upgrades it to version 4 and keeps the v1 rows', () => {
    const roots = rootsWithStore(fixtureCopy().path);
    const r = runCli(['status', '--json'], { roots });
    assert.equal(r.code, 0, r.stderr);
    const raw = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      assert.deepEqual({ ...(raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '4' });
      assert.equal(readdirSync(join(roots.AVARICE_DATA_ROOT, 'backups')).length, 1);
    } finally {
      raw.close();
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

const HISTORY_ROWS = `
  INSERT INTO projects (project_id, root_commit, repo_path, remote, default_branch, created_at) VALUES ('proj_v3', 'rootv3', '/repo/v3', NULL, 'main', '2026-06-01T12:00:00.000Z');
  INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_v3', 'proj_v3', 'running', 2, 'a v3 run', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');
  INSERT INTO decisions (decision_id, run_id, contract_version, class, issue, options_json, consequences_json, evidence_refs_json, affected_items_json, state_digest, urgency, state, opened_at)
    VALUES ('dec_v3', 'run_v3', 1, 'acceptance', 'q', '[]', '{}', '[]', '["A"]', 'd', 'blocking', 'open', '2026-06-01T12:00:00.000Z');
  INSERT INTO gate_results (run_id, gate, work_item, contract_version, policy_revision, revision, passed, failures_json, created_at) VALUES ('run_v3', 'G1', NULL, 1, 'p', 'r', 1, '[]', '2026-06-01T12:00:00.000Z');
  INSERT INTO notifications (notification_id, run_id, kind, destination, subject_ids_json, state, created_at, updated_at) VALUES ('ntf_v3', 'run_v3', 'decisions', 'local', '[]', 'pending', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z');
  INSERT INTO approvals (approval_id, run_id, action, params_digest, idempotency_key, source, granted_by, granted_at, expires_at) VALUES ('apr_v3', 'run_v3', 'git.push', 'digest-1', 'key-1', 'local-user', 'owner', '2026-06-01T12:00:00.000Z', '2026-06-01T13:00:00.000Z');
`;

// A store at version 3 as a version 3 build left it: the history fixture migrated to 3 and given rows in the tables 0004 touches.
function version3Store(): { dir: string; path: string; db: Db } {
  const { dir, path } = fixtureCopy();
  const db = open(path);
  assert.ok(migrate(db, V3_SHIPPED, { nowMs: NOW, backupDir: join(dir, 'backups-v3') }).ok);
  db.exec(HISTORY_ROWS);
  return { dir, path, db };
}

describe('migration 0004: profile scoping, status indexes and approval guards (D-18, FR-12)', () => {
  it('migrates a version 3 store to version 4: backup first, every row kept, the version and checksum recorded', () => {
    const { dir, db } = version3Store();
    try {
      const before = counts(db);
      const extra = Object.fromEntries(['runs', 'decisions', 'gate_results', 'notifications', 'approvals'].map((t) => [t, Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)]));
      const backupDir = join(dir, 'backups');
      const pending = pendingMigrations(db, SHIPPED);
      assert.ok(pending.ok);
      assert.deepEqual(pending.value.map((m) => m.version), [4]);
      const migrated = migrate(db, SHIPPED, { nowMs: NOW + 2000, backupDir });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual(migrated.value, { from: 3, to: 4, applied: [4] });

      const backups = readdirSync(backupDir);
      assert.equal(backups.length, 1, 'a pre-migration backup was written');
      assert.match(backups[0] as string, /^pre-migration-.+\.db$/);
      const backup = new DatabaseSync(join(backupDir, backups[0] as string), { readOnly: true });
      try {
        assert.deepEqual(counts(backup), before, 'the backup is the version 3 store');
        assert.ok(!schemaNames(backup).includes('index:decisions_run'), 'taken before 0004 ran');
      } finally {
        backup.close();
      }

      assert.deepEqual({ ...counts(db), schema_migrations: before['schema_migrations'] }, before, 'no row changed or vanished');
      assert.equal(counts(db)['schema_migrations'], 4);
      for (const table of Object.keys(extra)) {
        assert.equal(Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n), extra[table], `${table} rows kept`);
      }
      assert.deepEqual({ ...(db.prepare("SELECT version, checksum FROM schema_migrations WHERE version = 4").get() as object) }, { version: 4, checksum: sha256Hex(MIGRATION_0004.sql) });
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '4' });
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'profile_id'").get() as object) }, { value: 'personal-local' }, 'the history fixture keeps its profile');
      const names = schemaNames(db);
      for (const index of ['decisions_run', 'gate_results_run', 'notifications_run', 'runs_project', 'approvals_match']) assert.ok(names.includes(`index:${index}`), index);
      for (const trigger of ['approvals_no_delete', 'approvals_update_guard']) assert.ok(names.includes(`trigger:${trigger}`), trigger);
      assert.equal(integrity(db), 'ok');
    } finally {
      db.close();
    }
  });

  it('leaves migrations 0001 to 0003 unedited: their recorded checksums still match', () => {
    const { db } = version3Store();
    try {
      assert.ok(migrate(db, SHIPPED, { nowMs: NOW + 2000 }).ok);
      for (const m of V3_SHIPPED) {
        assert.equal((db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(m.version) as { checksum: string }).checksum, sha256Hex(m.sql), `migration ${m.version}`);
      }
    } finally {
      db.close();
    }
  });

  it('serves the run, project and approval lookups from indexes', () => {
    const { db } = version3Store();
    try {
      assert.ok(migrate(db, SHIPPED, { nowMs: NOW + 2000 }).ok);
      const plan = (sql: string, ...args: string[]): string => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      assert.match(plan('SELECT * FROM decisions WHERE run_id = ?', 'run_v3'), /USING (COVERING )?INDEX decisions_run/);
      assert.match(plan('SELECT * FROM gate_results WHERE run_id = ?', 'run_v3'), /USING (COVERING )?INDEX gate_results_run/);
      assert.match(plan('SELECT * FROM notifications WHERE run_id = ?', 'run_v3'), /USING (COVERING )?INDEX notifications_run/);
      assert.match(plan('SELECT * FROM runs WHERE project_id = ?', 'proj_v3'), /USING (COVERING )?INDEX runs_project/);
      assert.match(plan('SELECT * FROM approvals WHERE run_id = ? AND action = ? AND params_digest = ?', 'run_v3', 'git.push', 'digest-1'), /USING (COVERING )?INDEX approvals_match/);
    } finally {
      db.close();
    }
  });

  it('refuses to delete an approval and to change any column of one except consumed_at and revoked_at, once, from NULL (FR-12)', () => {
    const { db } = version3Store();
    try {
      assert.ok(migrate(db, SHIPPED, { nowMs: NOW + 2000 }).ok);
      const state = (): object => ({ ...(db.prepare("SELECT consumed_at, revoked_at FROM approvals WHERE approval_id = 'apr_v3'").get() as object) });
      assert.throws(() => db.exec("DELETE FROM approvals WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.throws(() => db.exec("UPDATE approvals SET action = 'x' WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.throws(() => db.exec("UPDATE approvals SET expires_at = '2099-01-01T00:00:00.000Z' WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.throws(() => db.exec("UPDATE approvals SET consumed_at = '2026-06-01T12:30:00.000Z', params_digest = 'other' WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.deepEqual(state(), { consumed_at: null, revoked_at: null });

      db.exec("UPDATE approvals SET consumed_at = '2026-06-01T12:30:00.000Z' WHERE approval_id = 'apr_v3'");
      assert.deepEqual(state(), { consumed_at: '2026-06-01T12:30:00.000Z', revoked_at: null });
      assert.throws(() => db.exec("UPDATE approvals SET consumed_at = '2026-06-01T12:45:00.000Z' WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.throws(() => db.exec("UPDATE approvals SET consumed_at = NULL WHERE approval_id = 'apr_v3'"), /approvals/);

      db.exec("UPDATE approvals SET revoked_at = '2026-06-01T12:50:00.000Z' WHERE approval_id = 'apr_v3'");
      assert.throws(() => db.exec("UPDATE approvals SET revoked_at = '2026-06-01T12:55:00.000Z' WHERE approval_id = 'apr_v3'"), /approvals/);
      assert.deepEqual(state(), { consumed_at: '2026-06-01T12:30:00.000Z', revoked_at: '2026-06-01T12:50:00.000Z' });
      db.exec(`INSERT INTO approvals (approval_id, run_id, action, params_digest, idempotency_key, source, granted_by, granted_at, expires_at)
        VALUES ('apr_new', 'run_v3', 'git.push', 'digest-2', 'key-2', 'local-user', 'owner', '2026-06-01T12:00:00.000Z', '2026-06-01T13:00:00.000Z')`);
      assert.equal(Number((db.prepare('SELECT count(*) AS n FROM approvals').get() as { n: number }).n), 2, 'inserting is still allowed');
    } finally {
      db.close();
    }
  });

  it('is atomic when the process is killed inside migration 0004: schema 3 or schema 4, never a mix', () => {
    const { dir, path, db } = version3Store();
    db.close();
    const script = `
      import { openDb } from ${JSON.stringify(new URL('../../src/adapters/sqlite/db.ts', import.meta.url).href)};
      import { migrate } from ${JSON.stringify(new URL('../../src/adapters/sqlite/migrate.ts', import.meta.url).href)};
      import { MIGRATION_0001 } from ${JSON.stringify(new URL('../../src/adapters/sqlite/migrations/0001-initial.ts', import.meta.url).href)};
      import { MIGRATION_0002 } from ${JSON.stringify(new URL('../../src/adapters/sqlite/migrations/0002-run.ts', import.meta.url).href)};
      import { MIGRATION_0003 } from ${JSON.stringify(new URL('../../src/adapters/sqlite/migrations/0003-decisions.ts', import.meta.url).href)};
      import { MIGRATION_0004 } from ${JSON.stringify(new URL('../../src/adapters/sqlite/migrations/0004-profiles.ts', import.meta.url).href)};
      const opened = openDb(process.argv[1]);
      if (!opened.ok) process.exit(3);
      opened.value.function('kill_now', () => { process.kill(process.pid, 'SIGKILL'); return 1; });
      migrate(opened.value, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003, { version: 4, sql: MIGRATION_0004.sql + '\\nSELECT kill_now();' }], { nowMs: 1, backupDir: process.argv[2] });
      process.exit(0);
    `;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', script, path, join(dir, 'backups-kill')], { encoding: 'utf8' });
    assert.equal(killed.signal, 'SIGKILL', `the child was killed inside the migration: ${killed.stderr}`);

    const after = open(path);
    try {
      assert.equal(integrity(after), 'ok');
      const version = Number((after.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value);
      const names = schemaNames(after);
      const recorded = Number((after.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n);
      assert.ok(version === 3 || version === 4, `schema ${version}`);
      assert.equal(recorded, version, 'the recorded migrations match the version');
      assert.equal(names.includes('index:approvals_match'), version === 4, 'the objects of 0004 exist exactly when 0004 is recorded');
      assert.equal(names.includes('trigger:approvals_update_guard'), version === 4);
      const migrated = migrate(after, SHIPPED, { nowMs: NOW + 3000 });
      assert.ok(migrated.ok, migrated.ok ? '' : describeError(migrated.error));
      assert.deepEqual({ ...(after.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '4' });
      assert.ok(schemaNames(after).includes('index:approvals_match'));
    } finally {
      after.close();
    }
  });
});

describe('the store belongs to its profile (D-18, T-04-19)', () => {
  function storeOf(profileId: string): CliRoots {
    const { path } = fixtureCopy();
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'profile_id'").run(profileId);
    raw.close();
    return rootsWithStore(path);
  }

  it('refuses to open a store whose meta.profile_id is another profile, with exit 70 and nothing changed', () => {
    const roots = storeOf('personal-extended');
    const dbPath = join(roots.AVARICE_DATA_ROOT, 'state.db');
    const before = statSync(dbPath).size;
    for (const argv of [['status'], ['status', '--json']]) {
      const r = runCli(argv, { roots });
      assert.equal(r.code, 70, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes(`store at ${dbPath} belongs to profile personal-extended`), r.stderr);
    }
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.deepEqual({ ...(raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '1' }, 'not migrated');
    } finally {
      raw.close();
    }
    assert.equal(statSync(dbPath).size, before);
    assert.equal(existsSync(join(roots.AVARICE_DATA_ROOT, 'backups')), false, 'no backup, no migration');
  });

  it('opens a store that belongs to the selected profile and migrates it to schema 4 with its records intact', () => {
    const roots = storeOf('personal-local');
    const r = runCli(['status', '--json'], { roots });
    assert.equal(r.code, 0, r.stderr);
    const raw = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      assert.deepEqual({ ...(raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '4' });
      assert.deepEqual(counts(raw)['projects'], 1);
      assert.deepEqual(counts(raw)['events'], 11);
    } finally {
      raw.close();
    }
  });
});

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
    raw.prepare("INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (5, '2026-01-01T00:00:00.000Z', ?)").run('a'.repeat(64));
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
      const migrated = migrate(db, V1_ONLY, { nowMs: NOW, backupDir });
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
