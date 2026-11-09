// The notify section of the profile config (D-21). The config is a hand-edited JSON file at <configHome>/profiles/<profile>/config.json;
// AVARICE never writes the notify section. A missing file or section means the defaults. The file is opened without following a symlink
// and read only when it is a regular file of at most 64 KiB, so a planted link or a huge file cannot steer or stall a notification.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { parseProfileNotify, NOTIFY_DEFAULTS } from '../../domain/notify-policy.ts';
import type { ProfileNotify } from '../../domain/notify-policy.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { configPathFor } from './profile-paths.ts';

export const MAX_PROFILE_CONFIG_BYTES = 64 * 1024;

export function readProfileNotify(configHome: string, profile: string): Result<ProfileNotify> {
  const path = configPathFor(configHome, profile);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 'ENOENT') return ok(structuredClone(NOTIFY_DEFAULTS));
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
    return parseProfileNotify(raw);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot read the profile config: ${(e as { code?: unknown }).code === undefined ? 'read failed' : String((e as { code?: unknown }).code)}` });
  } finally {
    closeSync(fd);
  }
}
