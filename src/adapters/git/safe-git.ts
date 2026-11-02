// Safe git (ONB-4, SKELETON.md "Safe git", research Pattern 4). Every git subprocess AVARICE starts carries
// the same environment, so a repository's hooks, its `core.fsmonitor` command and an interactive prompt
// cannot run code or block while AVARICE inspects or stages the repository. Arguments are an argv array,
// never a shell string. Read-only calls must not refresh the user's index, hence GIT_OPTIONAL_LOCKS=0.
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
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
});

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
}

// Minimal environment: nothing from the caller's environment reaches git except what git needs to run.
export function safeGitEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    PATH: base['PATH'] && base['PATH'].length > 0 ? base['PATH'] : '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin',
    HOME: base['HOME'] ?? '',
    LANG: base['LANG'] && base['LANG'].length > 0 ? base['LANG'] : 'C',
    ...SAFE_GIT_ENV,
  };
}

export function runGit(args: readonly string[], options: RunGitOptions): Result<GitOutput> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const result = spawnSync('git', [...args], {
    cwd: options.cwd,
    env: safeGitEnv(),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
