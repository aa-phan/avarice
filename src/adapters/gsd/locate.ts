// gsd-core discovery (ONB-12, T-01-18). The config directory is never hard-coded: candidates come from
// GSD_HOME, $CLAUDE_CONFIG_DIR/gsd-core (only when CLAUDE_CONFIG_DIR is set) and $HOME/.claude/gsd-core, in
// that order. The first candidate that holds bin/gsd-tools.cjs is the one examined; it is admitted only when
// `runtime-identity --raw` names @opengsd/gsd-core at a 1.17.x version. A candidate that is found but not
// admitted is an `unsupported` result, never a reason to try the next one (an explicit GSD_HOME must not be
// silently replaced by another installation).
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gsdVersionAdmitted } from '../../domain/gsd-version.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import { gsdEnv, gsdToolsPath } from './gsd-tools.ts';

const IDENTITY_TIMEOUT_MS = 5_000;

export interface LocatedGsd {
  gsdCoreDir: string;
  version: string;
  packageName: string;
}

export function gsdCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const gsdHome = env['GSD_HOME'];
  if (gsdHome !== undefined && gsdHome !== '') candidates.push(gsdHome);
  const configDir = env['CLAUDE_CONFIG_DIR'];
  if (configDir !== undefined && configDir !== '') candidates.push(join(configDir, 'gsd-core'));
  const home = env['HOME'];
  if (home !== undefined && home !== '') candidates.push(join(home, '.claude', 'gsd-core'));
  return candidates;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function unsupported(detail: string): Result<never> {
  return err({
    kind: 'unsupported',
    capability: 'gsd-core',
    reducedMode: `none: onboarding stops as incompatible; the admitted distribution is ${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}`,
    detail,
  });
}

// What the candidate directories hold, before any judgement of the version: `absent` when none has bin/gsd-tools.cjs, `unreadable` when the first one that has it
// does not answer `runtime-identity` with a package and a version, `found` otherwise. `doctor` reports a found version even when it is outside the admitted line,
// and bounds the probe with its own timeout.
export type GsdIdentity =
  | { state: 'absent'; searched: string[] }
  | { state: 'unreadable'; dir: string; detail: string }
  | { state: 'found'; dir: string; packageName: string; version: string };

export function identifyGsdCore(env: NodeJS.ProcessEnv, timeoutMs: number = IDENTITY_TIMEOUT_MS): GsdIdentity {
  const candidates = gsdCandidates(env);
  const dir = candidates.find((candidate) => isFile(gsdToolsPath(candidate)));
  if (dir === undefined) return { state: 'absent', searched: candidates };

  const ran = spawnSync(process.execPath, [gsdToolsPath(dir), 'runtime-identity', '--raw'], {
    cwd: tmpdir(),
    env: gsdEnv(env, dir),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ran.error || ran.status !== 0) {
    return { state: 'unreadable', dir, detail: `${dir}: runtime-identity did not run (${ran.error ? ((ran.error as NodeJS.ErrnoException).code ?? ran.error.message) : `exit ${String(ran.status)}`})` };
  }
  let identity: unknown;
  try {
    identity = JSON.parse((ran.stdout ?? '').trim());
  } catch {
    return { state: 'unreadable', dir, detail: `${dir}: runtime-identity did not print JSON` };
  }
  const packageName = typeof identity === 'object' && identity !== null ? (identity as Record<string, unknown>)['packageName'] : undefined;
  const version = typeof identity === 'object' && identity !== null ? (identity as Record<string, unknown>)['version'] : undefined;
  if (typeof packageName !== 'string' || typeof version !== 'string') return { state: 'unreadable', dir, detail: `${dir}: runtime-identity names no package and version` };
  return { state: 'found', dir, packageName, version };
}

export function locateGsdCore(env: NodeJS.ProcessEnv): Result<LocatedGsd> {
  const identity = identifyGsdCore(env);
  if (identity.state === 'absent') {
    const candidates = identity.searched;
    return err({ kind: 'not_found', ref: candidates.length === 0 ? 'gsd-core (no GSD_HOME, CLAUDE_CONFIG_DIR or HOME set)' : `gsd-core (probed ${candidates.join(', ')})` });
  }
  if (identity.state === 'unreadable') return unsupported(identity.detail);
  const { dir, packageName, version } = identity;
  if (packageName !== GSD_ADMITTED_PACKAGE) return unsupported(`found ${packageName} ${version} at ${dir}, not ${GSD_ADMITTED_PACKAGE}`);
  if (!gsdVersionAdmitted(version)) return unsupported(`found ${packageName} ${version} at ${dir}`);
  return ok({ gsdCoreDir: dir, version, packageName });
}
