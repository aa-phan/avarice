// node:sqlite connection and transaction helpers (SKELETON.md "Persistence"; research Pattern 1).
// Every write is a BEGIN IMMEDIATE transaction, so a writer conflict surfaces at the start and a
// SIGKILLed writer's open transaction rolls back on the next open.
import { chmodSync, closeSync, existsSync, openSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ok, err } from '../../domain/result.ts';
import { checkSqliteVersion } from '../../domain/runtime-support.ts';
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
    case 'unsupported':
      return error.detail ?? `unsupported: ${error.capability}`;
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
  // Replaces the sqlite_version() probe. Tests only; production never passes it.
  sqliteVersionProbe?: () => string;
  // The user ID treated as the current user when store ownership is checked. Tests only (a test cannot chown a file to another
  // user); production leaves it unset and the process's own user ID is used.
  currentUid?: number;
}

let probedVersion: string | undefined;

function bundledSqliteVersion(): string {
  if (probedVersion === undefined) {
    const probe = new DatabaseSync(':memory:');
    try {
      probedVersion = String((probe.prepare('select sqlite_version() as v').get() as { v: string }).v);
    } finally {
      probe.close();
    }
  }
  return probedVersion;
}

// Runtime gate (ADR-001): the SQLite bundled with this Node must contain the WAL-reset fix.
export function checkRuntime(probe: () => string = bundledSqliteVersion): Result<void> {
  let version: string;
  try {
    version = probe();
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot read the bundled SQLite version: ${e instanceof Error ? e.message : String(e)}` });
  }
  const verdict = checkSqliteVersion(version);
  if (verdict.ok) return verdict;
  return err({
    kind: 'unsupported',
    capability: 'sqlite-wal-reset-fix',
    reducedMode: 'none',
    detail: `Node ${process.version} bundles SQLite ${version} without the WAL-reset fix; install Node 22.22.3 or newer`,
  });
}

const STORE_SIBLINGS = ['', '-wal', '-shm'];

// The store file and its -wal and -shm siblings are the user's alone. Each one that exists must be owned by the current user,
// otherwise the store is refused (nothing is chmodded, nothing is opened). A read-write open then tightens an owned file that
// group or others can reach to 0600; a stricter mode (0400) is left alone, and a read-only open never changes a mode.
function secureStore(path: string, readOnly: boolean, uid: number | undefined): Result<void> {
  for (const suffix of STORE_SIBLINGS) {
    const file = `${path}${suffix}`;
    let stat;
    try {
      stat = statSync(file);
    } catch (e) {
      if ((e as { code?: unknown }).code === 'ENOENT') continue;
      return err({ kind: 'internal', cause: `cannot inspect ${file}: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (uid !== undefined && stat.uid !== uid) {
      return err({
        kind: 'unavailable',
        cause: `the store file ${file} is owned by user ${stat.uid}, not by the current user ${uid}; refusing to open it (use a data root you own, or take ownership of the file)`,
      });
    }
    if (!readOnly && (stat.mode & 0o077) !== 0) {
      try {
        chmodSync(file, 0o600);
      } catch (e) {
        return err({ kind: 'unavailable', cause: `cannot set ${file} to mode 0600: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }
  return ok(undefined);
}

// Opens the database (creating it unless read-only). The runtime gate runs first. A new store file is
// created with mode 0600 (SQLite gives its -wal and -shm files the same mode); an existing store the current user owns is
// tightened to 0600 and one another user owns is refused (secureStore). Read-write opens switch to WAL
// and require the switch to take effect, because WAL on a filesystem that cannot share memory is unsafe (NFR-5).
export function openDb(path: string, options: OpenOptions = {}): Result<Db> {
  const supported = checkRuntime(options.sqliteVersionProbe);
  if (!supported.ok) return supported;
  let db: DatabaseSync | undefined;
  try {
    const readOnly = options.readOnly === true;
    const onDisk = path !== ':memory:' && path !== '';
    const uid = options.currentUid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
    if (onDisk) {
      const secured = secureStore(path, readOnly, uid);
      if (!secured.ok) return secured;
    }
    if (!readOnly && onDisk && !existsSync(path)) {
      try {
        closeSync(openSync(path, 'wx', 0o600));
      } catch (e) {
        if ((e as { code?: unknown }).code !== 'EEXIST') throw e;
      }
    }
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
