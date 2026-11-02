// Profile roots (SKELETON.md "Roots"). Config home, data root and work root come from the environment
// overrides or the defaults below. Directories are created with mode 0700. Plan 01-07 adds the root
// rules (no nesting, nothing under a ~/.claude* directory) here.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ResolvedProfile {
  profile: string;
  configHome: string;
  dataRoot: string;
  workRoot: string;
}

export const DEFAULT_PROFILE = 'personal-local';

export function resolveProfile(env: NodeJS.ProcessEnv): ResolvedProfile {
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
  for (const dir of [resolved.configHome, resolved.dataRoot, resolved.workRoot]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return resolved;
}
