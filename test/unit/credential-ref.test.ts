// SEC-2 / S-49 / D-17: the credential reference grammar, the per-profile provider allow-list and the credentials config section.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS_BY_CLASS, credentialClassOf, parseCredentialRef, parseCredentialSection, providersFor } from '../../src/domain/credential-ref.ts';

describe('parseCredentialRef (SEC-2)', () => {
  it('accepts keychain, cmd and delegated references', () => {
    assert.deepEqual(parseCredentialRef('keychain:a'), { ok: true, value: { provider: 'keychain', name: 'a' } });
    assert.deepEqual(parseCredentialRef('cmd:vault-helper'), { ok: true, value: { provider: 'cmd', name: 'vault-helper' } });
    assert.deepEqual(parseCredentialRef('delegated:gh'), { ok: true, value: { provider: 'delegated', name: 'gh' } });
    assert.deepEqual(parseCredentialRef('keychain:my.service_v2-prod'), { ok: true, value: { provider: 'keychain', name: 'my.service_v2-prod' } });
  });

  it('refuses env: in every spelling, naming the reference and the reason (S-49)', () => {
    for (const text of ['env:GITHUB_TOKEN', 'ENV:GITHUB_TOKEN', 'Env:X']) {
      const parsed = parseCredentialRef(text);
      assert.ok(!parsed.ok, text);
      assert.equal(parsed.error.kind, 'invalid');
      if (parsed.error.kind !== 'invalid') return;
      assert.ok(parsed.error.reason.includes(text), parsed.error.reason);
      assert.ok(parsed.error.reason.includes('environment variables are not a credential source'), parsed.error.reason);
    }
  });

  it('refuses another scheme, an empty or missing name, and a name that could walk out of its lookup, naming the reference', () => {
    for (const text of ['vault:x', 'keychain:', 'keychain:../x', 'keychain:a/b', 'cmd:has space', 'delegated:..', 'keychain:.', 'nocolon', ':x', '', 'keychain:' + 'a'.repeat(129)]) {
      const parsed = parseCredentialRef(text);
      assert.ok(!parsed.ok, JSON.stringify(text));
      if (parsed.ok || parsed.error.kind !== 'invalid') return;
      assert.ok(parsed.error.reason.includes('credential reference'), parsed.error.reason);
      if (text.length > 0 && text.length < 64) assert.ok(parsed.error.reason.includes(text), `${text}: ${parsed.error.reason}`);
    }
  });

  it('never prints a control character or an unbounded reference', () => {
    const parsed = parseCredentialRef(`vault:\u001b[31m${'x'.repeat(500)}`);
    assert.ok(!parsed.ok);
    if (parsed.ok || parsed.error.kind !== 'invalid') return;
    assert.ok(!/[\u0000-\u001f]/.test(parsed.error.reason), 'no control character');
    assert.ok(parsed.error.reason.length < 400, `${parsed.error.reason.length}`);
  });
});

describe('the provider allow-list of each profile (D-17)', () => {
  it('allows keychain and cmd under personal-local, adds delegated under personal-extended and allows keychain and cmd under an enterprise profile', () => {
    assert.deepEqual([...PROVIDERS_BY_CLASS['personal-local']].sort(), ['cmd', 'keychain']);
    assert.deepEqual([...PROVIDERS_BY_CLASS['personal-extended']].sort(), ['cmd', 'delegated', 'keychain']);
    assert.deepEqual([...PROVIDERS_BY_CLASS['enterprise']].sort(), ['cmd', 'keychain']);
  });

  it('maps a profile name to its class and its providers; env is allowed nowhere', () => {
    assert.equal(credentialClassOf('personal-local'), 'personal-local');
    assert.equal(credentialClassOf('personal-extended'), 'personal-extended');
    assert.equal(credentialClassOf('enterprise-acme'), 'enterprise');
    assert.deepEqual([...providersFor('enterprise-acme')].sort(), ['cmd', 'keychain']);
    assert.ok(!providersFor('personal-local').includes('delegated'));
    for (const cls of Object.values(PROVIDERS_BY_CLASS)) assert.ok(!(cls as readonly string[]).includes('env'));
  });
});

describe('parseCredentialSection (SEC-2)', () => {
  it('returns the references and the approved helpers', () => {
    const parsed = parseCredentialSection({ github: 'delegated:gh', helpers: { 'vault-helper': '/usr/local/bin/vault-helper' } });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepEqual(parsed.value.refs, { github: { provider: 'delegated', name: 'gh' } });
    assert.deepEqual(parsed.value.helpers, { 'vault-helper': '/usr/local/bin/vault-helper' });
  });

  it('accepts an absent section and an empty one', () => {
    for (const raw of [undefined, {}]) {
      const parsed = parseCredentialSection(raw);
      assert.ok(parsed.ok);
      assert.deepEqual(parsed.value, { refs: {}, helpers: {} });
    }
  });

  it('refuses an env: reference naming the key and the reference', () => {
    const parsed = parseCredentialSection({ github: 'env:GITHUB_TOKEN' });
    assert.ok(!parsed.ok);
    if (parsed.ok || parsed.error.kind !== 'invalid') return;
    assert.equal(parsed.error.field, 'credentials.github');
    assert.ok(parsed.error.reason.includes('credential reference env:GITHUB_TOKEN is refused: environment variables are not a credential source'), parsed.error.reason);
  });

  it('refuses a value that is not a reference string, a key outside the grammar and a section that is not an object', () => {
    // JSON.parse gives `__proto__` as an own key, which an object literal cannot.
    const hostile: unknown = JSON.parse('{"__proto__":"keychain:x"}');
    for (const raw of [{ a: 5 }, { a: null }, { 'bad key': 'keychain:x' }, hostile, 'keychain:x', ['keychain:x'], null]) {
      assert.ok(!parseCredentialSection(raw).ok, JSON.stringify(raw));
    }
  });

  it('refuses a helper that is not an absolute path, a helper name outside the grammar and helpers that is not an object', () => {
    for (const helpers of [{ h: 'vault-helper' }, { h: './vault-helper' }, { h: '/usr/bin/../bin/x' }, { h: '' }, { h: 5 }, { 'bad name': '/usr/bin/x' }, 'nope', ['/usr/bin/x']]) {
      const parsed = parseCredentialSection({ helpers });
      assert.ok(!parsed.ok, JSON.stringify(helpers));
      if (parsed.ok || parsed.error.kind !== 'invalid') return;
      assert.ok(parsed.error.field.startsWith('credentials.helpers'), parsed.error.field);
    }
  });

  it('refuses a helper path with a control character', () => {
    assert.ok(!parseCredentialSection({ helpers: { h: '/usr/bin/x\n/etc/passwd' } }).ok);
  });
});
