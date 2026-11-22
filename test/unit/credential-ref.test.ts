// SEC-2 / S-49 / D-17: the credential reference grammar, the per-profile provider allow-list and the credentials config section.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS_BY_CLASS, credentialClassOf, parseCredentialRef, parseCredentialSection, providersFor } from '../../src/domain/credential-ref.ts';
import type { Result } from '../../src/domain/result.ts';

// The refusal of a grammar check: it must be refused with the error kind `invalid`, not `denied`, `unavailable` or any other kind. The assertions fail the test; none of
// them returns early, so a wrong kind for one input cannot hide the inputs after it.
function invalidOf(parsed: Result<unknown>, label: string): { field: string; reason: string } {
  assert.ok(!parsed.ok, `${label} is refused`);
  assert.equal(parsed.error.kind, 'invalid', `${label} is refused as invalid, not as another kind: ${JSON.stringify(parsed.error)}`);
  assert.ok(parsed.error.kind === 'invalid', label);
  return { field: parsed.error.field, reason: parsed.error.reason };
}

describe('parseCredentialRef (SEC-2)', () => {
  it('accepts keychain, cmd and delegated references', () => {
    assert.deepEqual(parseCredentialRef('keychain:a'), { ok: true, value: { provider: 'keychain', name: 'a' } });
    assert.deepEqual(parseCredentialRef('cmd:vault-helper'), { ok: true, value: { provider: 'cmd', name: 'vault-helper' } });
    assert.deepEqual(parseCredentialRef('delegated:gh'), { ok: true, value: { provider: 'delegated', name: 'gh' } });
    assert.deepEqual(parseCredentialRef('keychain:my.service_v2-prod'), { ok: true, value: { provider: 'keychain', name: 'my.service_v2-prod' } });
  });

  it('refuses env: in every spelling, naming the reference and the reason (S-49)', () => {
    for (const text of ['env:GITHUB_TOKEN', 'ENV:GITHUB_TOKEN', 'Env:X']) {
      const { reason } = invalidOf(parseCredentialRef(text), text);
      assert.ok(reason.includes(text), reason);
      assert.ok(reason.includes('environment variables are not a credential source'), reason);
    }
  });

  it('refuses another scheme, an empty or missing name, and a name that could walk out of its lookup, naming the reference', () => {
    for (const text of ['vault:x', 'keychain:', 'keychain:../x', 'keychain:a/b', 'cmd:has space', 'delegated:..', 'keychain:.', 'nocolon', ':x', '', 'keychain:' + 'a'.repeat(129)]) {
      const { reason } = invalidOf(parseCredentialRef(text), JSON.stringify(text));
      assert.ok(reason.includes('credential reference'), reason);
      if (text.length > 0 && text.length < 64) assert.ok(reason.includes(text), `${text}: ${reason}`);
    }
  });

  it('never prints a control character or an unbounded reference', () => {
    const { reason } = invalidOf(parseCredentialRef(`vault:\u001b[31m${'x'.repeat(500)}`), 'a reference with a control character and 500 characters');
    assert.ok(!/[\u0000-\u001f]/.test(reason), 'no control character');
    assert.ok(reason.length < 400, `${reason.length}`);
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
    const { field, reason } = invalidOf(parseCredentialSection({ github: 'env:GITHUB_TOKEN' }), 'credentials.github');
    assert.equal(field, 'credentials.github');
    assert.ok(reason.includes('credential reference env:GITHUB_TOKEN is refused: environment variables are not a credential source'), reason);
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
      const { field } = invalidOf(parseCredentialSection({ helpers }), JSON.stringify(helpers));
      assert.ok(field.startsWith('credentials.helpers'), field);
    }
  });

  it('refuses a helper path with a control character', () => {
    assert.ok(!parseCredentialSection({ helpers: { h: '/usr/bin/x\n/etc/passwd' } }).ok);
  });
});
