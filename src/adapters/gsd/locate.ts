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
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import { gsdEnv, gsdToolsPath } from './gsd-tools.ts';

const ADMITTED_VERSION = /^1\.17\.\d+$/;
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

export function locateGsdCore(env: NodeJS.ProcessEnv): Result<LocatedGsd> {
  const candidates = gsdCandidates(env);
  const dir = candidates.find((candidate) => isFile(gsdToolsPath(candidate)));
  if (dir === undefined) {
    return err({ kind: 'not_found', ref: candidates.length === 0 ? 'gsd-core (no GSD_HOME, CLAUDE_CONFIG_DIR or HOME set)' : `gsd-core (probed ${candidates.join(', ')})` });
  }

  const ran = spawnSync(process.execPath, [gsdToolsPath(dir), 'runtime-identity', '--raw'], {
    cwd: tmpdir(),
    env: gsdEnv(env, dir),
    encoding: 'utf8',
    timeout: IDENTITY_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ran.error || ran.status !== 0) {
    return unsupported(`${dir}: runtime-identity did not run (${ran.error ? ((ran.error as NodeJS.ErrnoException).code ?? ran.error.message) : `exit ${String(ran.status)}`})`);
  }
  let identity: unknown;
  try {
    identity = JSON.parse((ran.stdout ?? '').trim());
  } catch {
    return unsupported(`${dir}: runtime-identity did not print JSON`);
  }
  const packageName = typeof identity === 'object' && identity !== null ? (identity as Record<string, unknown>)['packageName'] : undefined;
  const version = typeof identity === 'object' && identity !== null ? (identity as Record<string, unknown>)['version'] : undefined;
  if (typeof packageName !== 'string' || typeof version !== 'string') return unsupported(`${dir}: runtime-identity names no package and version`);
  if (packageName !== GSD_ADMITTED_PACKAGE) return unsupported(`found ${packageName} ${version} at ${dir}, not ${GSD_ADMITTED_PACKAGE}`);
  if (!ADMITTED_VERSION.test(version)) return unsupported(`found ${packageName} ${version} at ${dir}`);
  return ok({ gsdCoreDir: dir, version, packageName });
}
