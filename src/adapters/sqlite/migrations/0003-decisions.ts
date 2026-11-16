// Schema version 3: decisions, independent work and amendments (plan 03-02). Forward-only: migrations 0001 and 0002 are never
// edited, their checksums are recorded, and this file adds to them. migrate() takes a VACUUM INTO backup before applying it to a
// store that has history; every existing row is kept and every new column reads NULL for it.
//   attempts.item_id             the work item an attempt served, so every multi-item stage keys its attempts by item;
//                                a row with no item (written before this migration) is read as item A
//   decisions.supersedes         the decision a stale re-open replaced (D-15); NULL for a decision no other replaced
//   runs.cancel_requested_at     when the owner asked to cancel the run, and
//   runs.cancel_requested_by     who asked: the request is recorded before the supervisor acts on it (AUT-12)
//   notifications                the delivery state of one notification: destination, subjects, attempts and the next retry;
//                                the methods that read and write it arrive in plan 03-12
// Two indexes serve the reads of the new keys: attempts by run and item, and notifications by state.
import type { Migration } from '../migrate.ts';

const sql = `
ALTER TABLE attempts ADD COLUMN item_id TEXT;
ALTER TABLE decisions ADD COLUMN supersedes TEXT;
ALTER TABLE runs ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE runs ADD COLUMN cancel_requested_by TEXT;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY, run_id TEXT, kind TEXT NOT NULL, destination TEXT NOT NULL,
  subject_ids_json TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT
);

CREATE INDEX attempts_item ON attempts (run_id, item_id);
CREATE INDEX notifications_state ON notifications (state);
`;

export const MIGRATION_0003: Migration = { version: 3, sql };
