// SQLite version gate (ADR-001). Stub: the rule arrives with the GREEN commit.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export function checkSqliteVersion(_version: string): Result<void> {
  return ok(undefined);
}
