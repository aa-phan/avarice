// What both context adapters need to judge an index against the repository: its current HEAD, and whether a cited
// path still exists there. Read-only git through safe git (hooks, fsmonitor and prompts off; no filter runs for
// `rev-parse` or `cat-file`), aimed at the user's repository and never writing to it.
import { runGit } from '../git/safe-git.ts';
import type { Freshness } from '../../ports/context-source.ts';

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const MAX_PATH_CHARS = 4096;

// The repository's current HEAD as a full commit, or null when it cannot be read.
export function currentHead(repoPath: string): string | null {
  const ran = runGit(['rev-parse', 'HEAD'], { cwd: repoPath });
  if (!ran.ok) return null;
  const head = ran.value.stdout.trim();
  return FULL_COMMIT.test(head) ? head : null;
}

// `git:abc...` -> `abc...`; a bare commit is kept.
export function commitOf(revision: string): string {
  return revision.startsWith('git:') ? revision.slice('git:'.length) : revision;
}

// `fresh` when the index was built at the repository's current HEAD, `stale` when it was built at another commit,
// `unavailable` when HEAD cannot be read (the index then says nothing about the repository as it is now).
export function freshnessAt(indexRevision: string, head: string | null): Freshness {
  if (head === null) return 'unavailable';
  return commitOf(indexRevision) === head ? 'fresh' : 'stale';
}

// A path an index cites, as something `git cat-file -e HEAD:{path}` may be asked about: relative, inside the
// repository, one line.
export function isCitablePath(path: string): boolean {
  if (path === '' || path.length > MAX_PATH_CHARS || path.startsWith('/') || path.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return !path.split('/').some((part) => part === '..' || part === '');
}

// Whether `path` exists at the repository's current HEAD: true or false, or undefined when it cannot be told (the
// path is not a repository path, or git did not run).
export function pathExistsAtHead(repoPath: string, path: string): boolean | undefined {
  if (!isCitablePath(path)) return undefined;
  const ran = runGit(['cat-file', '-e', `HEAD:${path}`], { cwd: repoPath });
  if (ran.ok) return true;
  // git exits 128 for an object that does not exist; a git that could not run is not an answer.
  return ran.error.kind === 'internal' ? false : undefined;
}

// Tokens as GSD's own reader counts them: characters / 4.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
