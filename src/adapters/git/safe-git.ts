// Safe git (ONB-4, SKELETON.md "Safe git", research Pattern 4). Every git subprocess AVARICE starts carries
// the same environment, so a repository's hooks, its `core.fsmonitor` command and an interactive prompt
// cannot run code or block while AVARICE inspects or stages the repository, and neither the machine's system
// configuration nor its system attributes change what git does. Arguments are an argv array, never a shell
// string. Read-only calls must not refresh the user's index, hence GIT_OPTIONAL_LOCKS=0.
//
// Two further guards live in this module only:
//  - a caller cannot pass `-c`, `--config-env` or `clone --config` (a caller-supplied configuration override
//    could re-enable what the environment turns off);
//  - `neutralizeFilters` blanks the clean, smudge and process commands of every `filter.<name>.*` driver the
//    repository defines for the one call, because git runs a clean filter to compare a working-tree file that
//    has the same size as its index entry, so `git status` of a repository with a hostile filter runs code.
import { spawnSync } from 'node:child_process';

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

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
  // Neutralize every filter driver of the repository at `cwd` for this call. Use it on every call that
  // compares or writes working-tree files (`status`, `diff`, `checkout`, `worktree add`).
  neutralizeFilters?: boolean;
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
  const env = safeGitEnv(process.env, options.neutralizeFilters === true ? filterOverrides(options.cwd) : []);
  const result = spawnGit(args, options.cwd, env, timeoutMs);
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') return err({ kind: 'timeout', afterMs: timeoutMs, sideEffect: 'unknown' });
    return err({ kind: 'unavailable', cause: `git could not run: ${code ?? result.error.message}` });
  }
  if (result.status !== 0) {
    const reason = (result.stderr ?? '').trim().split('\n')[0] ?? '';
    return err({ kind: 'internal', cause: `git ${args[0] ?? ''} exited ${result.status ?? `by signal ${result.signal ?? 'unknown'}`}: ${reason}` });
  }
  return ok({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
}
