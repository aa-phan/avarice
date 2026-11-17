// The approval statements the ledger and the PreToolUse hook share (plans 04-16 and 04-19; FR-12, T-04-42). Both write the same rows by the same SQL, so an
// approval is consumed one way whether the `avarice` process or the hook process takes it. Every function runs inside the caller's BEGIN IMMEDIATE transaction.
// This module imports only node and the event writer, nothing of the application, so the lean hook entry can load it.
import type { DatabaseSync } from 'node:sqlite';
import { appendEventRow } from './events.ts';

const iso = (ms: number): string => new Date(ms).toISOString();

// The newest `approval.requested` event of a scope, action and parameter digest that no `approval.granted` event answers. `run_id IS ?` takes the run ID
// of the scope, or NULL for an attended session (its events carry no run ID).
export const PENDING_REQUEST_SQL = `SELECT r.ts AS ts, r.data_json AS data_json FROM events r
           WHERE r.type = 'approval.requested' AND r.run_id IS ?
             AND json_extract(r.data_json, '$.scope') = ? AND json_extract(r.data_json, '$.action') = ? AND json_extract(r.data_json, '$.paramsDigest') = ?
             AND NOT EXISTS (SELECT 1 AS answered FROM events g WHERE g.type = 'approval.granted' AND json_extract(g.data_json, '$.requestId') = json_extract(r.data_json, '$.requestId'))
           ORDER BY r.seq DESC LIMIT 1`;

// The ID of the request of this scope, action and digest that is still waiting for the owner, or undefined.
export function pendingRequestId(db: DatabaseSync, query: { runId: string | undefined; scope: string; action: string; paramsDigest: string }): string | undefined {
  const row = db.prepare(PENDING_REQUEST_SQL).get(query.runId ?? null, query.scope, query.action, query.paramsDigest) as { data_json: string } | undefined;
  if (row === undefined) return undefined;
  const id = (JSON.parse(row.data_json) as { requestId?: unknown }).requestId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

export interface ConsumeRowInput {
  scope: string;
  action: string;
  paramsDigest: string;
  nowMs: number;
  // The `action.started` event written in the same transaction as the consume; `approvalId` is added to its data.
  startEvent: { type: string; level?: 'debug' | 'info' | 'warn' | 'error'; runId?: string; invocationId?: string; data: Readonly<Record<string, unknown>> };
}

// Takes the oldest usable approval of the scope, action and digest and appends the start event: usable means not revoked, not consumed and expiring strictly
// after `nowMs` (isUsable); the stored times are ISO-8601 UTC of one width, so the text compares. The UPDATE re-checks `consumed_at IS NULL`, so one approval
// is never taken twice. Returns null when there is none.
export function consumeApprovalRow(db: DatabaseSync, input: ConsumeRowInput): { approvalId: string; startSeq: number } | null {
  const found = db
    .prepare(
      `SELECT approval_id FROM approvals
           WHERE run_id = ? AND action = ? AND params_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
           ORDER BY granted_at, rowid LIMIT 1`,
    )
    .get(input.scope, input.action, input.paramsDigest, iso(input.nowMs)) as { approval_id: string } | undefined;
  if (found === undefined) return null;
  const approvalId = found.approval_id;
  const changed = db.prepare('UPDATE approvals SET consumed_at = ? WHERE approval_id = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(iso(input.nowMs), approvalId).changes;
  if (Number(changed) !== 1) return null;
  const started = appendEventRow(db, {
    type: input.startEvent.type,
    ...(input.startEvent.level !== undefined ? { level: input.startEvent.level } : {}),
    ...(input.startEvent.runId !== undefined ? { runId: input.startEvent.runId } : {}),
    ...(input.startEvent.invocationId !== undefined ? { invocationId: input.startEvent.invocationId } : {}),
    data: { ...input.startEvent.data, approvalId },
    nowMs: input.nowMs,
  });
  return { approvalId, startSeq: started.seq };
}
