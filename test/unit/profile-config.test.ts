// The profile config file read back (SEC-1, OPS-5, plan 04-08). The file is parsed whole: the written string form of `profile`, the
// `{ id, class }` form, the roots and the raw sections each consumer parses for itself. Its roots are authoritative for the profile, and
// the three root environment variables override them. A composed AppDeps carries the class and the parsed config.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPermissionRefusal, readProfileConfig, readProfileNotify, unreadableConfig } from '../../src/adapters/fs/profile-config.ts';
import { configPathFor, resolveProfile } from '../../src/adapters/fs/profile-paths.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { PROFILE_CONFIG_KEYS, parseProfileConfig } from '../../src/domain/profile.ts';
import { NOTIFY_DEFAULTS } from '../../src/domain/notify-policy.ts';
import { ok } from '../../src/domain/result.ts';
import type { PortError, Result } from '../../src/domain/result.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

function refusal<T>(result: Result<T>): PortError {
  assert.ok(!result.ok, 'expected a refusal');
  return result.error;
}

const LOCAL = { isLocalMount: () => ok(true) };

// An environment whose three roots point nowhere: only the config under test decides them.
function environment(home: string, configHome: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), AVARICE_CONFIG_HOME: configHome, AVARICE_DATA_ROOT: undefined, AVARICE_WORK_ROOT: undefined, ...extra };
}

function writeConfig(configHome: string, profile: string, content: string | object): string {
  const path = configPathFor(configHome, profile);
  mkdirSync(join(configHome, 'profiles', profile), { recursive: true, mode: 0o700 });
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  return path;
}

describe('parseProfileConfig (SEC-1)', () => {
  it('accepts the written string form of profile with its roots', () => {
    const config = must(parseProfileConfig({ schema: 1, profile: 'personal-local', dataRoot: '/d', workRoot: '/w' }, 'personal-local'));
    assert.deepEqual(config, { schema: 1, id: 'personal-local', class: 'personal', dataRoot: '/d', workRoot: '/w', sections: {} });
  });

  it('accepts the { id, class } form and keeps the limits section raw', () => {
    const config = must(parseProfileConfig({ schema: 1, profile: { id: 'personal-local', class: 'personal' }, limits: { contextTokens: 24000 } }, 'personal-local'));
    assert.equal(config.id, 'personal-local');
    assert.equal(config.class, 'personal');
    assert.deepEqual(config.sections.limits, { contextTokens: 24000 });
  });

  it('takes a file with no schema and no profile as the selected profile (hand-written files)', () => {
    const config = must(parseProfileConfig({ notify: { destinations: ['local'] } }, 'enterprise-acme'));
    assert.equal(config.id, 'enterprise-acme');
    assert.equal(config.class, 'enterprise');
    assert.deepEqual(config.sections.notify, { destinations: ['local'] });
  });

  it('keeps every section of the closed key set raw', () => {
    const raw = {
      schema: 1,
      profile: 'personal-extended',
      notify: { a: 1 },
      limits: { b: 2 },
      retrieval: { c: 3 },
      credentials: { d: 4 },
      adapters: { e: 5 },
      retention: { f: 6 },
      policy: { g: 7 },
      remotePatterns: ['h'],
      workspaceRoots: ['~/code'],
      freshnessWindowHours: 24,
    };
    const config = must(parseProfileConfig(raw, 'personal-extended'));
    const { schema: _schema, profile: _profile, ...sections } = raw;
    assert.deepEqual(config.sections, sections);
    for (const key of Object.keys(raw)) assert.ok(PROFILE_CONFIG_KEYS.includes(key), key);
  });

  it('refuses schema 2, naming the schema key', () => {
    const error = refusal(parseProfileConfig({ schema: 2 }, 'personal-local'));
    assert.deepEqual({ kind: error.kind, field: error.kind === 'invalid' ? error.field : '' }, { kind: 'invalid', field: 'schema' });
  });

  it('refuses an unknown top-level key, naming it', () => {
    const error = refusal(parseProfileConfig({ schema: 1, foo: 1 }, 'personal-local'));
    assert.equal(error.kind, 'invalid');
    assert.equal(error.kind === 'invalid' ? error.field : '', 'foo');
  });

  it('prints a hostile key without control characters and at most 40 characters', () => {
    const error = refusal(parseProfileConfig({ [`\u001b[31m${'k'.repeat(100)}`]: 1 }, 'personal-local'));
    const field = error.kind === 'invalid' ? error.field : '';
    assert.ok(field.length <= 40);
    assert.ok(!/[\u0000-\u001f]/.test(field));
  });

  it('refuses a profile id other than the selected one, in both forms', () => {
    for (const profile of ['personal-extended', { id: 'personal-extended', class: 'personal' }]) {
      const error = refusal(parseProfileConfig({ schema: 1, profile }, 'personal-local'));
      assert.equal(error.kind, 'invalid');
      assert.equal(error.kind === 'invalid' ? error.field : '', 'profile');
    }
  });

  it('refuses a class that is not the class of the id, and a profile that is neither a string nor an object', () => {
    assert.equal(refusal(parseProfileConfig({ profile: { id: 'personal-local', class: 'enterprise' } }, 'personal-local')).kind, 'invalid');
    assert.equal(refusal(parseProfileConfig({ profile: { id: 'personal-local', class: 'personal', extra: 1 } }, 'personal-local')).kind, 'invalid');
    assert.equal(refusal(parseProfileConfig({ profile: 7 }, 'personal-local')).kind, 'invalid');
  });

  it('refuses roots that are not non-empty strings without control characters, and a document that is not an object', () => {
    for (const bad of [1, '', 'a\nb', 'x'.repeat(5000)]) {
      const error = refusal(parseProfileConfig({ dataRoot: bad }, 'personal-local'));
      assert.equal(error.kind === 'invalid' ? error.field : '', 'dataRoot');
    }
    assert.equal(refusal(parseProfileConfig({ workRoot: 3 }, 'personal-local')).kind, 'invalid');
    for (const raw of [[], null, 'x', 4]) assert.equal(refusal(parseProfileConfig(raw, 'personal-local')).kind, 'invalid');
  });
});

describe('readProfileConfig (SEC-1)', () => {
  it('returns the defaults when the file is absent', () => {
    const config = must(readProfileConfig(tempDir('avarice-cfg-'), 'personal-local'));
    assert.deepEqual(config, { schema: 1, id: 'personal-local', class: 'personal', sections: {} });
  });

  it('reads the file back: roots and sections', () => {
    const home = tempDir('avarice-cfg-');
    writeConfig(home, 'enterprise-acme', { schema: 1, profile: { id: 'enterprise-acme', class: 'enterprise' }, dataRoot: '/d', limits: { contextTokens: 100 }, policy: { organizationFile: 'policy.json' } });
    const config = must(readProfileConfig(home, 'enterprise-acme'));
    assert.equal(config.class, 'enterprise');
    assert.equal(config.dataRoot, '/d');
    assert.deepEqual(config.sections.limits, { contextTokens: 100 });
    assert.deepEqual(config.sections.policy, { organizationFile: 'policy.json' });
  });

  it('refuses a symbolic link, a file over 64 KiB, text that is not JSON and a file of another profile', () => {
    const home = tempDir('avarice-cfg-');
    const real = join(home, 'real.json');
    writeFileSync(real, '{}');
    mkdirSync(join(home, 'profiles', 'personal-local'), { recursive: true });
    symlinkSync(real, configPathFor(home, 'personal-local'));
    assert.equal(refusal(readProfileConfig(home, 'personal-local')).kind, 'invalid');

    writeConfig(home, 'personal-extended', `{"notify":{"pad":"${'x'.repeat(64 * 1024)}"}}`);
    assert.equal(refusal(readProfileConfig(home, 'personal-extended')).kind, 'invalid');

    writeConfig(home, 'enterprise-acme', '{not json');
    assert.equal(refusal(readProfileConfig(home, 'enterprise-acme')).kind, 'invalid');

    writeConfig(home, 'enterprise-other', { schema: 1, profile: 'enterprise-acme' });
    const error = refusal(readProfileConfig(home, 'enterprise-other'));
    assert.equal(error.kind === 'invalid' ? error.field : '', 'profile');
  });

  it('leaves readProfileNotify with its results: defaults for a file with no notify section, the section when present', () => {
    const home = tempDir('avarice-cfg-');
    assert.deepEqual(must(readProfileNotify(home, 'personal-local')), NOTIFY_DEFAULTS);
    writeConfig(home, 'personal-local', '{"schema":1}');
    assert.deepEqual(must(readProfileNotify(home, 'personal-local')), NOTIFY_DEFAULTS);
    writeConfig(home, 'personal-local', { schema: 1, profile: 'personal-local', notify: { batchWindowMinutes: 30 } });
    assert.equal(must(readProfileNotify(home, 'personal-local')).batchWindowMinutes, 30);
    writeConfig(home, 'personal-local', '{"notify":{"digestTimes":["25:00"]}}');
    assert.deepEqual(refusal(readProfileNotify(home, 'personal-local')), { kind: 'invalid', field: 'notify.digestTimes[0]', reason: 'expected HH:MM, two digits each, 00:00 to 23:59' });
  });
});

// WR-17 and the owner's ruling "deny, don't refuse": a read the system refused (a mode that forbids it is EACCES, a sandbox deny is EPERM) is told apart from any other
// failure to read, so the registry can deny the profile's roots for the first and must still stop for the second.
describe('isPermissionRefusal (WR-17, AC-6)', () => {
  it('is true for an unreadable config whose system error is EACCES or EPERM, and false for every other code, for a failure with no code and for any other kind of error', () => {
    assert.equal(isPermissionRefusal(unreadableConfig('EACCES')), true);
    assert.equal(isPermissionRefusal(unreadableConfig('EPERM')), true);
    for (const code of ['EIO', 'ENXIO', 'EMFILE', 'ENFILE', 'open failed', 'read failed', 'Unknown system error -102', '']) assert.equal(isPermissionRefusal(unreadableConfig(code)), false, code);
    assert.equal(isPermissionRefusal({ kind: 'invalid', field: 'config', reason: 'the profile config is not valid JSON' }), false);
    assert.equal(isPermissionRefusal({ kind: 'unavailable', cause: 'cannot list the profiles of /x: EPERM' }), false, 'only a refused read of the config counts');
    assert.equal(isPermissionRefusal({ kind: 'denied', rule: 'cannot read the profile config: EPERM', enforcer: 'external-platform' }), false);
  });

  it('classifies the error readProfileConfig returns for a config a mode of 000 refuses', { skip: process.getuid?.() === 0 && 'root can read any file, so a mode of 000 does not make a config unreadable' }, () => {
    const home = tempDir('avarice-cfg-');
    writeConfig(home, 'personal-local', '{"schema":1}');
    const path = configPathFor(home, 'personal-local');
    chmodSync(path, 0o000);
    try {
      const error = refusal(readProfileConfig(home, 'personal-local'));
      assert.equal(error.kind, 'unavailable');
      assert.equal(isPermissionRefusal(error), true);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it('is false for a config that is only corrupt: that stays invalid', () => {
    const home = tempDir('avarice-cfg-');
    writeConfig(home, 'personal-local', '{not json');
    assert.equal(isPermissionRefusal(refusal(readProfileConfig(home, 'personal-local'))), false);
  });
});

describe('resolveProfile roots (OPS-5; the config is authoritative for its profile)', () => {
  it('uses the dataRoot and workRoot the config names when no variable is set', () => {
    const base = tempDir('avarice-roots-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    writeConfig(configHome, 'personal-local', { schema: 1, profile: 'personal-local', dataRoot: join(base, 'x', 'data'), workRoot: join(base, 'x', 'work') });
    const resolved = must(resolveProfile(environment(home, configHome), LOCAL, 'personal-local'));
    assert.equal(resolved.dataRoot, join(base, 'x', 'data'));
    assert.equal(resolved.workRoot, join(base, 'x', 'work'));
    assert.equal(resolved.class, 'personal');
    assert.equal(resolved.config.dataRoot, join(base, 'x', 'data'));
  });

  it('lets the root variables override the selected profile, and leaves the file as it was', () => {
    const base = tempDir('avarice-roots-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    const path = writeConfig(configHome, 'personal-local', { schema: 1, profile: 'personal-local', dataRoot: join(base, 'x', 'data'), workRoot: join(base, 'x', 'work') });
    const before = JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
    const resolved = must(resolveProfile(environment(home, configHome, { AVARICE_DATA_ROOT: join(base, 'env', 'data') }), LOCAL, 'personal-local'));
    assert.equal(resolved.dataRoot, join(base, 'env', 'data'));
    assert.equal(resolved.workRoot, join(base, 'x', 'work'), 'only the variable that is set overrides');
    assert.equal(JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))), before);
  });

  it('does not read the config of a profile that is not selected', () => {
    const base = tempDir('avarice-roots-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    writeConfig(configHome, 'personal-extended', { schema: 1, profile: 'personal-extended', dataRoot: join(base, 'ext', 'data'), workRoot: join(base, 'ext', 'work') });
    const resolved = must(resolveProfile(environment(home, configHome), LOCAL, 'personal-local'));
    assert.equal(resolved.dataRoot, join(home, '.local', 'share', 'avarice', 'personal-local'));
  });

  it('expands a leading ~/ against HOME and refuses a relative root', () => {
    const base = tempDir('avarice-roots-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    writeConfig(configHome, 'personal-local', { schema: 1, profile: 'personal-local', dataRoot: '~/store/data', workRoot: '~/store/work' });
    const resolved = must(resolveProfile(environment(home, configHome), LOCAL, 'personal-local'));
    assert.equal(resolved.dataRoot, join(home, 'store', 'data'));

    writeConfig(configHome, 'personal-extended', { schema: 1, profile: 'personal-extended', dataRoot: 'relative/data' });
    const error = refusal(resolveProfile(environment(home, configHome), LOCAL, 'personal-extended'));
    assert.equal(error.kind === 'invalid' ? error.field : '', 'dataRoot');
  });

  it('refuses a config with an unknown key, naming it, and creates no directory', () => {
    const base = tempDir('avarice-roots-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    writeConfig(configHome, 'personal-local', { schema: 1, profile: 'personal-local', surprise: true });
    const error = refusal(resolveProfile(environment(home, configHome), LOCAL, 'personal-local'));
    assert.equal(error.kind === 'invalid' ? error.field : '', 'surprise');
    assert.throws(() => realpathSync(join(home, '.local')));
  });
});

describe('tracer: a profile config with limits and policy sections is parsed, authoritative for roots, and reaches AppDeps', () => {
  it('composes an AppDeps whose profile carries the class and the parsed config', () => {
    const base = tempDir('avarice-compose-');
    const home = join(base, 'home');
    const configHome = join(base, 'config');
    const limits = { contextTokens: 24000, artifactQuotaMiB: 2048 };
    const dataRoot = join(base, 'tracer', 'data');
    writeConfig(configHome, 'personal-local', { schema: 1, profile: { id: 'personal-local', class: 'personal' }, dataRoot, workRoot: join(base, 'tracer', 'work'), limits, policy: { schema: 1, rules: [] } });
    const composed = createDeps(environment(home, configHome), {}, { readOnly: true, profile: 'personal-local' });
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const profile = composed.value.deps.profile;
      assert.equal(profile.class, 'personal');
      assert.deepEqual(profile.config.sections.limits, limits);
      assert.equal(profile.dataRoot, dataRoot, 'the store opened under the root the config names');
    } finally {
      composed.value.close();
    }
  });
});

