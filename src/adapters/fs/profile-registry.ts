// The other profiles on this machine (SEC-1, D-19). A run's sandbox denies the roots of every profile but its own. The default parents cover the
// default roots; a profile whose data root, work root or config home were moved by an environment variable sits outside them, and is named only
// by its own config: <configHome>/profiles/<profile>/config.json, written once with the roots in use and read back on every command.
//
// The registry reads those configs and returns paths to deny, so a planted or hostile file can only add a deny, never open a path. Each config is
// read as the profile config always is (no link followed, a regular file, a size cap, the closed key set); a directory that is not a profile
// name, a profile directory that is a link, a file that does not parse and a root that is not absolute are skipped. A config that exists but
// cannot be read (as opposed to one that is corrupt) is a refusal of the system or a failure. When permissions or a sandbox refused it (EACCES, EPERM) the registry
// denies the whole root of that profile (its profile directory and the default roots of its name) and goes on: "deny, don't refuse", so a profile the caller may not
// read never stops the commands of another. Any other failure to read is `unavailable` and stops the computation. A profile whose config home was never seen from
// here cannot be found, and a profile whose config is refused cannot say where it moved its roots; those residuals are documented.
import { lstatSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseProfileName } from '../../domain/profile.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { isPermissionRefusal, readProfileConfig } from './profile-config.ts';
import { configRoot, defaultDataRoot, defaultWorkRoot, realpathNearest, resolveConfigHome } from './profile-paths.ts';

export interface KnownProfileOptions {
  // The home the default config home is taken from, when this config home was moved, and a leading `~/` of a configured root is expanded against.
  home: string;
  // The roots of the selected profile itself, which are never returned.
  ownDataRoot: string;
  ownWorkRoot: string;
}

const unavailable = (cause: string): Result<never> => err({ kind: 'unavailable', cause });

// realpath of `path` as far as the system lets it be resolved: a path below a directory whose metadata a sandbox denies (EPERM, EACCES) is resolved up to that directory
// and the rest is kept as written. A path that does not exist yet is resolved to its nearest existing ancestor, as realpathNearest does.
function realpathBeyondDenial(path: string): string {
  const unresolved: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathNearest(current), ...unresolved.reverse());
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const parent = dirname(current);
      if ((code !== 'EACCES' && code !== 'EPERM') || parent === current) throw e;
      unresolved.push(basename(current));
      current = parent;
    }
  }
}

// The whole root of a profile whose config could not be read: its profile directory in the config home it was found in, and the default data root and work root of its
// name. A root the profile moved off those is named only by the config that was refused, so it cannot be listed.
function wholeRootOf(home: string, profile: string, defaultsHome: string): string[] {
  return [join(home, 'profiles', profile), defaultDataRoot(defaultsHome, profile), defaultWorkRoot(defaultsHome, profile)].map(realpathBeyondDenial);
}

// The data root and work root of every profile config under this config home and the default one, except the selected profile's own roots, and the
// config homes themselves (the one in use and the default), all realpath'd and listed once. An unreadable profiles directory is `unavailable`: a deny
// list that could not be computed must not read as an empty one.
export function knownProfileRoots(configHome: string, selected: string, options: KnownProfileOptions): Result<string[]> {
  try {
    const own = new Set([realpathNearest(options.ownDataRoot), realpathNearest(options.ownWorkRoot)]);
    const homes = [...new Set([realpathNearest(configHome), realpathNearest(resolveConfigHome({ HOME: options.home }))])];
    const inUse = realpathNearest(configHome);
    const roots = new Set<string>();
    for (const home of homes) {
      let entries: Dirent[];
      try {
        entries = readdirSync(join(home, 'profiles'), { withFileTypes: true });
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        return unavailable(`cannot list the profiles under ${home}: ${typeof code === 'string' ? code : 'read failed'}`);
      }
      for (const entry of entries.map((dirent) => dirent.name).sort()) {
        // A link or a file named like a profile is not a profile directory; a name outside the grammar is not a profile.
        if (!lstatSync(join(home, 'profiles', entry)).isDirectory() || !parseProfileName(entry).ok) continue;
        // The selected profile's own config, in the config home it runs from, names its own roots.
        if (home === inUse && entry === selected) continue;
        const config = readProfileConfig(home, entry);
        // A config that is corrupt is skipped, as documented above. One the system refused to read (permissions, a sandbox deny) has its whole root denied, and the
        // registry goes on. Any other config that exists but cannot be read (I/O) stops the computation, naming the profile: its moved roots would otherwise leave the
        // deny list, and a list that could not be computed must not read as a shorter one.
        if (!config.ok) {
          if (isPermissionRefusal(config.error)) {
            for (const root of wholeRootOf(home, entry, options.home)) if (!own.has(root)) roots.add(root);
            continue;
          }
          if (config.error.kind === 'unavailable') return unavailable(`cannot read the config of profile ${entry} under ${home}: ${config.error.cause}`);
          continue;
        }
        for (const [field, value] of [['dataRoot', config.value.dataRoot], ['workRoot', config.value.workRoot]] as const) {
          const root = configRoot(value, options.home, field);
          if (!root.ok || root.value === undefined) continue;
          const real = realpathNearest(root.value);
          if (!own.has(real)) roots.add(real);
        }
      }
    }
    for (const home of homes) roots.add(home);
    return ok([...roots]);
  } catch (e) {
    return unavailable(`cannot read the other profiles: ${e instanceof Error ? e.message : String(e)}`);
  }
}
