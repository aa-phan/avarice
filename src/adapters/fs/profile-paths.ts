// Profile roots (SKELETON.md "Roots"). Config home, data root and work root come from the environment
// overrides or the defaults below. Before anything is created, each root is resolved through its nearest
// existing ancestor's realpath and judged by checkRoots (nothing under a ~/.claude* directory or under
// realpath($CLAUDE_CONFIG_DIR), never nested) and the data root must sit on a local mount. Only then are the
// directories created (0700) and config.json written (0600) when absent. The returned paths are the resolved
// (not realpath'd) paths, so they match what the user configured.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { checkRoots } from '../../domain/root-rules.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { isLocalMount } from './local-mount.ts';

export interface ResolvedProfile {
  profile: string;
  configHome: string;
  dataRoot: string;
  workRoot: string;
}

export interface ProfileProbes {
  // Replaces the `mount` based check. Tests only; production passes nothing.
  isLocalMount?: (path: string) => Result<boolean>;
}

export const DEFAULT_PROFILE = 'personal-local';
export const CONFIG_SCHEMA = 1;

// realpath of the nearest existing ancestor of `path`, followed by the segments that do not exist yet.
export function realpathNearest(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      const real = realpathSync(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const parent = dirname(current);
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === current) throw e;
      missing.push(basename(current));
      current = parent;
    }
  }
}

export function configPathFor(configHome: string, profile: string): string {
  return join(configHome, 'profiles', profile, 'config.json');
}

export function resolveProfile(env: NodeJS.ProcessEnv, probes: ProfileProbes = {}): Result<ResolvedProfile> {
  try {
    const home = env['HOME'] && env['HOME'].length > 0 ? env['HOME'] : homedir();
    const pick = (name: string, fallback: string): string => {
      const value = env[name];
      return resolve(value && value.length > 0 ? value : fallback);
    };
    const profile = DEFAULT_PROFILE;
    const resolved: ResolvedProfile = {
      profile,
      configHome: pick('AVARICE_CONFIG_HOME', join(home, '.config', 'avarice')),
      dataRoot: pick('AVARICE_DATA_ROOT', join(home, '.local', 'share', 'avarice', profile)),
      workRoot: pick('AVARICE_WORK_ROOT', join(home, '.local', 'share', 'avarice-work', profile)),
    };

    const claudeConfigDir = pick('CLAUDE_CONFIG_DIR', join(home, '.claude'));
    const dataReal = realpathNearest(resolved.dataRoot);
    const checked = checkRoots({
      home: realpathNearest(home),
      claudeConfigDirReal: realpathNearest(claudeConfigDir),
      dataRoot: dataReal,
      workRoot: realpathNearest(resolved.workRoot),
    });
    if (!checked.ok) return checked;

    const local = (probes.isLocalMount ?? isLocalMount)(dataReal);
    if (!local.ok) return err({ kind: 'unavailable', cause: `cannot confirm that the data root '${resolved.dataRoot}' is on local storage: ${describeCause(local.error)}` });
    if (!local.value) {
      return err({
        kind: 'invalid',
        field: 'dataRoot',
        reason: `the data root '${resolved.dataRoot}' is on a network or non-local mount (no 'local' flag); SQLite WAL is unsafe there. Choose a directory on local storage (set AVARICE_DATA_ROOT)`,
      });
    }

    for (const dir of [resolved.configHome, resolved.dataRoot, resolved.workRoot, dirname(configPathFor(resolved.configHome, profile))]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      writeFileSync(
        configPathFor(resolved.configHome, profile),
        JSON.stringify({ schema: CONFIG_SCHEMA, profile, dataRoot: resolved.dataRoot, workRoot: resolved.workRoot }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    } catch (e) {
      if ((e as { code?: unknown }).code !== 'EEXIST') throw e;
    }
    return ok(resolved);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot prepare the profile directories: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function describeCause(error: { kind: string; cause?: string }): string {
  return error.cause ?? error.kind;
}
