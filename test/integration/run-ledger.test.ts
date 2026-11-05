// The run side of the ledger (docs/contracts-and-state.md "Run state machine", "Persisted entities"; plan 02-03).
// Rows are written through the ledger API only; raw SQL observes and tries to tamper. A store is migrated from
// the committed v1 fixture where the case is about the upgrade, and created fresh otherwise.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';

const FIXTURE = join(REPO_ROOT, 'test', 'fixtures', 'db', 'schema-v1.sqlite');
const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

function refused<T>(result: Result<T>, kind: string): void {
  assert.ok(!result.ok, 'the call must be refused');
  assert.equal(result.error.kind, kind, JSON.stringify(result.error));
}

interface Harness {
  ledger: SqliteLedger;
  db: DatabaseSync;
  dir: string;
  count(table: string, where?: string): number;
}

function harness(options: { fromV1?: boolean } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-run-ledger-'));
  cleanup.push(dir);
  const path = join(dir, 'state.db');
  if (options.fromV1 === true) copyFileSync(FIXTURE, path);
  const db = must(openDb(path));
  must(migrate(db, [MIGRATION_0001, MIGRATION_0002], { nowMs: T0 }));
  let n = 0;
  const ledger = new SqliteLedger(db, (prefix) => prefix + String(++n).padStart(26, '0'));
  return {
    ledger,
    db,
    dir,
    count: (table, where = '1=1') => Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n),
  };
}

function seedProject(h: Harness, suffix = '1'): string {
  const project = must(h.ledger.registerProject({ projectId: `proj_${suffix}`, rootCommit: `root${suffix}`, repoPath: `/repo/${suffix}`, remote: null, defaultBranch: 'main', nowMs: T0 }));
  return project.projectId;
}

function seedRun(h: Harness, runId = 'run_1', projectId?: string) {
  const project = projectId ?? seedProject(h);
  return must(h.ledger.createRun({ runId, projectId: project, title: 'fix the slug helper', nowMs: T0 + 1 }));
}

describe('createRun, transitionRun and the checkpoint round trip (tracer)', () => {
  it('starts a run in contract_ready at version 1 with no checkpoint and no lease', () => {
    const h = harness();
    const run = seedRun(h);
    assert.equal(run.runId, 'run_1');
    assert.equal(run.state, 'contract_ready');
    assert.equal(run.version, 1);
    assert.equal(run.reason, null);
    assert.equal(run.leaseHolder, null);
    assert.equal(run.leaseFence, 0);
    assert.equal(run.workspacePath, null);
    assert.equal(run.branch, null);
    assert.equal(run.baseRevision, null);
    assert.equal(h.count('checkpoints', "run_id = 'run_1'"), 0, 'no checkpoint until the first transition or checkpoint');
    assert.equal(must(h.ledger.getRun('run_1')).title, 'fix the slug helper');
  });

  it('moves contract_ready -> running: version 2, checkpoint seq 1 from contract_ready, one run.transition event with run_id', () => {
    const h = harness();
    seedRun(h);
    const eventsBefore = h.count('events', "type = 'run.transition'");
    const next = must(
      h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 10, workspacePath: '/work/run_1', branch: 'avarice/run_1', baseRevision: 'git:9f1cd8d' }),
    );
    assert.equal(next.state, 'running');
    assert.equal(next.version, 2);
    assert.equal(next.workspacePath, '/work/run_1');
    assert.equal(next.branch, 'avarice/run_1');
    assert.equal(next.baseRevision, 'git:9f1cd8d');

    const checkpoints = h.db.prepare("SELECT seq, from_state, to_state, next_action FROM checkpoints WHERE run_id = 'run_1' ORDER BY seq").all() as Array<Record<string, unknown>>;
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.['seq'], 1);
    assert.equal(checkpoints[0]?.['from_state'], 'contract_ready');
    assert.equal(checkpoints[0]?.['to_state'], 'running');
    assert.equal(checkpoints[0]?.['next_action'], 'context-pack');

    assert.equal(h.count('events', "type = 'run.transition'"), eventsBefore + 1);
    const event = h.db.prepare("SELECT run_id, data_json FROM events WHERE type = 'run.transition' ORDER BY seq DESC LIMIT 1").get() as { run_id: string; data_json: string };
    assert.equal(event.run_id, 'run_1');
    const data = JSON.parse(event.data_json) as Record<string, unknown>;
    assert.equal(data['runId'], 'run_1');
    assert.equal(data['from'], 'contract_ready');
    assert.equal(data['to'], 'running');
    assert.equal(data['nextAction'], 'context-pack');
  });

  it('refuses a stale version and a stale fence as conflict, writing nothing', () => {
    const h = harness();
    seedRun(h);
    const before = [h.count('checkpoints'), h.count('events')];
    refused(h.ledger.transitionRun('run_1', { version: 7, fence: 0 }, { to: 'running', nextAction: 'x', nowMs: T0 + 10 }), 'conflict');
    refused(h.ledger.transitionRun('run_1', { version: 1, fence: 3 }, { to: 'running', nextAction: 'x', nowMs: T0 + 10 }), 'conflict');
    assert.deepEqual([h.count('checkpoints'), h.count('events')], before);
    assert.equal(must(h.ledger.getRun('run_1')).version, 1);
  });

  it('refuses an edge that is not in the table with field state, writing nothing (adjacency edge)', () => {
    const h = harness();
    seedRun(h);
    const before = [h.count('checkpoints'), h.count('events')];
    const result = h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'ready_for_review', nextAction: 'x', nowMs: T0 + 10 });
    refused(result, 'invalid');
    assert.ok(!result.ok && result.error.kind === 'invalid' && result.error.field === 'state');
    assert.deepEqual([h.count('checkpoints'), h.count('events')], before);
  });

  it('allows running -> running and refuses every other self-edge', () => {
    const h = harness();
    seedRun(h);
    let row = must(h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 10 }));
    row = must(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 11 }));
    assert.equal(row.version, 3);
    row = must(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'paused', nextAction: 'reconcile', nowMs: T0 + 12 }));
    refused(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'paused', nextAction: 'reconcile', nowMs: T0 + 13 }), 'invalid');
  });

  it('requires a reason from the documented set to enter blocked_on_decision, records it, and clears it on leaving', () => {
    const h = harness();
    seedRun(h);
    let row = must(h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 10 }));
    const missing = h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'blocked_on_decision', nextAction: 'none', nowMs: T0 + 11 });
    refused(missing, 'invalid');
    assert.ok(!missing.ok && missing.error.kind === 'invalid' && missing.error.field === 'reason');
    refused(
      h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'blocked_on_decision', nextAction: 'none', nowMs: T0 + 11, reason: 'because' as never }),
      'invalid',
    );
    refused(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'paused', nextAction: 'reconcile', nowMs: T0 + 11, reason: 'decision' }), 'invalid');
    assert.equal(must(h.ledger.getRun('run_1')).version, row.version, 'every refusal wrote nothing');

    row = must(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'blocked_on_decision', nextAction: 'none', nowMs: T0 + 12, reason: 'budget_exhausted' }));
    assert.equal(row.state, 'blocked_on_decision');
    assert.equal(row.reason, 'budget_exhausted');
    row = must(h.ledger.transitionRun('run_1', { version: row.version, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 13 }));
    assert.equal(row.reason, null);
  });

  it('keeps the checkpoint sequence continuous per run across transitions, starting at 1', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    seedRun(h, 'run_2', project);
    let a = must(h.ledger.getRun('run_1'));
    let b = must(h.ledger.getRun('run_2'));
    a = must(h.ledger.transitionRun('run_1', { version: a.version, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 10 }));
    b = must(h.ledger.transitionRun('run_2', { version: b.version, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 11 }));
    a = must(h.ledger.transitionRun('run_1', { version: a.version, fence: 0 }, { to: 'verifying', nextAction: 'verify:checks', nowMs: T0 + 12 }));
    must(h.ledger.transitionRun('run_1', { version: a.version, fence: 0 }, { to: 'ready_for_review', nextAction: 'none', nowMs: T0 + 13 }));
    must(h.ledger.transitionRun('run_2', { version: b.version, fence: 0 }, { to: 'paused', nextAction: 'reconcile', nowMs: T0 + 14 }));
    const seqs = (runId: string) => (h.db.prepare('SELECT seq FROM checkpoints WHERE run_id = ? ORDER BY seq').all(runId) as Array<{ seq: number }>).map((r) => r.seq);
    assert.deepEqual(seqs('run_1'), [1, 2, 3]);
    assert.deepEqual(seqs('run_2'), [1, 2]);
  });

  it('carries the attempt and item of a transition into its checkpoint and event', () => {
    const h = harness();
    seedRun(h);
    h.db.prepare("INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_1', 'run_1', 1, 'first attempt', 'a')").run();
    must(h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'launch:run', nowMs: T0 + 10, itemId: 'A', attemptId: 'att_1', revision: 'git:abc', data: { invocation: 'inv_1' } }));
    const cp = h.db.prepare("SELECT item_id, attempt_id, revision FROM checkpoints WHERE run_id = 'run_1'").get() as Record<string, unknown>;
    assert.equal(cp['item_id'], 'A');
    assert.equal(cp['attempt_id'], 'att_1');
    assert.equal(cp['revision'], 'git:abc');
    const event = h.db.prepare("SELECT attempt_id, data_json FROM events WHERE type = 'run.transition'").get() as { attempt_id: string; data_json: string };
    assert.equal(event.attempt_id, 'att_1');
    assert.equal((JSON.parse(event.data_json) as Record<string, unknown>)['invocation'], 'inv_1');
  });

  it('does not touch the onboarding carrier rows: a carrier cannot be read, created over or transitioned as a run', () => {
    const h = harness();
    const project = seedProject(h);
    h.db.prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_carrier', ?, 'onboarding', 1, 'onboarding onb_1', 'a', 'a')").run(project);
    refused(h.ledger.getRun('run_carrier'), 'not_found');
    refused(h.ledger.transitionRun('run_carrier', { version: 1, fence: 0 }, { to: 'running', nextAction: 'x', nowMs: T0 }), 'not_found');
    refused(h.ledger.createRun({ runId: 'run_carrier', projectId: project, title: 'dup', nowMs: T0 }), 'conflict');
    refused(h.ledger.getRun('run_missing'), 'not_found');
    refused(h.ledger.createRun({ runId: 'run_x', projectId: 'proj_missing', title: 't', nowMs: T0 }), 'not_found');
  });

  it('writes the run tables into a store migrated from the v1 fixture', () => {
    const h = harness({ fromV1: true });
    const before = h.count('onboardings');
    assert.ok(before > 0, 'the fixture carries onboardings');
    const project = (must(h.ledger.listProjects())[0] ?? assert.fail('the fixture has a project')).projectId;
    seedRun(h, 'run_on_v1', project);
    const row = must(h.ledger.transitionRun('run_on_v1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 10 }));
    assert.equal(row.state, 'running');
    assert.equal(h.count('onboardings'), before);
    assert.equal(h.count('checkpoints', "run_id = 'run_on_v1'"), 1);
  });
});
