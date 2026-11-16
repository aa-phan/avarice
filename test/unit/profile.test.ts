// Profile identity rules (SEC-1, D-16, D-17): the name grammar, the class by prefix, the selection precedence and the remote pattern match.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE_NAME, matchesRemotePattern, normalizeRemote, parseProfileName, profileClass, selectProfile } from '../../src/domain/profile.ts';

describe('parseProfileName (D-17)', () => {
  for (const name of ['personal-local', 'personal-extended', 'enterprise-acme', 'enterprise-a1-b2', 'enterprise-0', `enterprise-${'a'.repeat(31)}`]) {
    it(`accepts ${name}`, () => {
      assert.deepEqual(parseProfileName(name), { ok: true, value: name });
    });
  }

  for (const name of [
    'enterprise-',
    'enterprise-Acme',
    'enterprise--acme',
    'enterprise-acme_x',
    'enterprise-ac me',
    'personal',
    'Personal-local',
    'personal-local ',
    '../x',
    'enterprise-../x',
    'personal-local/../../x',
    '',
    'a'.repeat(40),
    `enterprise-${'a'.repeat(32)}`,
    `enterprise-${'a'.repeat(40)}`,
  ]) {
    it(`refuses ${JSON.stringify(name.length > 50 ? `${name.slice(0, 20)}... (${name.length} characters)` : name)}`, () => {
      const result = parseProfileName(name);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.kind, 'invalid');
      assert.equal((result.error as { field: string }).field, 'profile');
    });
  }

  it('keeps control characters and long text of a refused name out of the message', () => {
    const result = parseProfileName(`bad\u001b[31m${'x'.repeat(200)}`);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reason = (result.error as { reason: string }).reason;
    assert.doesNotMatch(reason, /\u001b/);
    assert.ok(reason.length < 400);
  });
});

describe('profileClass', () => {
  it('maps a name to its class by prefix', () => {
    assert.equal(profileClass('personal-local'), 'personal');
    assert.equal(profileClass('personal-extended'), 'personal');
    assert.equal(profileClass('enterprise-acme'), 'enterprise');
  });
});

describe('selectProfile (D-16)', () => {
  it('takes the bound profile when the flag agrees or is absent', () => {
    assert.deepEqual(selectProfile({ bound: 'enterprise-acme', flag: 'enterprise-acme' }), { ok: true, value: 'enterprise-acme' });
    assert.deepEqual(selectProfile({ bound: 'enterprise-acme' }), { ok: true, value: 'enterprise-acme' });
  });

  it('denies a flag that names another profile, with the rule repository-bound-to:<bound>', () => {
    const result = selectProfile({ bound: 'enterprise-acme', flag: 'personal-local' });
    assert.deepEqual(result, { ok: false, error: { kind: 'denied', rule: 'repository-bound-to:enterprise-acme', enforcer: 'avarice' } });
  });

  it('never lets the environment variable override a binding', () => {
    assert.deepEqual(selectProfile({ bound: 'enterprise-acme', envDefault: 'personal-local' }), { ok: true, value: 'enterprise-acme' });
  });

  it('prefers the flag over the environment variable, and the environment variable over the default', () => {
    assert.deepEqual(selectProfile({ flag: 'personal-extended', envDefault: 'enterprise-acme' }), { ok: true, value: 'personal-extended' });
    assert.deepEqual(selectProfile({ envDefault: 'personal-extended' }), { ok: true, value: 'personal-extended' });
    assert.deepEqual(selectProfile({}), { ok: true, value: DEFAULT_PROFILE_NAME });
    assert.equal(DEFAULT_PROFILE_NAME, 'personal-local');
  });

  it('refuses a chosen name that does not follow the grammar', () => {
    for (const input of [{ flag: 'nope' }, { envDefault: 'nope' }]) {
      const result = selectProfile(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'invalid');
    }
  });
});

describe('remote patterns (D-16)', () => {
  it('reduces a remote to host/path without scheme, credentials, port, .git or case', () => {
    assert.equal(normalizeRemote('https://user:tok@GitHub.Example.com/Acme/Tool.git'), 'github.example.com/acme/tool');
    assert.equal(normalizeRemote('git@github.example.com:acme/tool.git'), 'github.example.com/acme/tool');
    assert.equal(normalizeRemote('ssh://git@github.example.com:2222/acme/tool/'), 'github.example.com/acme/tool');
    assert.equal(normalizeRemote('github.example.com/acme/tool'), 'github.example.com/acme/tool');
  });

  it('lets * stand for characters within one path segment', () => {
    assert.equal(matchesRemotePattern('https://github.example.com/acme/tool.git', 'github.example.com/acme/*'), true);
    assert.equal(matchesRemotePattern('git@github.example.com:acme/tool.git', 'github.example.com/acme/*'), true);
    assert.equal(matchesRemotePattern('https://github.example.com/acme/tool', 'github.example.com/acme/to*'), true);
    assert.equal(matchesRemotePattern('https://github.example.com/acme/tool', 'github.example.com/acme/tool'), true);
    assert.equal(matchesRemotePattern('https://github.example.com/ACME/Tool', 'github.example.com/acme/*'), true);
    assert.equal(matchesRemotePattern('https://github.example.com/acme/tool', '*.example.com/acme/*'), true);
  });

  it('does not let * cross a path separator or match a different host or organization', () => {
    assert.equal(matchesRemotePattern('https://github.example.com/acme/team/tool', 'github.example.com/acme/*'), false);
    assert.equal(matchesRemotePattern('https://github.example.com/acme', 'github.example.com/acme/*'), false);
    assert.equal(matchesRemotePattern('https://github.example.com/other/tool', 'github.example.com/acme/*'), false);
    assert.equal(matchesRemotePattern('https://github.com/acme/tool', 'github.example.com/acme/*'), false);
    assert.equal(matchesRemotePattern('https://github.example.com.evil.test/acme/tool', 'github.example.com/acme/*'), false);
  });

  it('treats regular expression characters in a pattern as text', () => {
    assert.equal(matchesRemotePattern('https://github.example.com/acme/tool', 'github.example.com/a(cme/*'), false);
    assert.equal(matchesRemotePattern('https://githubXexample.com/acme/tool', 'github.example.com/acme/*'), false);
  });
});
