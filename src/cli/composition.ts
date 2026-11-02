// Composition root: resolves the profile, opens and migrates the ledger, builds the dependencies.
// A refusal or failure here is returned as { ok: false, code, message }; main prints the message to
// stderr and exits with the code. Plans after 01-03 add their adapters and refusals in this file.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../domain/ids.ts';
import type { IdPrefix } from '../domain/ids.ts';
import { describeError, openDb } from '../adapters/sqlite/db.ts';
import type { Db } from '../adapters/sqlite/db.ts';
import { migrate, pendingMigrations } from '../adapters/sqlite/migrate.ts';
import type { Migration } from '../adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../adapters/sqlite/migrations/0001-initial.ts';
import { SqliteLedger } from '../adapters/sqlite/ledger.ts';
import { resolveProfile } from '../adapters/fs/profile-paths.ts';
import type { AppDeps, Clock, IdSource } from '../app/deps.ts';

export const MIGRATIONS: readonly Migration[] = [MIGRATION_0001];
export const EXIT_INTERNAL = 70;

export interface DepsOverrides {
  clock?: Clock;
  ids?: IdSource;
}

export interface CreateDepsOptions {
  // Open the store read-only (after making sure it is migrated). Used by status.
  readOnly?: boolean;
}

export interface Composition {
  deps: AppDeps;
  close(): void;
}

export type CompositionResult = { ok: true; value: Composition } | { ok: false; code: number; message: string };

function failure(what: string, message: string): CompositionResult {
  return { ok: false, code: EXIT_INTERNAL, message: `avarice: ${what}: ${message}` };
}

export function systemClock(): Clock {
  return { nowMs: () => Date.now() };
}

export function systemIds(clock: Clock): IdSource {
  return { next: (prefix: IdPrefix) => newId(prefix, clock.nowMs(), randomBytes(10)) };
}

export function createDeps(env: NodeJS.ProcessEnv, overrides: DepsOverrides = {}, options: CreateDepsOptions = {}): CompositionResult {
  let profile;
  try {
    profile = resolveProfile(env);
  } catch (e) {
    return failure('cannot prepare the profile directories', e instanceof Error ? e.message : String(e));
  }
  const dbPath = join(profile.dataRoot, 'state.db');
  const clock = overrides.clock ?? systemClock();
  const ids = overrides.ids ?? systemIds(clock);

  let db: Db | undefined;
  if (options.readOnly === true && existsSync(dbPath)) {
    const opened = openDb(dbPath, { readOnly: true });
    if (!opened.ok) return failure(`cannot open ${dbPath}`, describeError(opened.error));
    const pending = pendingMigrations(opened.value, MIGRATIONS);
    if (!pending.ok) {
      opened.value.close();
      return failure(`cannot use ${dbPath}`, describeError(pending.error));
    }
    if (pending.value.length === 0) db = opened.value;
    else opened.value.close();
  }
  if (db === undefined) {
    const opened = openDb(dbPath);
    if (!opened.ok) return failure(`cannot open ${dbPath}`, describeError(opened.error));
    const migrated = migrate(opened.value, MIGRATIONS, { profileId: profile.profile, nowMs: clock.nowMs() });
    if (!migrated.ok) {
      opened.value.close();
      return failure(`cannot migrate ${dbPath}`, describeError(migrated.error));
    }
    db = opened.value;
    if (options.readOnly === true) {
      db.close();
      const reopened = openDb(dbPath, { readOnly: true });
      if (!reopened.ok) return failure(`cannot open ${dbPath}`, describeError(reopened.error));
      db = reopened.value;
    }
  }
  const store = db;
  const ledger = new SqliteLedger(store, (prefix) => ids.next(prefix));
  return {
    ok: true,
    value: {
      deps: { ledger, clock, ids, profile },
      close: () => {
        try {
          store.close();
        } catch {
          // already closed
        }
      },
    },
  };
}
