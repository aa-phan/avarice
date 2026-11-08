// Schema version 2: the run (plan 02-03). Forward-only: migration 0001 is never edited, its checksum is recorded,
// and this file adds to it. migrate() takes a VACUUM INTO backup before applying it to a store that has history.
//   runs         four columns for the run workspace and the blocked reason (docs/contracts-and-state.md "Run state machine")
//   run_steps    the checkpointed steps of a run, mirroring onboarding_steps
//   hook_reads   what the run hook saw an agent read, for the read-before-edit rule (written by the hook with its own SQL)
//   check_validations  the active validation verdict of one declared check, cached per project, base revision and spec digest (ONB-10)
// Two indexes serve the reads the run makes every time: evidence by attempt, and events by run.
// Evidence and gate rows are insert-only (T-02-06): triggers refuse an UPDATE or DELETE, as events already do; an
// interrupted check is marked by inserting a new row with status `inconclusive`.
import type { Migration } from '../migrate.ts';

const sql = `
ALTER TABLE runs ADD COLUMN reason TEXT;
ALTER TABLE runs ADD COLUMN workspace_path TEXT;
ALTER TABLE runs ADD COLUMN branch TEXT;
ALTER TABLE runs ADD COLUMN base_revision TEXT;

CREATE TABLE run_steps (
  run_id TEXT NOT NULL, step TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL,
  result_json TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
  PRIMARY KEY (run_id, step, attempt)
);

CREATE TABLE hook_reads (
  invocation_id TEXT NOT NULL, agent_id TEXT NOT NULL, path TEXT NOT NULL, digest TEXT NOT NULL,
  seq INTEGER NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY (invocation_id, agent_id, path)
);

CREATE TABLE check_validations (
  project_id TEXT NOT NULL, base_revision TEXT NOT NULL, spec_digest TEXT NOT NULL, name TEXT NOT NULL,
  verdict TEXT NOT NULL, detail_json TEXT NOT NULL, validated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, base_revision, spec_digest, name)
);

CREATE INDEX evidence_attempt ON evidence (attempt_id);
CREATE INDEX events_run ON events (run_id);

CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is insert-only'); END;

CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is insert-only'); END;

CREATE TRIGGER gate_results_no_update BEFORE UPDATE ON gate_results
BEGIN SELECT RAISE(ABORT, 'gate_results is insert-only'); END;

CREATE TRIGGER gate_results_no_delete BEFORE DELETE ON gate_results
BEGIN SELECT RAISE(ABORT, 'gate_results is insert-only'); END;
`;

export const MIGRATION_0002: Migration = { version: 2, sql };
