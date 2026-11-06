// Seatbelt profile builder for the local CommandExecutor (T-01-36). The profile starts from `allow default`,
// then denies network and every file write, and allows writes back only for the declared subpaths, the
// system temp areas and the tty devices. Later rules win in a Seatbelt profile, which this order relies on:
//   1. (deny network*) (deny file-write*)
//   2. allow outbound connections to localhost:<port> for each allowLoopbackPorts entry (none by default)
//   3. allow temp areas, /dev/null, /dev/dtracehelper, ttys
//   4. deny writes below each protected path (the command's working tree, which may itself sit under a temp area)
//   5. allow writes below each declared path (they win over step 4)
//   6. deny reads below each denyRead path
//   7. allow reads below each allowRead path (they win over step 6: a run's own clone below a denied work-root parent)
//   8. allow the metadata (not the contents, not a listing) of each directory above an allowRead path that lies inside a denied one, so
//      a program can resolve the real path of a file below it
// Seatbelt cannot filter by host name (`host must be * or localhost`), so the only network a command can be given is one
// loopback port; the registry-only path is an allowlisting proxy listening there (D-11).
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
  // Subtrees readable again below a denied one; the rule follows every denial, so it wins.
  allowReadPaths?: readonly string[];
  // Subtrees closed for writing even when they lie under an allowed temp area; `writePaths` below them are
  // re-allowed. The executor passes the command's working directory.
  protectedPaths?: readonly string[];
  // Loopback ports the command may connect to; every other network target stays denied. Only AVARICE supervisor steps
  // set it, never an agent invocation (D-11).
  allowLoopbackPorts?: readonly number[];
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
  const allowReads = all(input.allowReadPaths ?? []);
  if (!allowReads.ok) return allowReads;
  const protectedPaths = all(input.protectedPaths ?? []);
  if (!protectedPaths.ok) return protectedPaths;

  const ports = input.allowLoopbackPorts ?? [];
  for (const port of ports) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return err({ kind: 'invalid', field: 'allowLoopbackPorts', reason: `${JSON.stringify(port)} is not an integer from 1 to 65535` });
    }
  }

  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    ...ports.map((port) => `(allow network-outbound (remote ip "localhost:${port}"))`),
    `(allow file-write* ${TEMP_AREAS.map((p) => `(subpath "${p}")`).join(' ')} (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
  ];
  for (const path of protectedPaths.value) lines.push(`(deny file-write* (subpath "${path}"))`);
  for (const path of writes.value) lines.push(`(allow file-write* (subpath "${path}"))`);
  for (const path of denyReads.value) lines.push(`(deny file-read* (subpath "${path}"))`);
  for (const path of allowReads.value) lines.push(`(allow file-read* (subpath "${path}"))`);
  // A program resolves the real path of a file with an lstat of every directory above it (node does for its main script), and the
  // directories on the way to a re-allowed path lie inside the denied subtree. Their metadata is given back, one literal each: no
  // listing, no content, no sibling (plan 02-21: every npm script of a profile under the default parents died on `lstat <work parent>`).
  for (const path of ancestorsInside(allowReads.value, denyReads.value)) lines.push(`(allow file-read-metadata (literal "${path}"))`);
  return ok(lines.join('\n') + '\n');
}

// The proper ancestors of each allowed path that sit inside a denied subtree (a denied path itself included), once each, outermost first.
function ancestorsInside(allowed: readonly string[], denied: readonly string[]): string[] {
  const found = new Set<string>();
  for (const path of allowed) {
    const segments = path.split('/').filter((segment) => segment !== '');
    for (let depth = 1; depth < segments.length; depth++) {
      const ancestor = `/${segments.slice(0, depth).join('/')}`;
      if (denied.some((deny) => ancestor === deny || ancestor.startsWith(`${deny}/`))) found.add(ancestor);
    }
  }
  return [...found].sort((a, b) => a.length - b.length);
}
