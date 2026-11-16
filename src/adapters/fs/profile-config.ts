// The profile config (SEC-1, OPS-5, D-21). The config is a hand-edited JSON file at <configHome>/profiles/<profile>/config.json; AVARICE
// writes it once, when it is absent, with the profile and its two roots, and never rewrites it. Every command reads it back: the roots it
// names are the profile's roots, and its sections (notify, limits, policy, ...) are handed raw to the module that owns each. A missing file
// means the defaults. The file is opened without following a symlink and read only when it is a regular file of at most 64 KiB, so a
// planted link or a huge file cannot steer a command or stall a notification.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProfileNotify } from '../../domain/notify-policy.ts';
import type { ProfileNotify } from '../../domain/notify-policy.ts';
import { parseProfileConfig, parseProfileName, profileClass } from '../../domain/profile.ts';
import type { ProfileConfig } from '../../domain/profile.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export const MAX_PROFILE_CONFIG_BYTES = 64 * 1024;

export function configPathFor(configHome: string, profile: string): string {
  return join(configHome, 'profiles', profile, 'config.json');
}

// The parsed config of `profile`, or the defaults when the file is absent. A symbolic link, a file that is not regular, a file over the cap,
// text that is not JSON and a file the parser refuses are `invalid`; any other failure to read is `unavailable`.
export function readProfileConfig(configHome: string, profile: string): Result<ProfileConfig> {
  const named = parseProfileName(profile);
  if (!named.ok) return named;
  const path = configPathFor(configHome, profile);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 'ENOENT') return ok({ schema: 1, id: profile, class: profileClass(profile), sections: {} });
    if (code === 'ELOOP') return err({ kind: 'invalid', field: 'config', reason: 'the profile config is a symbolic link, which is refused' });
    return err({ kind: 'unavailable', cause: `cannot read the profile config: ${typeof code === 'string' ? code : 'open failed'}` });
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return err({ kind: 'invalid', field: 'config', reason: 'the profile config is not a regular file' });
    if (info.size > MAX_PROFILE_CONFIG_BYTES) return err({ kind: 'invalid', field: 'config', reason: `the profile config is larger than ${MAX_PROFILE_CONFIG_BYTES} bytes` });
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(fd, 'utf8'));
    } catch {
      return err({ kind: 'invalid', field: 'config', reason: 'the profile config is not valid JSON' });
    }
    return parseProfileConfig(raw, profile);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot read the profile config: ${(e as { code?: unknown }).code === undefined ? 'read failed' : String((e as { code?: unknown }).code)}` });
  } finally {
    closeSync(fd);
  }
}

// The notify section of the profile config. A missing file or section means the defaults.
export function readProfileNotify(configHome: string, profile: string): Result<ProfileNotify> {
  const config = readProfileConfig(configHome, profile);
  if (!config.ok) return config;
  const notify = config.value.sections.notify;
  return parseProfileNotify(notify === undefined ? {} : { notify });
}
