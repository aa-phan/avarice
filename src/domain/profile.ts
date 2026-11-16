// Profile identity as pure rules (SEC-1, D-16, D-17). A profile is a named, separate set of roots and a store. Its name is one of
// `personal-local`, `personal-extended` or `enterprise-<org>`; the name becomes a directory name under the config home, the data
// root and the work root, so the grammar is also what keeps a name from walking out of them. Which profile a command runs under is
// chosen by `selectProfile` from what is known before any store is opened: the profile a repository is bound to, the flag, the
// environment variable and the default, in that order.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export const DEFAULT_PROFILE_NAME = 'personal-local';

export type ProfileClass = 'personal' | 'enterprise';

const PERSONAL_NAMES: readonly string[] = ['personal-local', 'personal-extended'];
const ENTERPRISE_PREFIX = 'enterprise-';
const ORG_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

// The name when it follows the grammar, otherwise `invalid` with field `profile`.
export function parseProfileName(name: string): Result<string> {
  if (PERSONAL_NAMES.includes(name)) return ok(name);
  if (name.startsWith(ENTERPRISE_PREFIX) && ORG_PATTERN.test(name.slice(ENTERPRISE_PREFIX.length))) return ok(name);
  return err({
    kind: 'invalid',
    field: 'profile',
    reason: `'${printable(name)}' is not a profile name; use personal-local, personal-extended or enterprise-<org> (org: lower-case letters, digits and hyphens, starting with a letter or digit, at most 31 characters)`,
  });
}

// Control characters and over-long text of a refused name never reach a terminal line.
function printable(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, '?');
  return flat.length > 64 ? `${flat.slice(0, 64)}...` : flat;
}

// The class of a name that follows the grammar, by prefix.
export function profileClass(name: string): ProfileClass {
  return name.startsWith(ENTERPRISE_PREFIX) ? 'enterprise' : 'personal';
}

export interface ProfileSelectionInput {
  // `--profile`.
  flag?: string;
  // The profile the repository at hand is bound to, when it is bound.
  bound?: string;
  // `AVARICE_PROFILE`.
  envDefault?: string;
}

// A bound repository takes the bound profile, and a flag that names another profile is refused (`denied`, rule
// `repository-bound-to:<bound>`); the environment variable never overrides a binding. Without a binding the flag wins over the
// environment variable, which wins over the default. The chosen name must follow the grammar.
export function selectProfile(input: ProfileSelectionInput): Result<string> {
  if (input.bound !== undefined && input.flag !== undefined && input.flag !== input.bound) {
    return err({ kind: 'denied', rule: `repository-bound-to:${input.bound}`, enforcer: 'avarice' });
  }
  return parseProfileName(input.bound ?? input.flag ?? input.envDefault ?? DEFAULT_PROFILE_NAME);
}

// A remote URL reduced to `host/path` for matching: no scheme, no user or password, no port, no trailing `.git` or slash, lower case.
// Both `https://user:token@host/org/repo.git` and the scp form `git@host:org/repo.git` reduce to `host/org/repo`.
export function normalizeRemote(remote: string): string {
  let rest = remote.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
  if (scheme !== null) {
    rest = rest.slice(scheme[0].length).replace(/^[^/@]*@/, '');
  } else {
    const scp = /^(?:[^@/:]+@)?([^:/]+):(?!\/\/)(.*)$/.exec(rest);
    if (scp !== null) rest = `${scp[1] ?? ''}/${scp[2] ?? ''}`;
  }
  const slash = rest.indexOf('/');
  const host = (slash === -1 ? rest : rest.slice(0, slash)).replace(/:\d*$/, '');
  const path = slash === -1 ? '' : rest.slice(slash + 1);
  return `${host}/${path}`.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function segmentMatches(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) return pattern === segment;
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`).test(segment);
}

// Whether a remote falls under a `remotePatterns` entry of an enterprise profile config: a `host/path` glob where `*` stands for
// characters within one path segment, matched over the credential-free, normalized remote and without regard to case, so that a
// difference of case never lets an enterprise repository through. The segment counts must be equal: `host/org/*` matches
// `host/org/tool` and not `host/org` or `host/org/team/tool`.
export function matchesRemotePattern(remote: string, pattern: string): boolean {
  const wanted = normalizeRemote(pattern).split('/');
  const actual = normalizeRemote(remote).split('/');
  if (wanted.length !== actual.length) return false;
  return wanted.every((part, index) => segmentMatches(part, actual[index] as string));
}

// The profile config file (SEC-1, OPS-5). The key set is closed: a key outside it is refused by name.
export const PROFILE_CONFIG_KEYS: readonly string[] = Object.freeze([
  'schema',
  'profile',
  'dataRoot',
  'workRoot',
  'notify',
  'limits',
  'retrieval',
  'credentials',
  'adapters',
  'retention',
  'policy',
  'remotePatterns',
  'workspaceRoots',
  'freshnessWindowHours',
]);

export type SectionKey = 'notify' | 'limits' | 'retrieval' | 'credentials' | 'adapters' | 'retention' | 'policy' | 'remotePatterns' | 'workspaceRoots' | 'freshnessWindowHours';

export interface ProfileConfig {
  schema: 1;
  id: string;
  class: ProfileClass;
  dataRoot?: string;
  workRoot?: string;
  sections: Partial<Record<SectionKey, unknown>>;
}

const SECTION_KEYS: readonly SectionKey[] = ['notify', 'limits', 'retrieval', 'credentials', 'adapters', 'retention', 'policy', 'remotePatterns', 'workspaceRoots', 'freshnessWindowHours'];
const MAX_ROOT_CHARS = 4096;
// Every C0 control character (tab and newline included), DEL and the C1 controls.
const ANY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (field: string, reason: string): Result<never> => err({ kind: 'invalid', field, reason });

// A key from a hand-edited file goes into a field path that a terminal prints: drop control characters and cap it.
function fieldKey(key: string): string {
  return key.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 40);
}

function parseRoot(value: unknown, field: 'dataRoot' | 'workRoot'): Result<string> {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ROOT_CHARS || ANY_CONTROL.test(value)) {
    return invalid(field, `expected a path of at most ${MAX_ROOT_CHARS} characters without control characters`);
  }
  return ok(value);
}

// `profile` is the written string form (`"personal-local"`) or `{ id, class }`; either must name the selected profile, and a class must be
// the class its id has.
function parseIdentity(value: unknown, expectedProfile: string): Result<true> {
  if (typeof value === 'string') {
    return value === expectedProfile ? ok(true) : invalid('profile', `the file names profile '${printable(value)}', not the selected profile '${expectedProfile}'`);
  }
  if (!isRecord(value)) return invalid('profile', "expected a profile id or an object with 'id' and 'class'");
  for (const key of Object.keys(value)) {
    if (key !== 'id' && key !== 'class') return invalid('profile', `unknown key '${fieldKey(key)}'; expected id and class`);
  }
  if (value['id'] !== expectedProfile) return invalid('profile', `the file names profile '${printable(String(value['id']))}', not the selected profile '${expectedProfile}'`);
  if (value['class'] !== undefined && value['class'] !== profileClass(expectedProfile)) {
    return invalid('profile', `the class '${printable(String(value['class']))}' is not the class of ${expectedProfile} (${profileClass(expectedProfile)})`);
  }
  return ok(true);
}

// The whole profile config file as a typed value. The key set is closed (PROFILE_CONFIG_KEYS): an unknown top-level key, a schema other
// than 1 and a profile other than `expectedProfile` are refused naming the key. `schema` and `profile` may be left out of a hand-written
// file. The roots are checked for shape only; the sections stay raw, because each consumer parses its own section in its own module.
export function parseProfileConfig(raw: unknown, expectedProfile: string): Result<ProfileConfig> {
  const named = parseProfileName(expectedProfile);
  if (!named.ok) return named;
  if (!isRecord(raw)) return invalid('config', 'expected an object');
  for (const key of Object.keys(raw)) {
    if (!PROFILE_CONFIG_KEYS.includes(key)) return invalid(fieldKey(key), `unknown key; expected ${PROFILE_CONFIG_KEYS.join(', ')}`);
  }
  if (raw['schema'] !== undefined && raw['schema'] !== 1) return invalid('schema', 'expected 1');
  if (raw['profile'] !== undefined) {
    const identity = parseIdentity(raw['profile'], expectedProfile);
    if (!identity.ok) return identity;
  }
  const config: ProfileConfig = { schema: 1, id: expectedProfile, class: profileClass(expectedProfile), sections: {} };
  for (const field of ['dataRoot', 'workRoot'] as const) {
    if (raw[field] === undefined) continue;
    const root = parseRoot(raw[field], field);
    if (!root.ok) return root;
    config[field] = root.value;
  }
  for (const key of SECTION_KEYS) {
    if (raw[key] !== undefined) config.sections[key] = raw[key];
  }
  return ok(config);
}
