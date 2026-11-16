// What is known about the repository a command works on before any store is opened (SEC-1, D-16): the profile it is bound to and the
// enterprise profile whose remote patterns it matches. Both come from files in the config home and from git facts of the repository;
// no store of any profile is read or opened to learn them. A command that names a repository (`repo add <path>`, `onboard <path>`) is
// judged by that repository; one that names none is judged by the repository the working directory is inside, if any.
import { resolve } from 'node:path';
import { readRepositoryFacts } from '../adapters/git/repo-identity.ts';
import { readBindings, readEnterprisePatterns } from '../adapters/fs/profile-bindings.ts';
import { resolveConfigHome } from '../adapters/fs/profile-paths.ts';
import { describeError } from '../adapters/sqlite/db.ts';
import { matchesRemotePattern } from '../domain/profile.ts';

export const EXIT_PROFILE_REFUSED = 3;
const EXIT_UNAVAILABLE = 70;

export interface RepositoryContext {
  // The profile the repository is bound to.
  bound?: string;
  // The first enterprise profile (in name order) with a remote pattern that the repository's `origin` matches.
  enterprise?: string;
}

export type ContextResult = { ok: true; value: RepositoryContext } | { ok: false; code: number; message: string };

// `repositoryArg` is the path a command names, if it names one; `cwd` is where the command runs. A registry or enterprise config that
// cannot be trusted is a refusal (exit 3), never a reason to carry on as if the repository were unbound.
export function readRepositoryContext(env: NodeJS.ProcessEnv, repositoryArg: string | undefined, cwd: string): ContextResult {
  const configHome = resolveConfigHome(env);
  const bindings = readBindings(configHome);
  if (!bindings.ok) return { ok: false, code: bindings.error.kind === 'invalid' ? EXIT_PROFILE_REFUSED : EXIT_UNAVAILABLE, message: describeError(bindings.error) };
  const patterns = readEnterprisePatterns(configHome);
  if (!patterns.ok) return { ok: false, code: patterns.error.kind === 'invalid' ? EXIT_PROFILE_REFUSED : EXIT_UNAVAILABLE, message: describeError(patterns.error) };
  // Nothing is bound and no enterprise profile claims a remote: no repository can change which profile is chosen, so git is not run.
  if (bindings.value.length === 0 && patterns.value.length === 0) return { ok: true, value: {} };

  const facts = readRepositoryFacts(repositoryArg === undefined ? cwd : resolve(cwd, repositoryArg));
  if (facts === undefined) return { ok: true, value: {} };
  const bound = bindings.value.find((b) => b.gitRoot === facts.gitRoot && b.rootCommit === facts.rootCommit)?.profile;
  const remote = facts.remote;
  const enterprise = remote === undefined ? undefined : patterns.value.find((entry) => entry.patterns.some((p) => matchesRemotePattern(remote, p)))?.profile;
  return { ok: true, value: { ...(bound !== undefined ? { bound } : {}), ...(enterprise !== undefined ? { enterprise } : {}) } };
}
