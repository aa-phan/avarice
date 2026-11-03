// Checkout digest (plan 01-19; docs/repository-onboarding.md, research "Staging worktree mechanics"): what "the user's
// checkout is unchanged" means as one JSON line, so a before and an after can be compared.
//
//   node scripts/checkout-digest.ts <repo> [--allow-ref glob]...
//
// Prints { head, branch, statusDigest, filesDigest, refsDigest, worktreesDigest, counts }. Everything is read through
// safe git (no hooks, no fsmonitor, no optional locks, filter drivers neutralized for the one call that compares
// working-tree files), so reading never refreshes the index or runs repository code. File bytes are hashed and never
// printed. Exit 0 with the JSON on success, 2 on a usage error or an unreadable repository.
//
//   statusDigest     sha256 of `git status --porcelain=v2 -z --untracked-files=all`
//   filesDigest      sha256 over the path and bytes of every tracked and untracked (not ignored) file, outside .git;
//                    a symlink contributes its target, a missing tracked file a marker
//   refsDigest       sha256 over `git for-each-ref` (refname and object) minus the refs `--allow-ref` names; a glob
//                    is matched against the full ref name, `*` matches any characters including `/`
//   worktreesDigest  sha256 over `git worktree list --porcelain` (linked worktree metadata)
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runGit } from '../src/adapters/git/safe-git.ts';

export interface CheckoutDigest {
  head: string;
  branch: string;
  statusDigest: string;
  filesDigest: string;
  refsDigest: string;
  worktreesDigest: string;
  counts: { tracked: number; untracked: number; statusEntries: number; refs: number; refsAllowed: number };
}

const GIT_TIMEOUT_MS = 120_000;
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

function git(repo: string, args: readonly string[], neutralizeFilters = false): string {
  const out = runGit(args, { cwd: repo, timeoutMs: GIT_TIMEOUT_MS, neutralizeFilters });
  if (!out.ok) throw new Error(`git ${args[0] ?? ''} failed in ${repo}: ${out.error.kind}`);
  return out.value.stdout;
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function checkoutDigest(repo: string, allowRefs: readonly string[] = []): CheckoutDigest {
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  const branch = git(repo, ['branch', '--show-current']).trim();
  const status = git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all'], true);

  const cachedList = git(repo, ['ls-files', '-z', '--cached']).split('\0').filter((p) => p !== '');
  const othersList = git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((p) => p !== '');
  const files = [...new Set([...cachedList, ...othersList])].sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(rel).update('\0');
    const full = join(repo, rel);
    try {
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) hash.update('link:').update(readlinkSync(full));
      else if (stat.isFile()) hash.update('file:').update(readFileSync(full));
      else hash.update('other');
    } catch {
      hash.update('missing');
    }
    hash.update('\0');
  }

  const allow = allowRefs.map(globToRegExp);
  const refLines = git(repo, ['for-each-ref', '--format=%(refname) %(objectname)']).split('\n').filter((l) => l !== '');
  const kept = refLines.filter((line) => !allow.some((re) => re.test(line.slice(0, line.indexOf(' ')))));

  return {
    head,
    branch,
    statusDigest: sha256(status),
    filesDigest: hash.digest('hex'),
    refsDigest: sha256(kept.join('\n')),
    worktreesDigest: sha256(git(repo, ['worktree', 'list', '--porcelain'])),
    counts: {
      tracked: cachedList.length,
      untracked: othersList.length,
      statusEntries: status.split('\0').filter((r) => r !== '').length,
      refs: kept.length,
      refsAllowed: refLines.length - kept.length,
    },
  };
}

function main(argv: readonly string[]): number {
  const allow: string[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (word === '--allow-ref') {
      const value = argv[++i];
      if (value === undefined || value === '') {
        process.stderr.write('checkout-digest: --allow-ref needs a glob\n');
        return 2;
      }
      allow.push(value);
    } else if (word.startsWith('--allow-ref=')) {
      allow.push(word.slice('--allow-ref='.length));
    } else if (word.startsWith('--')) {
      process.stderr.write(`checkout-digest: unknown option ${word}\n`);
      return 2;
    } else {
      positionals.push(word);
    }
  }
  const [repo] = positionals;
  if (repo === undefined || positionals.length !== 1) {
    process.stderr.write('usage: node scripts/checkout-digest.ts <repo> [--allow-ref glob]...\n');
    return 2;
  }
  try {
    process.stdout.write(`${JSON.stringify(checkoutDigest(repo, allow))}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`checkout-digest: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
