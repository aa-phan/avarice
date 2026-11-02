// Forward-only, checksummed migrations (NFR-9; research Pattern 2). Each pending migration, its
// schema_migrations row and the meta.schema_version update commit in one transaction, so a failed
// migration leaves the previous schema intact and earlier migrations stay applied. A recorded checksum
// that differs from the shipped migration, or a recorded version this build does not know, refuses the
// store. Before the first pending migration is applied to a store that already has history, the store is
// copied with VACUUM INTO; if the copy cannot be written the migration does not run.
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { sha256Hex } from '../../domain/digest.ts';
import { describeError, tx } from './db.ts';
import type { Db } from './db.ts';

export interface Migration {
  version: number;
  sql: string;
}

export interface MigrateOptions {
  nowMs?: number;
  profileId?: string;
  // Where the pre-migration backup goes; default `backups/` beside the database file. An in-memory
  // database has no file to protect and gets no backup.
  backupDir?: string;
}

export interface MigrateOutcome {
  from: number;
  to: number;
  applied: number[];
}

function hasMigrationTable(db: Db): boolean {
  const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as { n: number };
  return row.n > 0;
}

function recorded(db: Db): Map<number, string> {
  const map = new Map<number, string>();
  if (!hasMigrationTable(db)) return map;
  for (const row of db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[]) {
    map.set(Number(row.version), row.checksum);
  }
  return map;
}

// Migrations not yet applied, after checking every applied one. Reads only.
export function pendingMigrations(db: Db, migrations: readonly Migration[]): Result<Migration[]> {
  try {
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    const known = new Map(sorted.map((m) => [m.version, m]));
    const applied = recorded(db);
    for (const [version, checksum] of applied) {
      const shipped = known.get(version);
      if (!shipped) {
        return err({ kind: 'conflict', expected: `a schema version this build ships (up to ${sorted.at(-1)?.version ?? 0})`, actual: `store has migration ${version} from a newer build` });
      }
      const expected = sha256Hex(shipped.sql);
      if (checksum !== expected) {
        return err({
          kind: 'conflict',
          expected: `migration ${version} checksum ${expected}`,
          actual: `store schema v${version} checksum mismatch: refusing to start (recorded ${checksum}; shipped ${expected}). A migration that was applied must never be edited; restore the store from a backup or run the build that wrote it`,
        });
      }
    }
    return ok(sorted.filter((m) => !applied.has(m.version)));
  } catch (e) {
    return err({ kind: 'internal', cause: e instanceof Error ? e.message : String(e) });
  }
}

// Copies the live store to {backupDir}/pre-migration-{ts}.db (VACUUM INTO cannot run inside a transaction).
function backupBeforeMigrating(db: Db, backupDir: string | undefined, nowIso: string): Result<void> {
  try {
    const location = db.location();
    const dir = backupDir ?? (location ? join(dirname(location), 'backups') : undefined);
    if (dir === undefined) return ok(undefined);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = nowIso.replace(/[:.]/g, '-');
    let target = join(dir, `pre-migration-${stamp}.db`);
    for (let n = 1; existsSync(target); n += 1) target = join(dir, `pre-migration-${stamp}-${n}.db`);
    db.prepare('VACUUM INTO ?').run(target);
    chmodSync(target, 0o600);
    return ok(undefined);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot write the pre-migration backup, so no migration was applied: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export function migrate(db: Db, migrations: readonly Migration[], options: MigrateOptions = {}): Result<MigrateOutcome> {
  const pending = pendingMigrations(db, migrations);
  if (!pending.ok) return pending;
  const applied = recorded(db);
  const from = applied.size === 0 ? 0 : Math.max(...applied.keys());
  let expectedNext = from + 1;
  for (const m of pending.value) {
    if (m.version !== expectedNext) {
      return err({ kind: 'invalid', field: 'migrations', reason: `migration ${m.version} follows ${expectedNext - 1}; versions must be contiguous` });
    }
    expectedNext += 1;
  }
  if (pending.value.length === 0) return ok({ from, to: from, applied: [] });

  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  if (applied.size > 0) {
    const backedUp = backupBeforeMigrating(db, options.backupDir, nowIso);
    if (!backedUp.ok) return backedUp;
  }

  for (const [index, m] of pending.value.entries()) {
    const lastOne = index === pending.value.length - 1;
    const result = tx(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)').run(m.version, nowIso, sha256Hex(m.sql));
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version));
      if (lastOne && options.profileId !== undefined) {
        db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('profile_id', ?)").run(options.profileId);
      }
    });
    if (!result.ok) {
      // A busy store is retryable; anything else is a migration that failed and was rolled back.
      if (result.error.kind === 'unavailable') return result;
      return err({ kind: 'internal', cause: `migration ${m.version} failed and was rolled back: ${describeError(result.error)}` });
    }
  }
  const last = pending.value[pending.value.length - 1];
  return ok({ from, to: last ? last.version : from, applied: pending.value.map((m) => m.version) });
}
