// SEC-2 / ADR-009 / D-17: credentials are resolved by reference at the moment of use, from an approved provider, and never persisted.
// The Keychain cases run against a temporary keychain file created and deleted by the test (`security create-keychain`), reached by its
// path; the login keychain and every real item of the owner are never touched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { KeychainProvider } from '../../src/adapters/credential/keychain.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { resolveCredential } from '../../src/app/credentials.ts';
import type { CredentialDeps } from '../../src/app/credentials.ts';
import { MIGRATIONS } from '../../src/cli/composition.ts';

const cleanup: string[] = [];
const closers: Array<() => void> = [];
after(() => {
  for (const close of closers) {
    try {
      close();
    } catch {
      // already closed
    }
  }
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const SERVICE = 'avarice-test-svc';
// 24 characters, built from parts; it matches no secret pattern, so only the seeded literal can redact it.
const VALUE = ['Zq8rT2vX', 'w9LmN4pB', '6yHd1Kjs'].join('');
const KEYCHAIN_PASSWORD = 'avarice-test-keychain-password';

function security(args: readonly string[]): void {
  const ran = spawnSync('/usr/bin/security', [...args], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `security ${args[0]}: ${ran.stderr}`);
}

interface TempKeychain {
  path: string;
  dispose(): void;
}

// A keychain file of its own with one generic password. It is never added to the search list, and dispose() deletes it.
function makeKeychain(dir: string, service: string, value: string): TempKeychain {
  const path = join(dir, 'avarice-test.keychain-db');
  security(['create-keychain', '-p', KEYCHAIN_PASSWORD, path]);
  const dispose = (): void => {
    spawnSync('/usr/bin/security', ['delete-keychain', path], { encoding: 'utf8' });
  };
  try {
    security(['unlock-keychain', '-p', KEYCHAIN_PASSWORD, path]);
    security(['add-generic-password', '-s', service, '-a', 'avarice-test', '-w', value, path]);
  } catch (e) {
    dispose();
    throw e;
  }
  return { path, dispose };
}

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

interface Fixture {
  dataRoot: string;
  ledger: SqliteLedger;
  deps: CredentialDeps;
  dbPath: string;
}

function fixture(providers: CredentialDeps['providers'], profile = 'personal-local'): Fixture {
  const dataRoot = tempDir('avarice-cred-');
  const dbPath = join(dataRoot, 'state.db');
  const opened = openDb(dbPath);
  assert.ok(opened.ok);
  const migrated = migrate(opened.value, MIGRATIONS, { profileId: profile, nowMs: 1_000 });
  assert.ok(migrated.ok);
  closers.push(() => opened.value.close());
  let n = 0;
  const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}_${(n += 1)}`);
  const deps: CredentialDeps = { ledger, clock: { nowMs: () => 2_000 }, profile: { profile }, providers };
  return { dataRoot, ledger, deps, dbPath };
}

interface EventRow {
  seq: number;
  level: string;
  type: string;
  run_id: string | null;
  invocation_id: string | null;
  data_json: string;
}

function credentialEvents(fx: Fixture): EventRow[] {
  const db = new DatabaseSync(fx.dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT seq, level, type, run_id, invocation_id, data_json FROM events WHERE type = 'credential.resolve' ORDER BY seq").all() as unknown as EventRow[];
  } finally {
    db.close();
  }
}

function allFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { recursive: true }).map(String)) {
    const full = join(root, entry);
    if (statSync(full).isFile()) out.push(full);
  }
  return out;
}

// Every byte under the data root (the database, its journal, every artifact file) holds none of the value.
function assertNoValueAnywhere(root: string, value: string): void {
  for (const file of allFiles(root)) {
    assert.ok(!readFileSync(file).includes(value), `${file} holds the credential value`);
  }
}

function assertValueFree(rows: readonly EventRow[], value: string): void {
  const sha = createHash('sha256').update(value).digest('hex');
  for (const row of rows) {
    assert.ok(!row.data_json.includes(value), row.data_json);
    assert.ok(!row.data_json.includes(sha), 'the event holds a digest of the value');
    const data = JSON.parse(row.data_json) as Record<string, unknown>;
    for (const key of Object.keys(data)) assert.ok(!/len|size|digest|hash|sha/i.test(key), `the event has a key ${key} that could hold a length or digest`);
    for (const v of Object.values(data)) assert.notEqual(v, value.length, 'the event holds the length of the value');
  }
}

describe('tracer: a keychain reference resolves through the broker, records a value-free event and seeds the redactor (SEC-2, S-48)', () => {
  it('resolves keychain:<service> from a temporary keychain and hands the value over only inside use()', async () => {
    const kc = makeKeychain(tempDir('avarice-kc-'), SERVICE, VALUE);
    try {
      const fx = fixture({ keychain: new KeychainProvider({ keychainPath: kc.path }) });
      const result = await resolveCredential(fx.deps, `keychain:${SERVICE}`, 'test', { module: 'test' });
      assert.ok(result.ok, JSON.stringify(result));
      const handle = result.value;
      assert.equal(handle.use((v) => v), VALUE);
      assert.equal(handle.use((v) => v.length), VALUE.length);
      // No property, string or JSON form of the handle holds the value.
      for (const form of [JSON.stringify(handle), String(handle), inspect(handle, { showHidden: true, depth: 5 }), JSON.stringify(Object.getOwnPropertyNames(handle)), `${handle.toJSON()}`]) {
        assert.ok(!form.includes(VALUE), form);
      }
      for (const key of Object.getOwnPropertyNames(handle)) assert.notEqual((handle as unknown as Record<string, unknown>)[key], VALUE, key);
    } finally {
      kc.dispose();
    }
  });

  it('records one credential.resolve event with the reference, purpose, module, profile, outcome and a duration, and nothing derived from the value', async () => {
    const kc = makeKeychain(tempDir('avarice-kc-'), SERVICE, VALUE);
    try {
      const fx = fixture({ keychain: new KeychainProvider({ keychainPath: kc.path }) });
      const result = await resolveCredential(fx.deps, `keychain:${SERVICE}`, 'test', { module: 'test' });
      assert.ok(result.ok);
      const rows = credentialEvents(fx);
      assert.equal(rows.length, 1);
      const data = JSON.parse((rows[0] as EventRow).data_json) as Record<string, unknown>;
      assert.equal(data['reference'], `keychain:${SERVICE}`);
      assert.equal(data['purpose'], 'test');
      assert.equal(data['module'], 'test');
      assert.equal(data['profile'], 'personal-local');
      assert.equal(data['outcome'], 'resolved');
      assert.equal(typeof data['durationMs'], 'number');
      assert.deepEqual(Object.keys(data).sort(), ['durationMs', 'module', 'outcome', 'profile', 'purpose', 'reference']);
      assertValueFree(rows, VALUE);
      // The database, its journal and every artifact file under the data root hold none of the value either.
      assertNoValueAnywhere(fx.dataRoot, VALUE);
    } finally {
      kc.dispose();
    }
  });

  it('seeds the process redactor before the caller receives the handle: an event carrying the value is stored [REDACTED:seeded]', async () => {
    const kc = makeKeychain(tempDir('avarice-kc-'), SERVICE, VALUE);
    try {
      const fx = fixture({ keychain: new KeychainProvider({ keychainPath: kc.path }) });
      const result = await resolveCredential(fx.deps, `keychain:${SERVICE}`, 'test', { module: 'test' });
      assert.ok(result.ok);
      const appended = fx.ledger.appendEvent({ type: 'tracer.probe', data: { note: `the value was ${VALUE} here` }, nowMs: 3_000 });
      assert.ok(appended.ok);
      const db = new DatabaseSync(fx.dbPath, { readOnly: true });
      try {
        const row = db.prepare("SELECT data_json FROM events WHERE type = 'tracer.probe'").get() as { data_json: string };
        assert.ok(row.data_json.includes('[REDACTED:seeded]'), row.data_json);
        assert.ok(!row.data_json.includes(VALUE));
      } finally {
        db.close();
      }
    } finally {
      kc.dispose();
    }
  });

  it('gives outcome unavailable and an unavailable error for a service the keychain does not hold, and the event still has no value', async () => {
    const kc = makeKeychain(tempDir('avarice-kc-'), SERVICE, VALUE);
    try {
      const fx = fixture({ keychain: new KeychainProvider({ keychainPath: kc.path }) });
      const result = await resolveCredential(fx.deps, 'keychain:avarice-no-such-svc', 'test', { module: 'test', runId: 'run_1', invocationId: 'inv_1' });
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'unavailable');
      const rows = credentialEvents(fx);
      assert.equal(rows.length, 1);
      const row = rows[0] as EventRow;
      assert.equal((JSON.parse(row.data_json) as Record<string, unknown>)['outcome'], 'unavailable');
      assert.equal(row.run_id, 'run_1');
      assert.equal(row.invocation_id, 'inv_1');
      assertValueFree(rows, VALUE);
    } finally {
      kc.dispose();
    }
  });
});
