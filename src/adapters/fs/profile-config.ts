// The notify section of the profile config (D-21). The config is a hand-edited JSON file at <configHome>/profiles/<profile>/config.json;
// AVARICE never writes the notify section. A missing file or section means the defaults.
import { readFileSync } from 'node:fs';
import { parseProfileNotify, NOTIFY_DEFAULTS } from '../../domain/notify-policy.ts';
import type { ProfileNotify } from '../../domain/notify-policy.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { configPathFor } from './profile-paths.ts';

export function readProfileNotify(configHome: string, profile: string): Result<ProfileNotify> {
  const path = configPathFor(configHome, profile);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT') return ok(structuredClone(NOTIFY_DEFAULTS));
    return err({ kind: 'unavailable', cause: `cannot read the profile config: ${(e as { code?: unknown }).code ?? 'read failed'}` });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err({ kind: 'invalid', field: 'config', reason: 'the profile config is not valid JSON' });
  }
  return parseProfileNotify(raw);
}
