// Schema version 1 (SKELETON.md "Schema"; docs/contracts-and-state.md "Persisted entities").
// The DDL of "Persisted entities", "Budget accounting" and "Decision records" is copied verbatim.
// AVARICE adds two operational tables (projects, onboarding_steps) and the immutability triggers.
// A change after this file lands needs migration 0002: the checksum of this text is recorded.
import type { Migration } from '../migrate.ts';

const sql = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  lease_holder TEXT, lease_expires_at TEXT, lease_fence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE task_refs (
  run_id TEXT NOT NULL REFERENCES runs, provider TEXT NOT NULL, kind TEXT NOT NULL, ext_id TEXT NOT NULL,
  revision TEXT, retrieved_at TEXT NOT NULL, scope TEXT NOT NULL, freshness TEXT NOT NULL,
  PRIMARY KEY (run_id, provider, kind, ext_id)
);
CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs, ordinal INTEGER NOT NULL,
  reason TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, outcome TEXT,
  UNIQUE (run_id, ordinal)
);
CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt_id TEXT, seq INTEGER NOT NULL,
  item_id TEXT,
  from_state TEXT, to_state TEXT NOT NULL, revision TEXT, gsd_state_digest TEXT,
  next_action TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (run_id, seq)
);
CREATE TABLE project_records (
  project_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
  body_json TEXT NOT NULL, digest TEXT NOT NULL, gsd_version TEXT NOT NULL,
  onboarded_revision TEXT NOT NULL, mapping_mode TEXT, mapping_scope_json TEXT, completeness TEXT,
  intel_commit TEXT, graph_commit TEXT, knowledge_commit TEXT,
  created_at TEXT NOT NULL, activated_at TEXT, superseded_at TEXT,
  PRIMARY KEY (project_id, version)
);
CREATE TABLE onboardings (
  onboarding_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL,
  staging_worktree TEXT, contract_run_id TEXT,
  preflight_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  lease_holder TEXT, lease_expires_at TEXT, lease_fence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE contracts (
  run_id TEXT NOT NULL REFERENCES runs, version INTEGER NOT NULL, digest TEXT NOT NULL,
  body_json TEXT NOT NULL, policy_revision TEXT NOT NULL,
  authorized_by TEXT NOT NULL, reason TEXT, diff_json TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, version)
);
CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts, work_item TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  revision TEXT NOT NULL, clean INTEGER NOT NULL, tree_digest TEXT NOT NULL,
  environment_json TEXT NOT NULL,
  contract_version INTEGER NOT NULL, policy_revision TEXT NOT NULL,
  status TEXT NOT NULL,
  independence TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  tests_json TEXT,
  command TEXT, exit_code INTEGER, duration_ms INTEGER,
  artifact_digest TEXT, ext_ref TEXT, created_at TEXT NOT NULL
);
CREATE TABLE gate_results (
  run_id TEXT NOT NULL, gate TEXT NOT NULL, work_item TEXT, contract_version INTEGER NOT NULL,
  policy_revision TEXT NOT NULL, revision TEXT NOT NULL, passed INTEGER NOT NULL,
  failures_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE artifacts (
  digest TEXT PRIMARY KEY, size INTEGER NOT NULL, kind TEXT NOT NULL, run_id TEXT,
  retention TEXT NOT NULL, created_at TEXT NOT NULL, store TEXT NOT NULL
);
CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action TEXT NOT NULL,
  params_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, revoked_at TEXT
);
CREATE TABLE adapter_configs (
  name TEXT PRIMARY KEY, port TEXT NOT NULL, adapter TEXT NOT NULL,
  config_digest TEXT NOT NULL, descriptor_json TEXT NOT NULL
);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, level TEXT NOT NULL, type TEXT NOT NULL,
  run_id TEXT, attempt_id TEXT, invocation_id TEXT, data_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL
);

CREATE TABLE budgets (
  run_id TEXT NOT NULL, name TEXT NOT NULL,
  limit_value REAL NOT NULL, used REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0,
  exactness TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE decisions (
  decision_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, contract_version INTEGER NOT NULL,
  class TEXT NOT NULL,
  issue TEXT NOT NULL, recommendation TEXT, options_json TEXT NOT NULL, consequences_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  affected_items_json TEXT NOT NULL, authorized_default TEXT,
  state_digest TEXT NOT NULL,
  urgency TEXT NOT NULL,
  state TEXT NOT NULL,
  opened_at TEXT NOT NULL, answered_at TEXT, answered_by TEXT, answer TEXT, answer_channel TEXT
);
CREATE TABLE work_items (
  run_id TEXT NOT NULL, item_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'implement',
  depends_on_json TEXT NOT NULL,
  size TEXT NOT NULL, model TEXT NOT NULL, spec_json TEXT NOT NULL,
  state TEXT NOT NULL, gsd_session TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, item_id)
);

CREATE TABLE projects (
  project_id TEXT PRIMARY KEY, root_commit TEXT NOT NULL, repo_path TEXT NOT NULL,
  remote TEXT, default_branch TEXT, created_at TEXT NOT NULL,
  UNIQUE (root_commit, repo_path)
);
CREATE TABLE onboarding_steps (
  onboarding_id TEXT NOT NULL, step TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL,
  result_json TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
  PRIMARY KEY (onboarding_id, step, attempt)
);

CREATE TRIGGER project_records_body_immutable BEFORE UPDATE ON project_records
WHEN OLD.body_json IS NOT NEW.body_json OR OLD.digest IS NOT NEW.digest
BEGIN SELECT RAISE(ABORT, 'project_records body and digest are immutable'); END;

CREATE TRIGGER contracts_body_immutable BEFORE UPDATE ON contracts
WHEN OLD.body_json IS NOT NEW.body_json OR OLD.digest IS NOT NEW.digest
BEGIN SELECT RAISE(ABORT, 'contracts body and digest are immutable'); END;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
`;

export const MIGRATION_0001: Migration = { version: 1, sql };
