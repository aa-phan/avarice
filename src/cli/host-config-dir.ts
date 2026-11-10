// The host configuration directory of a run (plan 03-43; owner decision 1 of 2026-11-10; SC3, AUT-5, AUT-12). `claude -p --resume` looks for a session only in the
// configuration directory of the process that launches it, and the skills root and the gsd-core lookup follow the same directory. A run started from one terminal
// and answered from another therefore lost the session it had paused (the repeated exit, plan 03-42). `start` records the directory it ran under as the run step
// `host:config-dir`; every supervisor of the run is then launched with that directory (`supervisorEnv`), and `decide`, `resume` and `supervise` refuse when it
// cannot be honoured. A run with no such step (one started before this) behaves as it always did.
import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AppDeps } from '../app/deps.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';

export const HOST_CONFIG_DIR_STEP = 'host:config-dir';

export type HostConfigDirSource = 'CLAUDE_CONFIG_DIR' | 'default';

const isSet = (value: string | undefined): value is string => value !== undefined && value !== '';

export const hostConfigDirSource = (env: NodeJS.ProcessEnv): HostConfigDirSource => (isSet(env['CLAUDE_CONFIG_DIR']) ? 'CLAUDE_CONFIG_DIR' : 'default');

// The directory the host uses: CLAUDE_CONFIG_DIR when set and not empty, else <home>/.claude, the rule the composition applies to the skills root and the gsd
// options (the two must agree). Made absolute, and resolved to its real path when it exists, so that two spellings of one directory compare equal.
export function effectiveHostConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env['CLAUDE_CONFIG_DIR'];
  const absolute = resolve(isSet(configured) ? configured : join(home, '.claude'));
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

// The home the composition resolves: $HOME when set and not empty, else the OS answer (carried on the deps).
function homeOf(deps: AppDeps, env: NodeJS.ProcessEnv): string {
  return deps.home ?? (isSet(env['HOME']) ? env['HOME'] : homedir());
}

// Records the directory the calling process runs the host under as the run's `host:config-dir` step: { claudeConfigDir, source }.
export function recordRunHostConfigDir(deps: AppDeps, runId: string, env: NodeJS.ProcessEnv = process.env): Result<void> {
  const nowMs = deps.clock.nowMs();
  const recorded = deps.ledger.recordRunStep(runId, {
    step: HOST_CONFIG_DIR_STEP,
    status: 'completed',
    result: { claudeConfigDir: effectiveHostConfigDir(env, homeOf(deps, env)), source: hostConfigDirSource(env) },
    nowMs,
    completedAtMs: nowMs,
  });
  return recorded.ok ? ok(undefined) : err(recorded.error);
}

// The directory recorded for a run, or undefined when it has none (a run started before this was recorded, or a run that cannot be read).
export function recordedHostConfigDir(deps: AppDeps, runId: string): string | undefined {
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return undefined;
  const latest = steps.value.filter((s) => s.step === HOST_CONFIG_DIR_STEP && s.status === 'completed').at(-1);
  const body = typeof latest?.result === 'object' && latest.result !== null ? (latest.result as Record<string, unknown>) : {};
  const dir = body['claudeConfigDir'];
  return typeof dir === 'string' && dir !== '' ? dir : undefined;
}

// undefined when `dir` is an existing directory this process can read and list, otherwise a short reason.
export function hostConfigDirProblem(dir: string): 'missing' | 'not a directory' | 'unreadable' | undefined {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
  if (!isDirectory) return 'not a directory';
  try {
    accessSync(dir, constants.R_OK | constants.X_OK);
    readdirSync(dir);
  } catch {
    return 'unreadable';
  }
  return undefined;
}

// The refusal `decide` and `resume` share, or undefined when the run has no recorded directory or the recorded one can be used. It names the directory, says
// it was recorded when the run started, and says what to do.
export function unhonouredHostConfigDir(deps: AppDeps, runId: string): string | undefined {
  const dir = recordedHostConfigDir(deps, runId);
  if (dir === undefined) return undefined;
  const problem = hostConfigDirProblem(dir);
  return problem === undefined ? undefined : `the run's host configuration directory ${dir}, recorded when it started, is ${problem}; restore it, or run this from an environment where it exists`;
}

// The directory the calling process would run the host under (the environment of this process, the home of the composition).
export function processHostConfigDir(deps: AppDeps, env: NodeJS.ProcessEnv = process.env): string {
  return effectiveHostConfigDir(env, homeOf(deps, env));
}
