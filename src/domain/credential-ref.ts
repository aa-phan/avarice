// Credential references as pure rules (SEC-2, ADR-009, D-17). A reference names where a credential lives, never the credential:
// `keychain:<service>`, `cmd:<helper name>` or `delegated:<cli>`. `env:<NAME>` and every other scheme is refused in every profile, because an
// environment variable leaks to child processes, crash reports and shell history (S-49). The reasons name the reference so the owner
// can find it in the config they edited.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type ProviderName = 'keychain' | 'cmd' | 'delegated';

export const PROVIDER_NAMES: readonly ProviderName[] = ['keychain', 'cmd', 'delegated'];

export interface CredentialRef {
  provider: ProviderName;
  name: string;
}

// A service, helper or CLI name: letters, digits, `.`, `_` and `-`, one to 128 characters. A `/` or a space cannot be in it, so a name can
// never walk out of the place a provider looks it up.
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_SHOWN = 64;

// Control characters and over-long text of a refused reference never reach a terminal line or an event.
export function printable(text: string, max: number = MAX_SHOWN): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function refused(text: string, why: string): Result<never> {
  return err({ kind: 'invalid', field: 'credentialRef', reason: `credential reference ${printable(text)} is refused: ${why}` });
}

// The provider and the name of a reference, or `invalid` naming the reference.
export function parseCredentialRef(text: string): Result<CredentialRef> {
  if (typeof text !== 'string') return refused(String(text), 'expected a string');
  const colon = text.indexOf(':');
  if (colon <= 0) return refused(text, 'expected keychain:<service>, cmd:<helper name> or delegated:<cli>');
  const scheme = text.slice(0, colon);
  const name = text.slice(colon + 1);
  if (scheme.toLowerCase() === 'env') return refused(text, 'environment variables are not a credential source (S-49)');
  if (!(PROVIDER_NAMES as readonly string[]).includes(scheme)) {
    return refused(text, `'${printable(scheme)}' is not a credential provider; use keychain:<service>, cmd:<helper name> or delegated:<cli>`);
  }
  if (!NAME_PATTERN.test(name) || /^\.+$/.test(name)) {
    return refused(text, `the name after '${scheme}:' must be 1 to 128 letters, digits, '.', '_' or '-'`);
  }
  return ok({ provider: scheme as ProviderName, name });
}

// SKELETON for the RED run of Task 2 of plan 04-15: the planned names exist and enforce nothing.
export type CredentialProfileClass = 'personal-local' | 'personal-extended' | 'enterprise';

export const PROVIDERS_BY_CLASS: Readonly<Record<CredentialProfileClass, readonly ProviderName[]>> = {
  'personal-local': PROVIDER_NAMES,
  'personal-extended': PROVIDER_NAMES,
  enterprise: PROVIDER_NAMES,
};

export function credentialClassOf(_profile: string): CredentialProfileClass {
  return 'personal-local';
}

export function providersFor(_profile: string): readonly ProviderName[] {
  return PROVIDER_NAMES;
}

export interface CredentialSection {
  refs: Record<string, CredentialRef>;
  helpers: Record<string, string>;
}

export function parseCredentialSection(_raw: unknown): Result<CredentialSection> {
  return ok({ refs: {}, helpers: {} });
}
