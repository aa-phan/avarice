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
import { LocalArtifactStore } from '../adapters/fs/artifact-store.ts';
import { createStagingWorkspace, STAGING_STRATEGY } from '../adapters/git/staging-strategy.ts';
import { UnavailableAgentHost } from '../adapters/host/unavailable-host.ts';
import { digestOf } from '../domain/digest.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { AppDeps, Clock, IdSource } from '../app/deps.ts';

export const MIGRATIONS: readonly Migration[] = [MIGRATION_0001];
export const EXIT_INTERNAL = 70;

export interface DepsOverrides {
  clock?: Clock;
  ids?: IdSource;
  // Replaces the production host. Only test entry points pass this; bin/avarice.ts never does, so the
  // production path always runs the fail-closed UnavailableAgentHost until plan 01-15 admits a real host.
  host?: AgentHost;
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
  const resolved = resolveProfile(env);
  if (!resolved.ok) return failure('cannot prepare the profile directories', describeError(resolved.error));
  const profile = resolved.value;
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
  const host = overrides.host ?? new UnavailableAgentHost();
  if (options.readOnly !== true) {
    // Record which host this profile ran with, so a later reader sees the enforcement level it had.
    const recorded = ledger.upsertAdapterConfig({
      name: host.descriptor.port,
      port: host.descriptor.port,
      adapter: host.descriptor.adapter,
      configDigest: digestOf(host.descriptor),
      descriptor: host.descriptor,
    });
    if (!recorded.ok) {
      store.close();
      return failure('cannot record the host adapter', describeError(recorded.error));
    }
  }
  const staging = createStagingWorkspace(STAGING_STRATEGY);
  const artifacts = new LocalArtifactStore(profile.dataRoot);
  return {
    ok: true,
    value: {
      deps: { ledger, host, staging, artifacts, clock, ids, profile },
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
