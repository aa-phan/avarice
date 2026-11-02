// SQLite version gate (ADR-001; spike "SQLite on the minimum Node"). SQLite fixed the WAL-reset corruption
// bug in 3.51.3 on the 3.51 line, 3.50.7 on 3.50 and 3.44.6 on 3.44; 3.45 to 3.49 never received the fix, and
// every later line contains it. Anything older, or a version string this gate cannot read, is refused.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

const CAPABILITY = 'sqlite-wal-reset-fix';
const FIXED_PATCH_ON_LINE: Readonly<Record<number, number>> = { 44: 6, 50: 7, 51: 3 };
const LAST_LINE_WITH_BACKPORTS = 51;

function unsupported(detail: string): Result<void> {
  return err({ kind: 'unsupported', capability: CAPABILITY, reducedMode: 'none', detail });
}

export function checkSqliteVersion(version: string): Result<void> {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return unsupported(`SQLite version '${version}' is not recognised`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (major > 3) return ok(undefined);
  if (major < 3) return unsupported(`SQLite ${version} lacks the WAL-reset fix`);
  if (minor > LAST_LINE_WITH_BACKPORTS) return ok(undefined);
  const fixedPatch = FIXED_PATCH_ON_LINE[minor];
  if (fixedPatch !== undefined && patch >= fixedPatch) return ok(undefined);
  return unsupported(`SQLite ${version} lacks the WAL-reset fix`);
}
