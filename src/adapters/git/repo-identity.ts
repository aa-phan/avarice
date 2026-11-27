// Who a repository is, for choosing its profile (SEC-1, D-16): the realpath of its git root, its root commit and the credential-free URL
// of its `origin` remote. Read with safe git (no hook, no fsmonitor, no prompt), so looking at a hostile repository runs none of its code.
// A directory that is not a repository, a repository with no commit and a path that cannot be run in all answer `undefined`: the command
// that follows reports its own problem with the path, and a repository with no history has nothing to be bound by.
import { realpathSync } from 'node:fs';
import { runGit } from './safe-git.ts';
import { stripCredentials } from './repo-facts.ts';

export interface RepositoryFacts {
  gitRoot: string;
  // The first of the root commits in sorted order (a repository can have more than one).
  rootCommit: string;
  // The URL of `origin` without credentials; absent when there is no such remote.
  remote?: string;
}

export function readRepositoryFacts(cwd: string): RepositoryFacts | undefined {
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd });
  if (!top.ok) return undefined;
  const root = top.value.stdout.trim();
  if (root === '') return undefined;
  let gitRoot: string;
  try {
    gitRoot = realpathSync(root);
  } catch {
    return undefined;
  }
  const roots = runGit(['rev-list', '--max-parents=0', 'HEAD'], { cwd: gitRoot });
  if (!roots.ok) return undefined;
  const rootCommit = roots.value.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '').sort()[0];
  if (rootCommit === undefined) return undefined;
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: gitRoot, acceptExit: [2] });
  const url = origin.ok ? origin.value.stdout.trim() : '';
  return { gitRoot, rootCommit, ...(url !== '' ? { remote: stripCredentials(url) } : {}) };
}
