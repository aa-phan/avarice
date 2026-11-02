// The events hash chain (SKELETON.md "Digests"; docs/contracts-and-state.md "Persisted entities").
// One function appends one row, and both writers use it: SqliteLedger.appendEvent and the PreToolUse hook
// (src/hook/pre-tool-use.ts), so the hook's rows continue the same chain.
//   row_hash = sha256(prev_hash \n ts \n type \n (run_id or "") \n data_json), genesis prev_hash = 64 zeros.
// The caller's transaction must be open (BEGIN IMMEDIATE): the previous hash is read inside it.
// This module imports only node and the digest helpers, so the lean hook entry can load it.
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../../domain/digest.ts';

export const GENESIS_HASH = '0'.repeat(64);
export const MAX_EVENT_STRING = 1024;
export const MAX_EVENT_JSON = 8192;

export interface EventRowInput {
  type: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  runId?: string;
  attemptId?: string;
  invocationId?: string;
  // IDs, counts, digests, rule names and short targets, never payloads.
  data: unknown;
  nowMs: number;
}

export interface EventRowReceipt {
  seq: number;
  rowHash: string;
}

// Thrown for event data the log refuses; SqliteLedger maps it to an `invalid` PortError.
export class EventDataError extends Error {
  readonly field: string;
  readonly reason: string;
  constructor(field: string, reason: string) {
    super(`invalid ${field}: ${reason}`);
    this.field = field;
    this.reason = reason;
  }
}

// Events carry IDs, counts, digests and exit codes, never payloads (T-01-62, T-01-35): refuse any string
// longer than a path or digest plausibly is, and any large document.
export function boundedEventJson(data: unknown): string {
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value.length > MAX_EVENT_STRING) throw new EventDataError(`data${path}`, `event data strings are limited to ${MAX_EVENT_STRING} characters`);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
    } else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
    }
  };
  visit(data, '');
  const json = canonicalJson(data);
  if (json.length > MAX_EVENT_JSON) throw new EventDataError('data', `event data is limited to ${MAX_EVENT_JSON} characters`);
  return json;
}

export function appendEventRow(db: DatabaseSync, ev: EventRowInput): EventRowReceipt {
  const dataJson = boundedEventJson(ev.data);
  const last = db.prepare('SELECT row_hash FROM events ORDER BY seq DESC LIMIT 1').get() as { row_hash: string } | undefined;
  const prevHash = last ? last.row_hash : GENESIS_HASH;
  const ts = new Date(ev.nowMs).toISOString();
  const rowHash = sha256Hex([prevHash, ts, ev.type, ev.runId ?? '', dataJson].join('\n'));
  const result = db
    .prepare('INSERT INTO events (ts, level, type, run_id, attempt_id, invocation_id, data_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ts, ev.level ?? 'info', ev.type, ev.runId ?? null, ev.attemptId ?? null, ev.invocationId ?? null, dataJson, prevHash, rowHash);
  return { seq: Number(result.lastInsertRowid), rowHash };
}
