// RunSource port (D-04, D-16, RC-2). What `start` learns about the user's repository from git objects alone: the repository
// conventions (`.avarice/config.json`) and how far the source has moved past the pin. Read-only; the adapter never reads a
// working-tree file, so an uncommitted edit, a dirty checkout or a half-written file cannot change an answer, and it reads no clock
// (the caller turns a commit time into an age with its own clock).
import type { Result } from '../domain/result.ts';

export interface ConventionsAt {
  // The commit the text was read from: the pin itself, or a descendant of the pin whose whole diff against the pin is under `.avarice/`.
  revision: string;
  // The UTF-8 text of `.avarice/config.json` at that revision, at most 256 KiB.
  text: string;
}

export interface Staleness {
  // Whether the source HEAD is the pin or descends from it. When false the other fields are 0 and null.
  descendant: boolean;
  // Commits in pin..HEAD that touch a path outside `.avarice/**` and `.planning/**`.
  commitsOutside: number;
  // Committer time (ms since the epoch) of the oldest of those commits; null when there is none.
  oldestOutsideCommittedAtMs: number | null;
}

export interface RunSource {
  // The source repository's HEAD commit.
  head(repoPath: string): Result<string>;
  // D-16: the newest commit C on the first-parent chain from `head` back to `pin` whose diff against the pin touches only `.avarice/**`
  // and which contains `.avarice/config.json`. `not_found` when there is none; `conflict` when `head` does not descend from `pin`;
  // `invalid` when the file is over 256 KiB.
  conventionsAt(repoPath: string, pin: string, head: string): Result<ConventionsAt>;
  // D-04: how far `head` has moved past `pin`.
  staleness(repoPath: string, pin: string, head: string): Result<Staleness>;
}
