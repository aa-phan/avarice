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

// The provider allow-list of each profile (D-17; Claude's reading of the decision, recorded in plan 04-15): which providers a profile may
// resolve from. The three keys are the classes the allow-list distinguishes: the two personal profiles differ (only personal-extended
// reaches a vendor CLI that holds its own credential), and every enterprise profile is one class. `env` is in no list.
export type CredentialProfileClass = 'personal-local' | 'personal-extended' | 'enterprise';

export const PROVIDERS_BY_CLASS: Readonly<Record<CredentialProfileClass, readonly ProviderName[]>> = Object.freeze({
  'personal-local': Object.freeze(['keychain', 'cmd'] as const),
  'personal-extended': Object.freeze(['keychain', 'cmd', 'delegated'] as const),
  enterprise: Object.freeze(['keychain', 'cmd'] as const),
});

// The credential class of a profile name. A name outside the profile grammar falls to the narrowest personal class.
export function credentialClassOf(profile: string): CredentialProfileClass {
  if (profile === 'personal-extended') return 'personal-extended';
  if (profile.startsWith('enterprise-')) return 'enterprise';
  return 'personal-local';
}

export function providersFor(profile: string): readonly ProviderName[] {
  return PROVIDERS_BY_CLASS[credentialClassOf(profile)];
}

// The `credentials` section of a profile config: `<name>: "<reference>"` entries, and `helpers`, the approved `cmd:` helpers
// (`<helper name>: "<absolute path>"`). A helper that is not listed there cannot be run (T-04-38). The section is read raw from the config
// by composition; this is the one place that parses it.
export interface CredentialSection {
  refs: Record<string, CredentialRef>;
  helpers: Record<string, string>;
}

const MAX_HELPER_PATH = 1024;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (field: string, reason: string): Result<never> => err({ kind: 'invalid', field, reason });

// A key becomes a field name that a terminal prints, so it is made printable and short first.
const shown = (key: string): string => printable(key, 40);

// `__proto__` from a parsed JSON file is an own key that would assign the prototype of the result; it is never a name.
const isName = (key: string): boolean => NAME_PATTERN.test(key) && key !== '__proto__';

function isAbsoluteHelperPath(value: string): boolean {
  if (value.length > MAX_HELPER_PATH || !value.startsWith('/') || CONTROL.test(value)) return false;
  return value.split('/').slice(1).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function parseHelpers(raw: unknown): Result<Record<string, string>> {
  if (!isRecord(raw)) return invalid('credentials.helpers', 'expected an object of helper names and absolute paths');
  const helpers: Record<string, string> = {};
  for (const [name, path] of Object.entries(raw)) {
    if (!isName(name)) return invalid(`credentials.helpers.${shown(name)}`, 'a helper name is 1 to 128 letters, digits, ".", "_" or "-"');
    if (typeof path !== 'string' || !isAbsoluteHelperPath(path)) {
      return invalid(`credentials.helpers.${shown(name)}`, `expected an absolute path of at most ${MAX_HELPER_PATH} characters with no control character, ".", ".." or empty segment`);
    }
    helpers[name] = path;
  }
  return ok(helpers);
}

export function parseCredentialSection(raw: unknown): Result<CredentialSection> {
  const section: CredentialSection = { refs: {}, helpers: {} };
  if (raw === undefined) return ok(section);
  if (!isRecord(raw)) return invalid('credentials', 'expected an object in the profile config');
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'helpers') {
      const helpers = parseHelpers(value);
      if (!helpers.ok) return helpers;
      section.helpers = helpers.value;
      continue;
    }
    if (!isName(key)) return invalid(`credentials.${shown(key)}`, 'a credential name is 1 to 128 letters, digits, ".", "_" or "-"');
    if (typeof value !== 'string') return invalid(`credentials.${shown(key)}`, 'expected a credential reference string such as keychain:<service>');
    const ref = parseCredentialRef(value);
    if (!ref.ok) return err({ kind: 'invalid', field: `credentials.${shown(key)}`, reason: ref.error.kind === 'invalid' ? ref.error.reason : 'the credential reference is refused' });
    section.refs[key] = ref.value;
  }
  return ok(section);
}
