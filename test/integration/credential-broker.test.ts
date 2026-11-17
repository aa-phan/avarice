// SEC-2 / ADR-009 / D-17: credentials are resolved by reference at the moment of use, from an approved provider, and never persisted.
// The Keychain cases run against a temporary keychain file created and deleted by the test (`security create-keychain`), reached by its
// path; the login keychain and every real item of the owner are never touched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { CmdProvider, HELPER_ENV_NAMES } from '../../src/adapters/credential/cmd.ts';
import { DelegatedProvider } from '../../src/adapters/credential/delegated.ts';
import { KeychainProvider } from '../../src/adapters/credential/keychain.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { resolveCredential } from '../../src/app/credentials.ts';
import type { CredentialDeps } from '../../src/app/credentials.ts';
import { MIGRATIONS, createDeps } from '../../src/cli/composition.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import { TEST_CLI } from '../helpers/offline.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';

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

// ---- cmd and delegated providers, the profile allow-list and the env refusal ---------------------------------------------------------------

// 22 characters; no secret pattern matches it.
const HELPER_VALUE = ['hv-Q7mZ', 'x3Rk9T', 'p2LwB5nD'].join('');

function finished(stdout: string, extra: Partial<CommandResult> = {}): Result<CommandResult> {
  return ok({ exitCode: 0, signal: null, status: 'passed', durationMs: 1, stdout, stderr: '', truncated: false, ...extra });
}

// A CommandExecutor that records each spec it is given and answers from `reply`; nothing is spawned.
class FakeExecutor implements CommandExecutor {
  readonly specs: CommandSpec[] = [];
  readonly descriptor = { port: 'executor', adapter: 'fake', version: '1', capabilities: {}, offline: true };
  readonly #reply: (spec: CommandSpec) => Result<CommandResult>;
  constructor(reply: (spec: CommandSpec) => Result<CommandResult>) {
    this.#reply = reply;
  }
  run(spec: CommandSpec): Promise<Result<CommandResult>> {
    this.specs.push(spec);
    return Promise.resolve(this.#reply(spec));
  }
}

function outcomes(fx: Fixture): string[] {
  return credentialEvents(fx).map((row) => String((JSON.parse(row.data_json) as Record<string, unknown>)['outcome']));
}

const HELPER_PATH = '/usr/local/bin/vault-helper';

describe('the cmd provider (SEC-2, T-04-38)', () => {
  it('runs a listed helper through the executor by argv with a scrubbed environment and a 5 s timeout, and resolves its trimmed stdout', async () => {
    const previous = process.env['GITHUB_TOKEN'];
    process.env['GITHUB_TOKEN'] = 'inherited-token-that-must-not-reach-the-helper';
    try {
      const executor = new FakeExecutor(() => finished(`  ${HELPER_VALUE}\n`));
      const cwd = tempDir('avarice-cwd-');
      const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd }) });
      const result = await resolveCredential(fx.deps, 'cmd:vault-helper', 'test', { module: 'test', invocationId: 'inv_9' });
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.use((v) => v), HELPER_VALUE);
      assert.equal(executor.specs.length, 1);
      const spec = executor.specs[0] as CommandSpec;
      assert.deepEqual(spec.argv, [HELPER_PATH]);
      assert.equal(spec.timeoutMs, 5000);
      assert.equal(spec.cwd, cwd);
      assert.deepEqual(spec.writePaths, []);
      assert.equal(spec.allowLoopbackPorts, undefined, 'the network stays denied');
      assert.equal(spec.invocationId, 'inv_9');
      // The environment of the helper holds no variable outside the scrub list, and none of this process's.
      for (const key of Object.keys(spec.env)) assert.ok(HELPER_ENV_NAMES.includes(key), `unexpected variable ${key}`);
      assert.ok(!('GITHUB_TOKEN' in spec.env));
      assert.ok(!Object.values(spec.env).some((v) => v.includes('inherited-token')));
      const rows = credentialEvents(fx);
      assert.deepEqual(outcomes(fx), ['resolved']);
      assertValueFree(rows, HELPER_VALUE);
    } finally {
      if (previous === undefined) delete process.env['GITHUB_TOKEN'];
      else process.env['GITHUB_TOKEN'] = previous;
    }
  });

  it('denies a helper that is not listed in credentials.helpers without running anything (outcome denied)', async () => {
    const executor = new FakeExecutor(() => finished(HELPER_VALUE));
    const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) });
    const result = await resolveCredential(fx.deps, 'cmd:other-helper', 'test', { module: 'test' });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'denied');
    assert.equal(executor.specs.length, 0, 'nothing was run');
    assert.deepEqual(outcomes(fx), ['denied']);
    assertValueFree(credentialEvents(fx), HELPER_VALUE);
  });

  it('refuses a helper that prints fewer than 8 characters (outcome invalid)', async () => {
    const executor = new FakeExecutor(() => finished('abcde\n'));
    const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) });
    const result = await resolveCredential(fx.deps, 'cmd:vault-helper', 'test', { module: 'test' });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'invalid');
    assert.deepEqual(outcomes(fx), ['invalid']);
    assert.ok(!JSON.stringify(result).includes('abcde'), 'the error does not hold the value');
    assertValueFree(credentialEvents(fx), 'abcde');
  });

  it('discards the stderr of a failing helper: the error and the event hold none of it (outcome unavailable)', async () => {
    const executor = new FakeExecutor(() => finished('', { exitCode: 3, status: 'failed', stderr: `vault said ${HELPER_VALUE} is wrong` }));
    const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) });
    const result = await resolveCredential(fx.deps, 'cmd:vault-helper', 'test', { module: 'test' });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'unavailable');
    assert.ok(!JSON.stringify(result).includes('vault said'));
    assert.deepEqual(outcomes(fx), ['unavailable']);
    assert.ok(!credentialEvents(fx).some((row) => row.data_json.includes('vault said')));
  });

  it('reports a helper that outruns its timeout as unavailable, and an executor that cannot run as unavailable', async () => {
    const slow = new FakeExecutor(() => finished('', { exitCode: null, status: 'timed_out' }));
    const fx = fixture({ cmd: new CmdProvider({ executor: slow, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) });
    const timedOut = await resolveCredential(fx.deps, 'cmd:vault-helper', 'test', { module: 'test' });
    assert.ok(!timedOut.ok);
    assert.equal(timedOut.error.kind, 'timeout');
    const none = new FakeExecutor(() => err({ kind: 'unavailable', cause: 'the sandbox cannot be used here' }));
    const fy = fixture({ cmd: new CmdProvider({ executor: none, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) });
    const refused = await resolveCredential(fy.deps, 'cmd:vault-helper', 'test', { module: 'test' });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'unavailable');
    assert.deepEqual(outcomes(fx), ['unavailable']);
    assert.deepEqual(outcomes(fy), ['unavailable']);
  });

  const realExecutor = new SandboxedExecutor();
  const enforced = realExecutor.descriptor.attributes?.['enforcement'] === 'enforced';
  it('runs a real helper script through the real sandboxed executor and resolves what it prints', { skip: enforced ? false : 'the sandbox is not usable here' }, async () => {
    const dir = tempDir('avarice-helper-');
    const script = join(dir, 'echo-helper');
    writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' '${HELPER_VALUE}'\nprintf 'diagnostic on stderr\\n' >&2\n`);
    chmodSync(script, 0o755);
    const fx = fixture({ cmd: new CmdProvider({ executor: realExecutor, helpers: { 'echo-helper': script }, cwd: dir }) });
    const result = await resolveCredential(fx.deps, 'cmd:echo-helper', 'test', { module: 'test' });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.use((v) => v), HELPER_VALUE);
    assert.deepEqual(outcomes(fx), ['resolved']);
    assert.ok(!credentialEvents(fx).some((row) => row.data_json.includes('diagnostic')));
  });
});

// A directory on PATH holding an executable `gh`.
function pathWithGh(): string {
  const dir = tempDir('avarice-bin-');
  const gh = join(dir, 'gh');
  writeFileSync(gh, '#!/bin/sh\nexit 0\n');
  chmodSync(gh, 0o755);
  return dir;
}

describe('the delegated provider and the allow-list of each profile (D-17)', () => {
  it('returns a handle that names the CLI and holds no value under personal-extended', async () => {
    const fx = fixture({ delegated: new DelegatedProvider({ pathEnv: pathWithGh() }) }, 'personal-extended');
    const result = await resolveCredential(fx.deps, 'delegated:gh', 'test', { module: 'test' });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.delegatedTo, 'gh');
    assert.equal(result.value.use((v) => v), '');
    assert.deepEqual(outcomes(fx), ['resolved']);
    assert.equal(new DelegatedProvider().descriptor.capabilities['delegated'], true);
    assert.ok(!JSON.stringify(result.value).includes('/'), 'the handle does not even carry a path');
  });

  it('denies delegated under personal-local and under an enterprise profile although a provider is wired (class allow-list)', async () => {
    for (const profile of ['personal-local', 'enterprise-acme']) {
      const fx = fixture({ delegated: new DelegatedProvider({ pathEnv: pathWithGh() }) }, profile);
      const result = await resolveCredential(fx.deps, 'delegated:gh', 'test', { module: 'test' });
      assert.ok(!result.ok, profile);
      assert.equal(result.error.kind, 'denied', profile);
      assert.deepEqual(outcomes(fx), ['denied'], profile);
    }
  });

  it('reports a CLI that is not on PATH as unavailable', async () => {
    const fx = fixture({ delegated: new DelegatedProvider({ pathEnv: tempDir('avarice-empty-') }) }, 'personal-extended');
    const result = await resolveCredential(fx.deps, 'delegated:gh', 'test', { module: 'test' });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'unavailable');
    assert.deepEqual(outcomes(fx), ['unavailable']);
  });

  it('allows keychain and cmd in every profile class and refuses a provider the profile does not wire as unavailable', async () => {
    const executor = new FakeExecutor(() => finished(HELPER_VALUE));
    for (const profile of ['personal-local', 'personal-extended', 'enterprise-acme']) {
      const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }) }, profile);
      const viaCmd = await resolveCredential(fx.deps, 'cmd:vault-helper', 'test', { module: 'test' });
      assert.ok(viaCmd.ok, profile);
      const viaKeychain = await resolveCredential(fx.deps, 'keychain:avarice-test-svc', 'test', { module: 'test' });
      assert.ok(!viaKeychain.ok, profile);
      assert.equal(viaKeychain.error.kind, 'unavailable', profile);
      assert.deepEqual(outcomes(fx), ['resolved', 'unavailable'], profile);
    }
  });
});

describe('references that are never a source (SEC-2, S-49)', () => {
  it('refuses env: and every other scheme in every profile with outcome invalid, an error naming the reference, and no value in the event', async () => {
    const executor = new FakeExecutor(() => finished(HELPER_VALUE));
    for (const profile of ['personal-local', 'personal-extended', 'enterprise-acme']) {
      const fx = fixture({ cmd: new CmdProvider({ executor, helpers: { 'vault-helper': HELPER_PATH }, cwd: tempDir('avarice-cwd-') }), delegated: new DelegatedProvider({ pathEnv: pathWithGh() }), keychain: new KeychainProvider() }, profile);
      for (const ref of ['env:GITHUB_TOKEN', 'ENV:GITHUB_TOKEN', 'vault:secret/x', 'keychain:', 'keychain:../x', 'GITHUB_TOKEN']) {
        const result = await resolveCredential(fx.deps, ref, 'test', { module: 'test' });
        assert.ok(!result.ok, `${profile} ${ref}`);
        assert.equal(result.error.kind, 'invalid', `${profile} ${ref}`);
        if (result.error.kind === 'invalid') assert.ok(result.error.reason.includes(ref), result.error.reason);
      }
      const rows = credentialEvents(fx);
      assert.deepEqual(outcomes(fx), Array(6).fill('invalid'), profile);
      assert.equal(rows.length, 6);
      assert.ok(String((JSON.parse((rows[0] as EventRow).data_json) as Record<string, unknown>)['reference']) === 'env:GITHUB_TOKEN');
      assertValueFree(rows, HELPER_VALUE);
    }
    assert.equal(executor.specs.length, 0, 'a refused reference ran nothing');
  });
});

// ---- the broker in composition ---------------------------------------------------------------------------------------------------------

function composeEnv(roots: CliRoots, home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_PROFILE: undefined,
  };
}

function configFile(roots: CliRoots, profile: string): string {
  return join(roots.AVARICE_CONFIG_HOME, 'profiles', profile, 'config.json');
}

// Writes the profile config (created once by the first command, or from scratch), with `credentials` set.
function setCredentials(roots: CliRoots, profile: string, credentials: unknown): void {
  const path = configFile(roots, profile);
  let current: Record<string, unknown> = { schema: 1, profile };
  try {
    current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    mkdirSync(join(path, '..'), { recursive: true });
  }
  writeFileSync(path, JSON.stringify({ ...current, credentials }, null, 2));
}

function adapterRows(roots: CliRoots): Array<{ name: string; port: string; adapter: string; descriptor_json: string }> {
  return ledgerRows(roots, "SELECT name, port, adapter, descriptor_json FROM adapter_configs WHERE port = 'credential' ORDER BY name");
}

describe('AppDeps.credentials in composition (SEC-2, D-17)', () => {
  const helperDir = tempDir('avarice-helper-');
  const helper = join(helperDir, 'echo-helper');
  writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' '${HELPER_VALUE}'\n`);
  chmodSync(helper, 0o755);

  it('builds the broker from exactly the providers the profile class allows and records each descriptor without a secret', () => {
    for (const [profile, expected] of [
      ['personal-local', ['credential-cmd', 'credential-keychain']],
      ['personal-extended', ['credential-cmd', 'credential-delegated', 'credential-keychain']],
    ] as const) {
      const roots = makeRoots();
      cleanup.push(roots.base);
      const home = tempDir('avarice-home-');
      setCredentials(roots, profile, { github: 'delegated:gh', work: 'keychain:avarice-work', helpers: { 'echo-helper': helper } });
      // delegated:gh is a valid reference for the grammar even where the profile may not resolve it; the allow-list decides at resolution.
      const composed = createDeps(composeEnv(roots, home), {}, { profile });
      assert.ok(composed.ok, composed.ok ? '' : composed.message);
      try {
        assert.ok(composed.value.deps.credentials !== undefined, profile);
      } finally {
        composed.value.close();
      }
      const rows = adapterRows(roots);
      assert.deepEqual(rows.map((r) => r.name), expected, profile);
      for (const row of rows) {
        assert.equal(row.port, 'credential');
        assert.ok(!row.descriptor_json.includes(helper), 'the descriptor holds no helper path');
        assert.ok(!row.descriptor_json.includes('avarice-work'), 'the descriptor holds no reference');
      }
    }
  });

  it('resolves a listed helper through the composed broker and the real sandboxed executor, and refuses delegated under personal-local', { skip: new SandboxedExecutor().descriptor.attributes?.['enforcement'] === 'enforced' ? false : 'the sandbox is not usable here' }, async () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const home = tempDir('avarice-home-');
    setCredentials(roots, 'personal-local', { helpers: { 'echo-helper': helper } });
    const composed = createDeps(composeEnv(roots, home), {}, { profile: 'personal-local' });
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const broker = composed.value.deps.credentials;
      assert.ok(broker !== undefined);
      const resolved = await broker.resolve('cmd:echo-helper', 'test', { module: 'composition-test', runId: 'run_1' });
      assert.ok(resolved.ok, JSON.stringify(resolved));
      assert.equal(resolved.value.use((v) => v), HELPER_VALUE);
      const refused = await broker.resolve('delegated:gh', 'test', { module: 'composition-test' });
      assert.ok(!refused.ok);
      assert.equal(refused.error.kind, 'denied');
      const unlisted = await broker.resolve('cmd:not-listed', 'test', { module: 'composition-test' });
      assert.ok(!unlisted.ok);
      assert.equal(unlisted.error.kind, 'denied');
    } finally {
      composed.value.close();
    }
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      const rows = db.prepare("SELECT run_id, data_json FROM events WHERE type = 'credential.resolve' ORDER BY seq").all() as Array<{ run_id: string | null; data_json: string }>;
      assert.deepEqual(rows.map((r) => (JSON.parse(r.data_json) as Record<string, unknown>)['outcome']), ['resolved', 'denied', 'denied']);
      assert.equal(rows[0]?.run_id, 'run_1');
      assert.ok(rows.every((r) => !r.data_json.includes(HELPER_VALUE)));
    } finally {
      db.close();
    }
  });

  it('composes no broker for a read-only command and does not read the credentials section there', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const home = tempDir('avarice-home-');
    const first = createDeps(composeEnv(roots, home), {}, { profile: 'personal-local' });
    assert.ok(first.ok);
    first.value.close();
    setCredentials(roots, 'personal-local', { github: 'env:GITHUB_TOKEN' });
    const readOnly = createDeps(composeEnv(roots, home), {}, { profile: 'personal-local', readOnly: true });
    assert.ok(readOnly.ok, readOnly.ok ? '' : readOnly.message);
    try {
      assert.equal(readOnly.value.deps.credentials, undefined);
    } finally {
      readOnly.value.close();
    }
  });
});

describe('a profile with an env reference cannot start a run (S-49, T-04-39)', () => {
  it('refuses `avarice start` with exit 70, naming env:GITHUB_TOKEN, and creates no run row', () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    const onboarded = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
    assert.equal(onboarded.code, 0, onboarded.stderr + onboarded.stdout);
    commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
    const brief = writeBrief(join(roots.base, 'briefs'));
    const runsBefore = ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM runs')[0]?.n;
    const eventsBefore = ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM events')[0]?.n;

    setCredentials(roots, 'personal-local', { github: 'env:GITHUB_TOKEN' });
    const refused = startWithFakeRunHost(roots, repo, brief, { edits: {}, summary: true, verification: 'passed' });
    assert.equal(refused.code, 70, refused.stderr + refused.stdout);
    assert.ok(refused.stderr.includes('credential reference env:GITHUB_TOKEN is refused: environment variables are not a credential source'), refused.stderr);
    assert.ok(refused.stderr.includes('credentials.github'), 'the message names the config key');
    assert.equal(ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM runs')[0]?.n, runsBefore, 'no run row was created');
    assert.equal(ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM events')[0]?.n, eventsBefore, 'nothing was recorded');

    // With the reference corrected, the same command starts (so the refusal above was the reference, not the setup).
    setCredentials(roots, 'personal-local', { github: 'keychain:avarice-no-such-service' });
    const started = startWithFakeRunHost(roots, repo, brief, { edits: {}, summary: true, verification: 'passed' });
    assert.notEqual(started.code, 70, started.stderr + started.stdout);
    assert.doesNotMatch(started.stderr, /credential reference/);
  });

  it('refuses every non-read-only command, not only start', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    setCredentials(roots, 'personal-local', { github: 'env:GITHUB_TOKEN', helpers: {} });
    const refused = runCli(['init'], { roots, entry: TEST_CLI });
    assert.equal(refused.code, 70, refused.stderr + refused.stdout);
    assert.ok(refused.stderr.includes('env:GITHUB_TOKEN'), refused.stderr);
  });
});
