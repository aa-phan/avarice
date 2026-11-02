// Forward-only, checksummed migrations (NFR-9; research Pattern 2). Each pending migration, its
// schema_migrations row and the meta.schema_version update commit in one transaction, so a failed
// migration leaves the previous schema intact. A recorded checksum that differs from the shipped
// migration, or a recorded version this build does not know, refuses the store.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { sha256Hex } from '../../domain/digest.ts';
import { tx } from './db.ts';
import type { Db } from './db.ts';

export interface Migration {
  version: number;
  sql: string;
}

export interface MigrateOptions {
  nowMs?: number;
  profileId?: string;
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
        return err({ kind: 'conflict', expected: `migration ${version} checksum ${expected}`, actual: `recorded checksum ${checksum}` });
      }
    }
    return ok(sorted.filter((m) => !applied.has(m.version)));
  } catch (e) {
    return err({ kind: 'internal', cause: e instanceof Error ? e.message : String(e) });
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

  const nowIso = new Date(options.nowMs ?? Date.now()).toISOString();
  const result = tx(db, () => {
    for (const m of pending.value) {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)').run(m.version, nowIso, sha256Hex(m.sql));
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version));
    }
    if (options.profileId !== undefined) {
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('profile_id', ?)").run(options.profileId);
    }
  });
  if (!result.ok) return result;
  const last = pending.value[pending.value.length - 1];
  return ok({ from, to: last ? last.version : from, applied: pending.value.map((m) => m.version) });
}
