// GitRunSource (D-04, D-16, RC-2): what `start` learns about the user's repository, from git objects only. Every call is a read-only
// git command through runGit; no working-tree file is opened (an uncommitted edit of `.avarice/config.json` cannot change an answer)
// and no clock is read (the caller turns the returned commit time into an age).
//
// Conventions (D-16): the code under work is the pin tree, but the repository's conventions may have been committed after the pin.
// The adapter walks the first-parent chain from the source HEAD back to the pin and takes the newest commit whose whole difference
// against the pin lies under `.avarice/` and that contains `.avarice/config.json`; the pin itself is the last candidate. A commit
// that also changes anything else is not a candidate, so the conventions never come from a tree whose code differs from the pin.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { ConventionsAt, RunSource, Staleness } from '../../ports/run-source.ts';
import { runGit } from './safe-git.ts';
import { COMMIT_SHA, failure, invalid, nulSplit } from './staging-base.ts';

const CONFIG_PATH = '.avarice/config.json';
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CANDIDATES = 500;
const LIST_TIMEOUT_MS = 60_000;

// The smallest committer time in `git log --format=%ct` output, in milliseconds, or null when no line is a time. A single pass, not
// a spread of the times into Math.min: more than about 125000 arguments throw a RangeError, and a history can be longer than that.
export function oldestCommitTime(stdout: string): number | null {
  let oldest: number | null = null;
  for (const line of stdout.split('\n')) {
    if (!/^\d+$/.test(line)) continue;
    const seconds = Number(line);
    if (oldest === null || seconds < oldest) oldest = seconds;
  }
  return oldest === null ? null : oldest * 1000;
}

interface Resolved {
  root: string;
}

export class GitRunSource implements RunSource {
  head(repoPath: string): Result<string> {
    const head = runGit(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repoPath });
    if (!head.ok) return failure(head.error);
    const commit = head.value.stdout.trim();
    if (COMMIT_SHA.test(commit)) return ok(commit);
    if (/^[0-9a-f]{64}$/.test(commit)) return invalid('head', 'the repository uses SHA-256 object names; only SHA-1 repositories are supported');
    return invalid('head', 'a full lowercase commit SHA is required');
  }

  conventionsAt(repoPath: string, pin: string, head: string): Result<ConventionsAt> {
    const resolved = this.resolve(repoPath, pin, head);
    if (!resolved.ok) return resolved;
    const { root } = resolved.value;
    const descendant = this.descendsFrom(root, pin, head);
    if (!descendant.ok) return descendant;
    if (!descendant.value) return err({ kind: 'conflict', expected: `the source HEAD ${head} to descend from the pin ${pin}`, actual: 'a HEAD that does not descend from the pin' });

    // Newest first: HEAD down to the commit above the pin on the first-parent chain, then the pin.
    const chain = runGit(['rev-list', '--first-parent', `--max-count=${MAX_CANDIDATES}`, `${pin}..${head}`], { cwd: root, timeoutMs: LIST_TIMEOUT_MS });
    if (!chain.ok) return failure(chain.error);
    const candidates = [...chain.value.stdout.split('\n').filter((line) => COMMIT_SHA.test(line)), pin];

    for (const commit of candidates) {
      const entry = this.configEntry(root, commit);
      if (!entry.ok) return entry;
      if (entry.value === null) continue;
      if (commit !== pin) {
        const underAvarice = this.touchesOnlyAvarice(root, pin, commit);
        if (!underAvarice.ok) return underAvarice;
        if (!underAvarice.value) continue;
      }
      if (entry.value.size > MAX_CONFIG_BYTES) return invalid(CONFIG_PATH, `${entry.value.size} bytes exceeds the limit of ${MAX_CONFIG_BYTES}`);
      const blob = runGit(['cat-file', 'blob', entry.value.sha], { cwd: root });
      if (!blob.ok) return failure(blob.error);
      return ok({ revision: commit, text: blob.value.stdout });
    }
    return err({ kind: 'not_found', ref: `${CONFIG_PATH} at the pin or at a descendant commit that changes only .avarice/` });
  }

  staleness(repoPath: string, pin: string, head: string): Result<Staleness> {
    const resolved = this.resolve(repoPath, pin, head);
    if (!resolved.ok) return resolved;
    const { root } = resolved.value;
    const descendant = this.descendsFrom(root, pin, head);
    if (!descendant.ok) return descendant;
    if (!descendant.value) return ok({ descendant: false, commitsOutside: 0, oldestOutsideCommittedAtMs: null });

    // One committer time per commit that touches a path outside `.avarice/` and `.planning/` (the exclude pathspecs are magic, so
    // no literal-pathspec mode here; both are constants).
    const listed = runGit(['log', '--format=%ct', `${pin}..${head}`, '--', '.', ':(exclude).avarice', ':(exclude).planning'], { cwd: root, timeoutMs: LIST_TIMEOUT_MS });
    if (!listed.ok) return failure(listed.error);
    const commitsOutside = listed.value.stdout.split('\n').filter((line) => /^\d+$/.test(line)).length;
    return ok({ descendant: true, commitsOutside, oldestOutsideCommittedAtMs: oldestCommitTime(listed.value.stdout) });
  }

  hasFile(repoPath: string, revision: string, relPath: string): Result<boolean> {
    if (!COMMIT_SHA.test(revision)) return invalid('revision', 'a full lowercase commit SHA is required');
    if (relPath === '' || relPath.startsWith('/') || relPath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      return invalid('relPath', 'a relative path inside the repository is required');
    }
    const top = runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath });
    if (!top.ok) return failure(top.error);
    const root = top.value.stdout.trim();
    if (!runGit(['cat-file', '-e', `${revision}^{commit}`], { cwd: root }).ok) return err({ kind: 'not_found', ref: revision });
    // `ls-tree` answers with an entry or with nothing, so a missing path is a plain false (`cat-file -e` would signal it by exit status
    // only, which runGit does not expose).
    const listed = runGit(['ls-tree', '-z', revision, '--', relPath], { cwd: root, literalPathspecs: true });
    if (!listed.ok) return failure(listed.error);
    for (const entry of nulSplit(listed.value.stdout)) {
      const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entry);
      if (match === null || match[4] !== relPath) continue;
      return ok(match[2] === 'blob' && (match[1] ?? '').startsWith('100'));
    }
    return ok(false);
  }

  // Validation before any side effect, and both commits must exist: a SHA flows into git argv.
  private resolve(repoPath: string, pin: string, head: string): Result<Resolved> {
    if (!COMMIT_SHA.test(pin)) return invalid('pin', 'a full lowercase commit SHA is required');
    if (!COMMIT_SHA.test(head)) return invalid('head', 'a full lowercase commit SHA is required');
    const top = runGit(['rev-parse', '--show-toplevel'], { cwd: repoPath });
    if (!top.ok) return failure(top.error);
    const root = top.value.stdout.trim();
    for (const commit of [pin, head]) {
      if (!runGit(['cat-file', '-e', `${commit}^{commit}`], { cwd: root }).ok) return err({ kind: 'not_found', ref: commit });
    }
    return ok({ root });
  }

  // `head` is the pin or descends from it exactly when the merge base of the two is the pin. (`merge-base` prints nothing and exits 1
  // when the two share no history.)
  private descendsFrom(root: string, pin: string, head: string): Result<boolean> {
    const base = runGit(['merge-base', pin, head], { cwd: root, acceptExit: [1] });
    if (!base.ok) return failure(base.error);
    return ok(base.value.stdout.trim() === pin);
  }

  // The `.avarice/config.json` entry of a commit when it is a regular file; null when absent or not a regular file (a symbolic
  // link or a directory is not a configuration file).
  private configEntry(root: string, commit: string): Result<{ sha: string; size: number } | null> {
    const listed = runGit(['ls-tree', '-l', '-z', commit, '--', CONFIG_PATH], { cwd: root, literalPathspecs: true });
    if (!listed.ok) return failure(listed.error);
    for (const entry of nulSplit(listed.value.stdout)) {
      const match = /^(\d+) (\w+) ([0-9a-f]+) +(\d+|-)\t(.*)$/s.exec(entry);
      if (match === null || match[5] !== CONFIG_PATH) continue;
      const [, mode, type, sha, size] = match;
      if (type !== 'blob' || !(mode ?? '').startsWith('100') || sha === undefined || size === undefined) return ok(null);
      return ok({ sha, size: Number(size) });
    }
    return ok(null);
  }

  private touchesOnlyAvarice(root: string, pin: string, commit: string): Result<boolean> {
    const changed = runGit(['diff-tree', '-r', '--name-only', '-z', '--no-renames', pin, commit], { cwd: root, timeoutMs: LIST_TIMEOUT_MS });
    if (!changed.ok) return failure(changed.error);
    return ok(nulSplit(changed.value.stdout).every((path) => path.startsWith('.avarice/')));
  }
}
