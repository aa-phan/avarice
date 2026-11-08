// Safe git (ONB-4, SKELETON.md "Safe git", research Pattern 4). Every git subprocess AVARICE starts carries
// the same environment, so a repository's hooks, its `core.fsmonitor` command and an interactive prompt
// cannot run code or block while AVARICE inspects or stages the repository, and neither the machine's system
// configuration nor its system attributes change what git does. Arguments are an argv array, never a shell
// string. Read-only calls must not refresh the user's index, hence GIT_OPTIONAL_LOCKS=0.
//
// Further guards live in this module only:
//  - a caller cannot pass `-c`, `--config-env` or `clone --config` (a caller-supplied configuration override
//    could re-enable what the environment turns off); the few configuration entries a caller may need (a commit
//    identity, fsck on transfer) are fixed options below that map to fixed keys, never free-form;
//  - `clone`, `fetch` and `commit` accept only the options listed for them, and `fetch` refuses a forced refspec;
//  - `neutralizeFilters` blanks the clean, smudge and process commands of every `filter.<name>.*` driver the
//    repository defines for the one call, because git runs a clean filter to compare a working-tree file that
//    has the same size as its index entry, so `git status` of a repository with a hostile filter runs code.
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

// Also inherited by the contained host (plan 01-15), so GSD's own git calls run with the same guard.
export const SAFE_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.fsmonitor',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
});

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const BASE_CONFIG_ENTRIES = 2;
const CLONE_OPTIONS: ReadonlySet<string> = new Set(['--local', '--no-hardlinks', '--no-checkout', '--quiet', '-q']);
// Run hand-off (plan 02-07): a fetch into the user's repository creates one ref and nothing else, and the supervisor's commit
// is hook-free and unsigned. The message of a commit travels as the value of `-m`; everything after `--` is a pathspec.
const FETCH_OPTIONS: ReadonlySet<string> = new Set(['--no-tags', '--no-write-fetch-head', '--quiet', '-q']);
const COMMIT_OPTIONS: ReadonlySet<string> = new Set(['--no-verify', '--no-gpg-sign', '--quiet', '-q']);

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
  // Neutralize every filter driver of the repository at `cwd` for this call. Use it on every call that
  // compares or writes working-tree files (`status`, `diff`, `checkout`, `worktree add`).
  neutralizeFilters?: boolean;
  // Exit statuses besides 0 that are an answer, not a failure (`git check-ignore` exits 1 when nothing is ignored).
  acceptExit?: readonly number[];
  // Ignore the user's and the machine's exclude files (`core.excludesFile` is set to /dev/null for the call), so only the
  // repository's own rules decide what `check-ignore` reports.
  noUserExcludes?: boolean;
  // A commit identity for this call: `user.name`, `user.email` and `commit.gpgsign=false` are set, so a machine's signing or
  // identity configuration changes nothing about the commit.
  identity?: { name: string; email: string };
  // `transfer.fsckObjects` and `fetch.fsckObjects` on, so objects arriving from a tree an agent wrote into are checked.
  fsck?: boolean;
  // Absolute path of a temporary index file (`GIT_INDEX_FILE`), so a tree can be computed without touching the repository's own
  // index. A relative path is refused.
  indexFile?: string;
  // Treat every pathspec as a literal path (`GIT_LITERAL_PATHSPECS`): no glob and no `:(magic)`. Use it whenever a path comes from data.
  literalPathspecs?: boolean;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
}

type ConfigEntry = readonly [key: string, value: string];

// Minimal environment: nothing from the caller's environment reaches git except what git needs to run.
export function safeGitEnv(base: NodeJS.ProcessEnv = process.env, extraConfig: readonly ConfigEntry[] = []): Record<string, string> {
  const env: Record<string, string> = {
    PATH: base['PATH'] && base['PATH'].length > 0 ? base['PATH'] : '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin',
    HOME: base['HOME'] ?? '',
    LANG: base['LANG'] && base['LANG'].length > 0 ? base['LANG'] : 'C',
    ...SAFE_GIT_ENV,
  };
  env['GIT_CONFIG_COUNT'] = String(BASE_CONFIG_ENTRIES + extraConfig.length);
  extraConfig.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${BASE_CONFIG_ENTRIES + index}`] = key;
    env[`GIT_CONFIG_VALUE_${BASE_CONFIG_ENTRIES + index}`] = value;
  });
  return env;
}

// Refusals happen before git runs. The subcommand must be the first argument (no global options at all, which
// also rules out `-c`, `-C`, `--git-dir`, `--exec-path`), `--config-env` is refused anywhere, and `clone`
// accepts only the options listed above. `switch -c` and `checkout -b` are subcommand options and stay allowed.
function refuseUnsafeArgs(args: readonly string[]): string | null {
  const [subcommand] = args;
  if (subcommand === undefined || subcommand.length === 0) return 'a git subcommand is required';
  if (subcommand.startsWith('-')) return `global git option ${JSON.stringify(subcommand)} is not allowed; pass the subcommand first`;
  for (const arg of args) {
    if (arg === '--config-env' || arg.startsWith('--config-env=')) return `${arg.split('=')[0]} is not allowed`;
  }
  if (subcommand === 'clone') {
    // An allowlist, not a deny list: git accepts unambiguous abbreviations such as `--conf` for `--config`.
    for (const arg of args.slice(1)) {
      if (arg === '--') break;
      if (!CLONE_OPTIONS.has(arg)) return `clone option ${JSON.stringify(arg.split('=')[0])} is not allowed`;
    }
  }
  if (subcommand === 'fetch') {
    // Same allowlist rule. Before `--` a word is an option, a repository or a refspec; after it, a repository or a refspec.
    // A refspec starting with `+` forces the update and could move an existing ref, so none is accepted anywhere.
    let afterDashes = false;
    for (const arg of args.slice(1)) {
      if (!afterDashes && arg === '--') {
        afterDashes = true;
        continue;
      }
      if (arg.startsWith('+')) return 'a forced refspec (leading +) is not allowed';
      if (!afterDashes && arg.startsWith('-') && !FETCH_OPTIONS.has(arg)) return `fetch option ${JSON.stringify(arg.split('=')[0])} is not allowed`;
    }
  }
  if (subcommand === 'commit') {
    let afterDashes = false;
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i] as string;
      if (afterDashes) continue;
      if (arg === '--') {
        afterDashes = true;
      } else if (arg === '-m') {
        i++; // the message is a value, whatever it starts with
        if (i >= rest.length) return 'commit -m needs a message';
      } else if (!COMMIT_OPTIONS.has(arg)) {
        return `commit option ${JSON.stringify(arg.split('=')[0])} is not allowed`;
      }
    }
  }
  return null;
}

function spawnGit(args: readonly string[], cwd: string, env: Record<string, string>, timeoutMs: number) {
  return spawnSync('git', [...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The repository's filter drivers, read with a configuration query (which runs nothing). A query that finds
// no match exits 1; any other failure leaves the list empty and the real command reports its own error.
function filterOverrides(cwd: string): ConfigEntry[] {
  const queried = spawnGit(['config', '--name-only', '--get-regexp', '^filter\\..+\\.(clean|smudge|process|required)$'], cwd, safeGitEnv(), DEFAULT_GIT_TIMEOUT_MS);
  if (queried.error || queried.status !== 0) return [];
  const drivers = new Set<string>();
  for (const line of (queried.stdout ?? '').split('\n')) {
    const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/i.exec(line.trim());
    if (match?.[1] !== undefined) drivers.add(match[1]);
  }
  const entries: ConfigEntry[] = [];
  for (const driver of [...drivers].sort()) {
    entries.push([`filter.${driver}.clean`, ''], [`filter.${driver}.smudge`, ''], [`filter.${driver}.process`, ''], [`filter.${driver}.required`, 'false']);
  }
  return entries;
}

export function runGit(args: readonly string[], options: RunGitOptions): Result<GitOutput> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const refusal = refuseUnsafeArgs(args);
  if (refusal !== null) return err({ kind: 'invalid', field: 'git argv', reason: refusal });
  const extraConfig: ConfigEntry[] = [
    ...(options.neutralizeFilters === true ? filterOverrides(options.cwd) : []),
    ...(options.noUserExcludes === true ? ([['core.excludesFile', '/dev/null']] as const) : []),
    ...(options.identity !== undefined
      ? ([['user.name', options.identity.name], ['user.email', options.identity.email], ['commit.gpgsign', 'false']] as const)
      : []),
    ...(options.fsck === true ? ([['transfer.fsckObjects', 'true'], ['fetch.fsckObjects', 'true']] as const) : []),
    // A fetch into the user's repository must not start a repack or a prune of it as a side effect.
    ...(args[0] === 'fetch' ? ([['gc.auto', '0'], ['maintenance.auto', 'false']] as const) : []),
  ];
  const env = safeGitEnv(process.env, extraConfig);
  if (options.indexFile !== undefined) {
    if (!isAbsolute(options.indexFile)) return err({ kind: 'invalid', field: 'indexFile', reason: 'an absolute path is required' });
    env['GIT_INDEX_FILE'] = options.indexFile;
  }
  if (options.literalPathspecs === true) env['GIT_LITERAL_PATHSPECS'] = '1';
  const result = spawnGit(args, options.cwd, env, timeoutMs);
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') return err({ kind: 'timeout', afterMs: timeoutMs, sideEffect: 'unknown' });
    return err({ kind: 'unavailable', cause: `git could not run: ${code ?? result.error.message}` });
  }
  if (result.status !== 0 && !(result.status !== null && (options.acceptExit ?? []).includes(result.status))) {
    const reason = (result.stderr ?? '').trim().split('\n')[0] ?? '';
    return err({ kind: 'internal', cause: `git ${args[0] ?? ''} exited ${result.status ?? `by signal ${result.signal ?? 'unknown'}`}: ${reason}` });
  }
  return ok({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
}
