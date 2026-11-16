// Profile roots (SKELETON.md "Roots"). Config home, data root and work root come from the environment
// overrides, else (data and work roots) from the profile's own config.json, else the defaults below. The config is read back on every
// command, so the roots it names are the profile's roots; the three variables override only the profile that was selected. Before
// anything is created, each root is resolved through its nearest existing ancestor's realpath and judged by checkRoots (nothing under a
// ~/.claude* directory or under realpath($CLAUDE_CONFIG_DIR), never nested) and the data root must sit on a local mount. Only then are the
// directories created (0700) and config.json written (0600) when absent. The returned paths are the resolved
// (not realpath'd) paths, so they match what the user configured.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_PROFILE_NAME, parseProfileName, profileClass } from '../../domain/profile.ts';
import type { ProfileClass, ProfileConfig } from '../../domain/profile.ts';
import { checkRoots } from '../../domain/root-rules.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { isLocalMount } from './local-mount.ts';
import { configPathFor, readProfileConfig } from './profile-config.ts';

export { configPathFor };

export interface ResolvedProfile {
  profile: string;
  class: ProfileClass;
  // The parsed config.json of the profile; the defaults, with the roots in use, when the file did not exist.
  config: ProfileConfig;
  configHome: string;
  dataRoot: string;
  workRoot: string;
}

export interface ProfileProbes {
  // Replaces the `mount` based check. Tests only; production passes nothing.
  isLocalMount?: (path: string) => Result<boolean>;
}

export const DEFAULT_PROFILE = DEFAULT_PROFILE_NAME;
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

// The config home, decided from the environment alone: nothing is created. Profile selection reads the binding registry and the
// enterprise profile configs from here before any profile is resolved.
export function resolveConfigHome(env: NodeJS.ProcessEnv): string {
  const value = env['AVARICE_CONFIG_HOME'];
  if (value && value.length > 0) return resolve(value);
  const home = env['HOME'] && env['HOME'].length > 0 ? env['HOME'] : homedir();
  return resolve(join(home, '.config', 'avarice'));
}

// A root written in the config: absolute, or starting with `~/` for the home directory.
export function configRoot(value: string | undefined, home: string, field: 'dataRoot' | 'workRoot'): Result<string | undefined> {
  if (value === undefined) return ok(undefined);
  const expanded = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(expanded)) return err({ kind: 'invalid', field, reason: `${field} in the profile config must be an absolute path or start with ~/` });
  return ok(expanded);
}

// `profileName` is a name that already follows the profile grammar (parseProfileName): it becomes a path segment. Each root is the
// environment override when one is set (it applies to the profile that was selected, whichever it is), else the root the profile's config
// names, else the default.
export function resolveProfile(env: NodeJS.ProcessEnv, probes: ProfileProbes = {}, profileName: string = DEFAULT_PROFILE): Result<ResolvedProfile> {
  const named = parseProfileName(profileName);
  if (!named.ok) return named;
  try {
    const home = env['HOME'] && env['HOME'].length > 0 ? env['HOME'] : homedir();
    const pick = (name: string, fallback: string): string => {
      const value = env[name];
      return resolve(value && value.length > 0 ? value : fallback);
    };
    const profile = profileName;
    const configHome = resolveConfigHome(env);
    const read = readProfileConfig(configHome, profile);
    if (!read.ok) return read;
    const configured = { dataRoot: configRoot(read.value.dataRoot, home, 'dataRoot'), workRoot: configRoot(read.value.workRoot, home, 'workRoot') };
    if (!configured.dataRoot.ok) return configured.dataRoot;
    if (!configured.workRoot.ok) return configured.workRoot;
    const resolved: ResolvedProfile = {
      profile,
      class: profileClass(profile),
      config: read.value,
      configHome,
      dataRoot: pick('AVARICE_DATA_ROOT', configured.dataRoot.value ?? join(home, '.local', 'share', 'avarice', profile)),
      workRoot: pick('AVARICE_WORK_ROOT', configured.workRoot.value ?? join(home, '.local', 'share', 'avarice-work', profile)),
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
      resolved.config = { ...resolved.config, dataRoot: resolved.dataRoot, workRoot: resolved.workRoot };
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
