// node:sqlite connection and transaction helpers (SKELETON.md "Persistence"; research Pattern 1).
// Every write is a BEGIN IMMEDIATE transaction, so a writer conflict surfaces at the start and a
// SIGKILLed writer's open transaction rolls back on the next open.
import { DatabaseSync } from 'node:sqlite';
import { ok, err } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';

export type Db = DatabaseSync;

// Thrown inside tx() to roll back and return a specific PortError.
export class LedgerAbort extends Error {
  readonly portError: PortError;
  constructor(portError: PortError) {
    super(describeError(portError));
    this.portError = portError;
  }
}

export function abort(error: PortError): never {
  throw new LedgerAbort(error);
}

export function describeError(error: PortError): string {
  switch (error.kind) {
    case 'invalid':
      return `invalid ${error.field}: ${error.reason}`;
    case 'conflict':
      return `conflict: expected ${error.expected}, found ${error.actual}`;
    case 'not_found':
      return `not found: ${error.ref}`;
    case 'unavailable':
      return `unavailable: ${error.cause}`;
    case 'internal':
      return `internal error: ${error.cause}`;
    default:
      return error.kind;
  }
}

interface SqliteErrorShape {
  code?: unknown;
  errcode?: unknown;
  errstr?: unknown;
  message?: unknown;
}

// Maps a thrown value to a PortError: errcode & 0xff of 5 (BUSY) or 6 (LOCKED) is unavailable, 19
// (CONSTRAINT) is conflict, a value with no canonical JSON form is invalid, anything else internal.
export function toPortError(e: unknown): PortError {
  if (e instanceof LedgerAbort) return e.portError;
  if (e instanceof TypeError && e.message.startsWith('no canonical form')) {
    return { kind: 'invalid', field: 'json', reason: e.message };
  }
  const shape = (typeof e === 'object' && e !== null ? e : {}) as SqliteErrorShape;
  const message = typeof shape.message === 'string' ? shape.message : String(e);
  if (shape.code === 'ERR_SQLITE_ERROR' && typeof shape.errcode === 'number') {
    const primary = shape.errcode & 0xff;
    const detail = typeof shape.errstr === 'string' ? shape.errstr : message;
    if (primary === 5 || primary === 6) return { kind: 'unavailable', cause: message };
    if (primary === 19) return { kind: 'conflict', expected: 'a write that satisfies the schema constraints', actual: detail + ': ' + message };
  }
  return { kind: 'internal', cause: message };
}

export interface OpenOptions {
  readOnly?: boolean;
}

// Opens the database (creating it unless read-only). Read-write opens switch to WAL and require the
// switch to take effect, because WAL on a filesystem that cannot share memory is unsafe (NFR-5).
export function openDb(path: string, options: OpenOptions = {}): Result<Db> {
  let db: DatabaseSync | undefined;
  try {
    const readOnly = options.readOnly === true;
    db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true, readOnly });
    if (!readOnly) {
      const mode = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | undefined;
      const actual = String(mode?.journal_mode ?? '').toLowerCase();
      if (actual !== 'wal' && !(path === ':memory:' && actual === 'memory')) {
        db.close();
        return err({ kind: 'unavailable', cause: `cannot enable WAL journal mode (got ${actual || 'none'}); the data root must be on local storage` });
      }
      db.exec('PRAGMA synchronous = FULL');
    } else {
      // Force a read so a file that is not a database is reported here, not at first use.
      db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    }
    return ok(db);
  } catch (e) {
    try {
      db?.close();
    } catch {
      // already closed or never opened
    }
    return err(toPortError(e));
  }
}

// Runs fn inside BEGIN IMMEDIATE. A throw rolls back every write fn made; a LedgerAbort comes back as
// its PortError, any other throw is mapped by toPortError.
export function tx<T>(db: Db, fn: () => T): Result<T> {
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (e) {
    return err(toPortError(e));
  }
  try {
    const value = fn();
    db.exec('COMMIT');
    return ok(value);
  } catch (e) {
    if (db.isTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // the connection is unusable; the original error is the one to report
      }
    }
    return err(toPortError(e));
  }
}
