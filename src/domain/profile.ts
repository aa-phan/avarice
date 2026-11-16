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
