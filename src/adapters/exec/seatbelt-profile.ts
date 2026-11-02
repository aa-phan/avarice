// Seatbelt profile builder for the local CommandExecutor (T-01-36). The profile starts from `allow default`,
// then denies network and every file write, and allows writes back only for the declared subpaths, the
// system temp areas and the tty devices. Later rules win in a Seatbelt profile, which this order relies on:
//   1. (deny network*) (deny file-write*)
//   2. allow temp areas, /dev/null, /dev/dtracehelper, ttys
//   3. deny writes below each protected path (the command's working tree, which may itself sit under a temp area)
//   4. allow writes below each declared path (they win over step 3)
//   5. deny reads below each denyRead path
// Every path is resolved to its real location first (Seatbelt matches the resolved path, and macOS /tmp and
// /var are symlinks). A path with a character that could end or alter a profile string is refused, not escaped.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { realpathNearest } from '../fs/profile-paths.ts';

export interface SeatbeltInput {
  // Subtrees the command may write.
  writePaths: readonly string[];
  // Subtrees the command may not read.
  denyReadPaths: readonly string[];
  // Subtrees closed for writing even when they lie under an allowed temp area; `writePaths` below them are
  // re-allowed. The executor passes the command's working directory.
  protectedPaths?: readonly string[];
}

// Where a command may always write: per-user temp and cache areas, /tmp, and the devices a process needs.
const TEMP_AREAS = ['/private/var/folders', '/private/tmp'];

function canonical(path: string): Result<string> {
  if (typeof path !== 'string' || path.length === 0 || !path.startsWith('/')) return err({ kind: 'invalid', field: 'path', reason: `${JSON.stringify(path)} is not an absolute path` });
  if (/["\n\r\0\\]/.test(path)) return err({ kind: 'invalid', field: 'path', reason: `${JSON.stringify(path)} contains a character a sandbox profile cannot carry` });
  let real: string;
  try {
    real = realpathNearest(path);
  } catch (e) {
    return err({ kind: 'invalid', field: 'path', reason: `${JSON.stringify(path)} cannot be resolved: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }
  if (/["\n\r\0\\]/.test(real)) return err({ kind: 'invalid', field: 'path', reason: `${JSON.stringify(real)} contains a character a sandbox profile cannot carry` });
  return ok(real);
}

function all(paths: readonly string[]): Result<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    const resolved = canonical(path);
    if (!resolved.ok) return resolved;
    out.push(resolved.value);
  }
  return ok(out);
}

export function buildSeatbeltProfile(input: SeatbeltInput): Result<string> {
  const writes = all(input.writePaths);
  if (!writes.ok) return writes;
  const denyReads = all(input.denyReadPaths);
  if (!denyReads.ok) return denyReads;
  const protectedPaths = all(input.protectedPaths ?? []);
  if (!protectedPaths.ok) return protectedPaths;

  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* ${TEMP_AREAS.map((p) => `(subpath "${p}")`).join(' ')} (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
  ];
  for (const path of protectedPaths.value) lines.push(`(deny file-write* (subpath "${path}"))`);
  for (const path of writes.value) lines.push(`(allow file-write* (subpath "${path}"))`);
  for (const path of denyReads.value) lines.push(`(deny file-read* (subpath "${path}"))`);
  return ok(lines.join('\n') + '\n');
}
