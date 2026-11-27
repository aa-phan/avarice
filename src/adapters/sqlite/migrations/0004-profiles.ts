// Schema version 4: status indexes and approval guards (plan 04-08; SEC-1, FR-12, D-18). Forward-only: migrations 0001 to 0003 are never
// edited, their checksums are recorded, and this file adds to them. migrate() takes a VACUUM INTO backup before applying it to a store
// that has history, and applies it in one transaction, so a kill leaves schema 3 or schema 4 and never a mix. No row is changed.
//   decisions_run, gate_results_run, notifications_run   the rows of one run, for status and the run views: each had no index on run_id
//   runs_project                                        the runs of one project
//   approvals_match                                     an approval looked up by (run_id, action, params_digest), the key an
//                                                       authorization is matched on
//   approvals_no_delete                                 an approval row is never deleted
//   approvals_update_guard                              an approval row is never changed except by setting consumed_at or revoked_at,
//                                                       each once, from NULL: an approval cannot be replayed, extended or re-pointed
// No profile column is added to any table. Profile scoping is the meta.profile_id row each store already carries (written by migrate at
// its last pending migration since schema 1): every profile has its own store file, and composition refuses a store whose profile_id is
// not the selected profile, so a per-row column would repeat a value that is the same for every row of the file.
import type { Migration } from '../migrate.ts';

const sql = `
CREATE INDEX decisions_run ON decisions (run_id);
CREATE INDEX gate_results_run ON gate_results (run_id);
CREATE INDEX notifications_run ON notifications (run_id);
CREATE INDEX runs_project ON runs (project_id);
CREATE INDEX approvals_match ON approvals (run_id, action, params_digest);

CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'approvals rows are never deleted'); END;

CREATE TRIGGER approvals_update_guard BEFORE UPDATE ON approvals
WHEN NOT (
  NEW.approval_id IS OLD.approval_id AND NEW.run_id IS OLD.run_id AND NEW.action IS OLD.action
  AND NEW.params_digest IS OLD.params_digest AND NEW.idempotency_key IS OLD.idempotency_key AND NEW.source IS OLD.source
  AND NEW.granted_by IS OLD.granted_by AND NEW.granted_at IS OLD.granted_at AND NEW.expires_at IS OLD.expires_at
  AND (NEW.consumed_at IS OLD.consumed_at OR OLD.consumed_at IS NULL)
  AND (NEW.revoked_at IS OLD.revoked_at OR OLD.revoked_at IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'approvals rows change only by setting consumed_at or revoked_at once'); END;
`;

export const MIGRATION_0004: Migration = { version: 4, sql };
