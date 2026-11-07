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

// ---------------------------------------------------------------------------------------------------
// Task 2: run leases, run checkpoints, run contracts with budgets, run steps, listRuns
// ---------------------------------------------------------------------------------------------------

describe('run leases', () => {
  it('grants a free lease with fence 1, refuses a live one with conflict, and takes over only a strictly expired one (fence 2)', () => {
    const h = harness();
    seedRun(h);
    const grant = must(h.ledger.acquireRunLease('run_1', 'host:1:a', 1_000, T0 + 10));
    assert.equal(grant.fence, 1);
    assert.equal(grant.expiresAt, new Date(T0 + 1_010).toISOString());
    const live = h.ledger.acquireRunLease('run_1', 'host:2:b', 1_000, T0 + 500);
    refused(live, 'conflict');
    const held = must(h.ledger.getRun('run_1'));
    assert.equal(held.leaseHolder, 'host:1:a');
    assert.equal(held.leaseFence, 1);
    refused(h.ledger.acquireRunLease('run_1', 'host:2:b', 1_000, T0 + 1_010), 'conflict');
    const taken = must(h.ledger.acquireRunLease('run_1', 'host:2:b', 1_000, T0 + 1_011));
    assert.equal(taken.fence, 2);
    assert.equal(must(h.ledger.getRun('run_1')).leaseHolder, 'host:2:b');
  });

  it('renews only for the current holder and fence; a fenced-out holder is refused with conflict', () => {
    const h = harness();
    seedRun(h);
    const first = must(h.ledger.acquireRunLease('run_1', 'a', 100, T0 + 10));
    const renewed = must(h.ledger.renewRunLease('run_1', 'a', first.fence, 1_000, T0 + 50));
    assert.equal(renewed.fence, 1);
    assert.equal(renewed.expiresAt, new Date(T0 + 1_050).toISOString());
    refused(h.ledger.renewRunLease('run_1', 'a', 9, 1_000, T0 + 60), 'conflict');
    refused(h.ledger.renewRunLease('run_1', 'b', first.fence, 1_000, T0 + 60), 'conflict');
    must(h.ledger.acquireRunLease('run_1', 'b', 1_000, T0 + 2_000));
    refused(h.ledger.renewRunLease('run_1', 'a', first.fence, 1_000, T0 + 2_001), 'conflict');
  });

  it('release clears holder and expiry, keeps counting fences, and refuses a stale releaser', () => {
    const h = harness();
    seedRun(h);
    const first = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 10));
    refused(h.ledger.releaseRunLease('run_1', 'b', first.fence), 'conflict');
    refused(h.ledger.releaseRunLease('run_1', 'a', first.fence + 1), 'conflict');
    must(h.ledger.releaseRunLease('run_1', 'a', first.fence));
    const row = must(h.ledger.getRun('run_1'));
    assert.equal(row.leaseHolder, null);
    assert.equal(row.leaseExpiresAt, null);
    assert.equal(row.leaseFence, 1);
    assert.equal(must(h.ledger.acquireRunLease('run_1', 'c', 1_000, T0 + 20)).fence, 2);
  });

  it('fences out a stale supervisor: after takeover its transition is a conflict and writes nothing (T-02-05)', () => {
    const h = harness();
    seedRun(h);
    const old = must(h.ledger.acquireRunLease('run_1', 'old', 100, T0 + 10));
    must(h.ledger.acquireRunLease('run_1', 'new', 1_000, T0 + 5_000));
    const before = [h.count('checkpoints'), h.count('events')];
    refused(h.ledger.transitionRun('run_1', { version: 1, fence: old.fence }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 5_001 }), 'conflict');
    refused(h.ledger.recordRunCheckpoint('run_1', { fence: old.fence }, { nextAction: 'x', nowMs: T0 + 5_001 }), 'conflict');
    assert.deepEqual([h.count('checkpoints'), h.count('events')], before);
    assert.equal(must(h.ledger.getRun('run_1')).state, 'contract_ready');
  });

  it('never leases an onboarding carrier row or an unknown run', () => {
    const h = harness();
    const project = seedProject(h);
    h.db.prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_carrier', ?, 'onboarding', 1, 'onboarding onb_1', 'a', 'a')").run(project);
    refused(h.ledger.acquireRunLease('run_carrier', 'a', 1_000, T0), 'not_found');
    refused(h.ledger.acquireRunLease('run_missing', 'a', 1_000, T0), 'not_found');
    refused(h.ledger.renewRunLease('run_carrier', 'a', 1, 1_000, T0), 'not_found');
    refused(h.ledger.releaseRunLease('run_carrier', 'a', 1), 'not_found');
  });

  it('two connections racing an expired run lease: exactly one wins (NFR-5: writers serialize through BEGIN IMMEDIATE)', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.acquireRunLease('run_1', 'a', 100, T0));
    const path = h.db.location();
    assert.ok(path);
    const db2 = must(openDb(path));
    try {
      let n = 100;
      const other = new SqliteLedger(db2, (prefix) => prefix + String(++n).padStart(26, '0'));
      const results = [h.ledger.acquireRunLease('run_1', 'b', 1_000, T0 + 5_000), other.acquireRunLease('run_1', 'c', 1_000, T0 + 5_000)];
      assert.equal(results.filter((r) => r.ok).length, 1);
      const winner = results.find((r) => r.ok);
      assert.ok(winner?.ok);
      assert.equal(winner.value.fence, 2);
    } finally {
      db2.close();
    }
  });
});

describe('run checkpoints', () => {
  it('appends with the next seq without moving the state or the version, and records the event', () => {
    const h = harness();
    seedRun(h);
    const lease = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 5));
    const first = must(h.ledger.recordRunCheckpoint('run_1', { fence: lease.fence }, { nextAction: 'prepare-workspace', nowMs: T0 + 10 }));
    assert.equal(first.seq, 1);
    assert.equal(first.fromState, 'contract_ready');
    assert.equal(first.toState, 'contract_ready');
    assert.equal(first.nextAction, 'prepare-workspace');
    assert.equal(first.attemptId, null);
    const second = must(h.ledger.recordRunCheckpoint('run_1', { fence: lease.fence }, { nextAction: 'configure-gsd', nowMs: T0 + 11, revision: 'git:abc', itemId: 'A' }));
    assert.equal(second.seq, 2);
    assert.equal(second.revision, 'git:abc');
    assert.equal(second.itemId, 'A');
    const row = must(h.ledger.getRun('run_1'));
    assert.equal(row.state, 'contract_ready');
    assert.equal(row.version, 1);
    assert.equal(row.updatedAt, new Date(T0 + 11).toISOString());
    const events = h.db.prepare("SELECT run_id, data_json FROM events WHERE type = 'run.checkpoint' ORDER BY seq").all() as Array<{ run_id: string; data_json: string }>;
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.run_id === 'run_1'));
    assert.equal((JSON.parse(events[1]?.data_json ?? '{}') as Record<string, unknown>)['nextAction'], 'configure-gsd');
  });

  it('keeps seq continuous across transitions and plain checkpoints; latest is the highest, list is oldest first', () => {
    const h = harness();
    seedRun(h);
    assert.equal(must(h.ledger.latestRunCheckpoint('run_1')), null);
    assert.deepEqual(must(h.ledger.listRunCheckpoints('run_1')), []);
    must(h.ledger.recordRunCheckpoint('run_1', { fence: 0 }, { nextAction: 'prepare-workspace', nowMs: T0 + 10 }));
    const running = must(h.ledger.transitionRun('run_1', { version: 1, fence: 0 }, { to: 'running', nextAction: 'context-pack', nowMs: T0 + 11 }));
    must(h.ledger.recordRunCheckpoint('run_1', { fence: 0 }, { nextAction: 'launch:run', nowMs: T0 + 12 }));
    must(h.ledger.transitionRun('run_1', { version: running.version, fence: 0 }, { to: 'verifying', nextAction: 'verify:checks', nowMs: T0 + 13 }));
    const all = must(h.ledger.listRunCheckpoints('run_1'));
    assert.deepEqual(all.map((c) => c.seq), [1, 2, 3, 4]);
    assert.deepEqual(all.map((c) => c.nextAction), ['prepare-workspace', 'context-pack', 'launch:run', 'verify:checks']);
    const latest = must(h.ledger.latestRunCheckpoint('run_1'));
    assert.equal(latest?.seq, 4);
    assert.equal(latest?.toState, 'verifying');
    assert.equal(latest?.fromState, 'running');
  });

  it('refuses an attempt of another run, a stale fence and an unknown run', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    seedRun(h, 'run_2', project);
    h.db.prepare("INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_other', 'run_2', 1, 'r', 'a')").run();
    refused(h.ledger.recordRunCheckpoint('run_1', { fence: 0 }, { nextAction: 'x', nowMs: T0, attemptId: 'att_other' }), 'invalid');
    refused(h.ledger.recordRunCheckpoint('run_1', { fence: 4 }, { nextAction: 'x', nowMs: T0 }), 'conflict');
    refused(h.ledger.recordRunCheckpoint('run_missing', { fence: 0 }, { nextAction: 'x', nowMs: T0 }), 'not_found');
    refused(h.ledger.latestRunCheckpoint('run_missing'), 'not_found');
    assert.equal(h.count('checkpoints'), 0);
  });
});

describe('run contracts and budgets', () => {
  const body = { schema: 1, policyPreset: 'routine' };

  it('stores the contract and its budget rows in one transaction and reads the highest version back', () => {
    const h = harness();
    seedRun(h);
    assert.equal(must(h.ledger.getRunContract('run_1')), null);
    const stored = must(
      h.ledger.storeRunContract('run_1', { fence: 0 }, {
        version: 1,
        digest: 'sha256:' + 'a'.repeat(64),
        body,
        policyRevision: 'sha256:' + 'b'.repeat(64),
        authorizedBy: 'owner',
        budgets: [
          { name: 'invocations', limit: 3, exactness: 'exact' },
          { name: 'costUsd', limit: 5, exactness: 'estimated' },
        ],
        nowMs: T0 + 10,
      }),
    );
    assert.equal(stored.runId, 'run_1');
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.body, body);
    const budgets = must(h.ledger.getBudgets('run_1'));
    assert.deepEqual(budgets.map((b) => [b.name, b.limit, b.used, b.reserved, b.exactness, b.contractVersion]), [
      ['costUsd', 5, 0, 0, 'estimated', 1],
      ['invocations', 3, 0, 0, 'exact', 1],
    ]);
    const second = must(
      h.ledger.storeRunContract('run_1', { fence: 0 }, { version: 2, digest: 'sha256:' + 'c'.repeat(64), body: { ...body, amended: true }, policyRevision: 'sha256:' + 'b'.repeat(64), authorizedBy: 'owner', nowMs: T0 + 20 }),
    );
    assert.equal(second.version, 2);
    assert.equal(must(h.ledger.getRunContract('run_1'))?.version, 2);
    assert.equal(h.count('events', "type = 'contract.stored' AND run_id = 'run_1'"), 2);
  });

  it('refuses a second store of the same version with conflict and leaves the first contract and its budgets alone', () => {
    const h = harness();
    seedRun(h);
    const input = { version: 1, digest: 'sha256:' + 'a'.repeat(64), body, policyRevision: 'p', authorizedBy: 'owner', budgets: [{ name: 'invocations', limit: 3, exactness: 'exact' as const }], nowMs: T0 + 10 };
    must(h.ledger.storeRunContract('run_1', { fence: 0 }, input));
    refused(h.ledger.storeRunContract('run_1', { fence: 0 }, { ...input, digest: 'sha256:' + 'd'.repeat(64), budgets: [{ name: 'invocations', limit: 99, exactness: 'exact' }] }), 'conflict');
    assert.equal(must(h.ledger.getRunContract('run_1'))?.digest, 'sha256:' + 'a'.repeat(64));
    assert.equal(must(h.ledger.getBudgets('run_1'))[0]?.limit, 3);
  });

  it('refuses a stale fence, an oversized body, an invalid budget and an unknown run, writing nothing', () => {
    const h = harness();
    seedRun(h);
    const input = { version: 1, digest: 'd', body, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 10 };
    refused(h.ledger.storeRunContract('run_1', { fence: 3 }, input), 'conflict');
    refused(h.ledger.storeRunContract('run_1', { fence: 0 }, { ...input, body: { text: 'x'.repeat(2 * 1024 * 1024) } }), 'invalid');
    refused(h.ledger.storeRunContract('run_1', { fence: 0 }, { ...input, budgets: [{ name: 'invocations', limit: -1, exactness: 'exact' }] }), 'invalid');
    refused(h.ledger.storeRunContract('run_missing', { fence: 0 }, input), 'not_found');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 0);
    assert.equal(h.count('budgets', "run_id = 'run_1'"), 0);
  });

  it('refuses an UPDATE of a stored contract body (the Phase 1 trigger covers run contracts)', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.storeRunContract('run_1', { fence: 0 }, { version: 1, digest: 'd', body, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 10 }));
    assert.throws(() => h.db.prepare("UPDATE contracts SET body_json = '{}' WHERE run_id = 'run_1'").run(), /immutable/);
  });
});

describe('run steps', () => {
  it('records a step by (step, attempt), replaces a repeated one, and reads them oldest first', () => {
    const h = harness();
    seedRun(h);
    const started = must(h.ledger.recordRunStep('run_1', { step: 'launch:run', status: 'started', result: { session: 'abc' }, nowMs: T0 + 10 }));
    assert.equal(started.runId, 'run_1');
    assert.equal(started.attempt, 1);
    assert.equal(started.completedAt, null);
    must(h.ledger.recordRunStep('run_1', { step: 'prepare-workspace', status: 'completed', result: { ok: true }, nowMs: T0 + 11, completedAtMs: T0 + 12 }));
    const done = must(h.ledger.recordRunStep('run_1', { step: 'launch:run', status: 'completed', result: { session: 'abc', exit: 0 }, nowMs: T0 + 13, completedAtMs: T0 + 14 }));
    assert.equal(done.status, 'completed');
    assert.equal(done.completedAt, new Date(T0 + 14).toISOString());
    const second = must(h.ledger.recordRunStep('run_1', { step: 'launch:run', attempt: 2, status: 'started', result: {}, nowMs: T0 + 15 }));
    assert.equal(second.attempt, 2);
    const steps = must(h.ledger.getRunSteps('run_1'));
    assert.deepEqual(steps.map((s) => `${s.step}#${s.attempt}:${s.status}`), ['launch:run#1:completed', 'prepare-workspace#1:completed', 'launch:run#2:started']);
    assert.deepEqual(steps[0]?.result, { session: 'abc', exit: 0 });
  });

  it('records a step under a fence guard only while that fence is current (G-02-10)', () => {
    const h = harness();
    seedRun(h);
    const old = must(h.ledger.acquireRunLease('run_1', 'old', 100, T0 + 10));
    const recorded = must(h.ledger.recordRunStep('run_1', { step: 'resume:reconcile', status: 'failed', result: { error: 'x' }, nowMs: T0 + 11 }, { fence: old.fence }));
    assert.equal(recorded.step, 'resume:reconcile');
    must(h.ledger.acquireRunLease('run_1', 'new', 1_000, T0 + 5_000));
    const rowsBefore = h.count('run_steps');
    const stale = h.ledger.recordRunStep('run_1', { step: 'resume:reconcile', attempt: 2, status: 'failed', result: { error: 'y' }, nowMs: T0 + 5_001 }, { fence: old.fence });
    refused(stale, 'conflict');
    assert.ok(!stale.ok && stale.error.kind === 'conflict');
    assert.deepEqual(stale.error.kind === 'conflict' ? [stale.error.expected, stale.error.actual] : [], [`lease fence ${old.fence}`, `lease fence ${old.fence + 1}`]);
    assert.equal(h.count('run_steps'), rowsBefore, 'a stale fence writes no step');
  });

  it('records a step with no guard as before, whoever holds the lease (G-02-10)', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.acquireRunLease('run_1', 'old', 100, T0 + 10));
    must(h.ledger.acquireRunLease('run_1', 'new', 1_000, T0 + 5_000));
    must(h.ledger.recordRunStep('run_1', { step: 'discard', status: 'completed', result: {}, nowMs: T0 + 5_001 }));
    assert.equal(h.count('run_steps'), 1);
  });

  it('accepts exactly the six step statuses', () => {
    const h = harness();
    seedRun(h);
    for (const status of ['started', 'completed', 'failed', 'interrupted', 'reconciled', 'skipped']) {
      must(h.ledger.recordRunStep('run_1', { step: `s-${status}`, status, result: {}, nowMs: T0 + 10 }));
    }
    refused(h.ledger.recordRunStep('run_1', { step: 'bad', status: 'done', result: {}, nowMs: T0 + 10 }), 'invalid');
    refused(h.ledger.recordRunStep('run_1', { step: '', status: 'started', result: {}, nowMs: T0 + 10 }), 'invalid');
    assert.equal(h.count('run_steps'), 6);
  });

  it('refuses a result body over 1 MiB and an unknown run, and never writes to the onboarding step table', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.recordRunStep('run_1', { step: 'big', status: 'completed', result: { text: 'x'.repeat(1024 * 1024 + 1) }, nowMs: T0 + 10 }), 'invalid');
    refused(h.ledger.recordRunStep('run_missing', { step: 's', status: 'started', result: {}, nowMs: T0 + 10 }), 'not_found');
    refused(h.ledger.getRunSteps('run_missing'), 'not_found');
    assert.equal(h.count('run_steps'), 0);
    assert.equal(h.count('onboarding_steps'), 0);
  });
});

describe('listRuns', () => {
  it('returns runs oldest first, filtered by project, and never an onboarding carrier row', () => {
    const h = harness();
    const p1 = seedProject(h, '1');
    const p2 = seedProject(h, '2');
    h.db.prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_carrier', ?, 'onboarding', 1, 'onboarding onb_1', ?, ?)").run(p1, new Date(T0).toISOString(), new Date(T0).toISOString());
    must(h.ledger.createRun({ runId: 'run_b', projectId: p1, title: 'b', nowMs: T0 + 20 }));
    must(h.ledger.createRun({ runId: 'run_a', projectId: p2, title: 'a', nowMs: T0 + 10 }));
    must(h.ledger.createRun({ runId: 'run_c', projectId: p1, title: 'c', nowMs: T0 + 30 }));
    assert.deepEqual(must(h.ledger.listRuns()).map((r) => r.runId), ['run_a', 'run_b', 'run_c']);
    assert.deepEqual(must(h.ledger.listRuns(p1)).map((r) => r.runId), ['run_b', 'run_c']);
    assert.deepEqual(must(h.ledger.listRuns('proj_none')), []);
    assert.ok(must(h.ledger.listRuns()).every((r) => r.state !== ('onboarding' as string)));
  });

  it('does not list the carrier row a real onboarding creates through storeContract', () => {
    const h = harness();
    const project = seedProject(h);
    const onboarding = must(h.ledger.createOnboarding({ onboardingId: 'onb_1', projectId: project, preflight: {}, nowMs: T0 + 1 }));
    const lease = must(h.ledger.acquireLease(onboarding.onboardingId, 'a', 1_000, T0 + 2));
    must(h.ledger.storeContract(onboarding.onboardingId, { fence: lease.fence }, { runId: 'run_carrier', digest: 'd', body: {}, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 3 }));
    assert.equal(h.count('runs', "run_id = 'run_carrier'"), 1);
    assert.deepEqual(must(h.ledger.listRuns()), []);
    refused(h.ledger.getRun('run_carrier'), 'not_found');
  });
});

// ---------------------------------------------------------------------------------------------------
// Task 3: attempts, evidence, gate results, work items, decisions, check validations, hook reads
// ---------------------------------------------------------------------------------------------------

function evidenceInput(attemptId: string, over: Record<string, unknown> = {}) {
  return {
    attemptId,
    workItem: 'A',
    kind: 'check',
    name: 'unit',
    status: 'passed' as const,
    revision: 'git:a1b2c3d',
    clean: true,
    treeDigest: 'sha256:' + '7'.repeat(64),
    environment: { os: 'darwin', arch: 'arm64', node: '26.9.0', executor: 'local-sandbox' },
    contractVersion: 1,
    policyRevision: 'sha256:' + '4'.repeat(64),
    independence: 'deterministic' as const,
    acceptance: ['AC1', 'AC2'],
    tests: { total: 214, passed: 214, failed: 0, skipped: 0 },
    command: ['npm', 'test'],
    exitCode: 0,
    durationMs: 41_250,
    artifactDigest: 'sha256:' + '0'.repeat(64),
    nowMs: T0 + 100,
    ...over,
  };
}

describe('run attempts', () => {
  it('gives att_ IDs with ordinals 1 and 2, records an event with run and attempt, and ends an attempt exactly once', () => {
    const h = harness();
    seedRun(h);
    const first = must(h.ledger.recordRunAttempt('run_1', { reason: 'first attempt', nowMs: T0 + 10 }));
    const second = must(h.ledger.recordRunAttempt('run_1', { reason: 'discard and retry', nowMs: T0 + 20 }));
    assert.match(first.attemptId, /^att_/);
    assert.deepEqual([first.ordinal, second.ordinal], [1, 2]);
    assert.equal(first.endedAt, null);
    assert.equal(first.outcome, null);
    const ev = h.db.prepare("SELECT run_id, attempt_id FROM events WHERE type = 'attempt.started' ORDER BY seq").all() as Array<{ run_id: string; attempt_id: string }>;
    assert.deepEqual(ev.map((e) => [e.run_id, e.attempt_id]), [['run_1', first.attemptId], ['run_1', second.attemptId]]);

    const ended = must(h.ledger.endRunAttempt(first.attemptId, { outcome: 'progressed', nowMs: T0 + 30 }));
    assert.equal(ended.endedAt, new Date(T0 + 30).toISOString());
    assert.equal(ended.outcome, 'progressed');
    refused(h.ledger.endRunAttempt(first.attemptId, { outcome: 'failed', nowMs: T0 + 40 }), 'conflict');
    assert.equal(must(h.ledger.listRunAttempts('run_1'))[0]?.outcome, 'progressed');
    assert.deepEqual(must(h.ledger.listRunAttempts('run_1')).map((a) => a.ordinal), [1, 2]);
    assert.equal(h.count('events', "type = 'attempt.ended' AND run_id = 'run_1'"), 1);
  });

  it('refuses an unknown run, an unknown attempt, an empty reason or outcome, and an onboarding carrier', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    h.db.prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_carrier', ?, 'onboarding', 1, 'onboarding onb_1', 'a', 'a')").run(project);
    h.db.prepare("INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_carrier', 'run_carrier', 1, 'r', 'a')").run();
    refused(h.ledger.recordRunAttempt('run_missing', { reason: 'r', nowMs: T0 }), 'not_found');
    refused(h.ledger.recordRunAttempt('run_carrier', { reason: 'r', nowMs: T0 }), 'not_found');
    refused(h.ledger.recordRunAttempt('run_1', { reason: '', nowMs: T0 }), 'invalid');
    refused(h.ledger.endRunAttempt('att_missing', { outcome: 'x', nowMs: T0 }), 'not_found');
    refused(h.ledger.endRunAttempt('att_carrier', { outcome: 'x', nowMs: T0 }), 'not_found');
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 }));
    refused(h.ledger.endRunAttempt(attempt.attemptId, { outcome: '', nowMs: T0 }), 'invalid');
    refused(h.ledger.listRunAttempts('run_missing'), 'not_found');
  });
});

describe('evidence', () => {
  it('records every field of the schema and reads it back through the run, oldest first, with an ev_ ID', () => {
    const h = harness();
    seedRun(h);
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'first attempt', nowMs: T0 + 10 }));
    const recorded = must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId)));
    assert.match(recorded.evidenceId, /^ev_/);
    assert.equal(recorded.runId, 'run_1');
    must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { name: 'lint', status: 'failed', exitCode: 1, nowMs: T0 + 101 })));
    const rows = must(h.ledger.listEvidence('run_1'));
    assert.deepEqual(rows.map((r) => r.name), ['unit', 'lint']);
    const first = rows[0];
    assert.ok(first);
    assert.equal(first.status, 'passed');
    assert.equal(first.attemptId, attempt.attemptId);
    assert.equal(first.workItem, 'A');
    assert.equal(first.kind, 'check');
    assert.equal(first.revision, 'git:a1b2c3d');
    assert.equal(first.clean, true);
    assert.equal(first.treeDigest, 'sha256:' + '7'.repeat(64));
    assert.deepEqual(first.environment, { os: 'darwin', arch: 'arm64', node: '26.9.0', executor: 'local-sandbox' });
    assert.equal(first.contractVersion, 1);
    assert.equal(first.policyRevision, 'sha256:' + '4'.repeat(64));
    assert.equal(first.independence, 'deterministic');
    assert.deepEqual(first.acceptance, ['AC1', 'AC2']);
    assert.deepEqual(first.tests, { total: 214, passed: 214, failed: 0, skipped: 0 });
    assert.deepEqual(first.command, ['npm', 'test']);
    assert.equal(first.exitCode, 0);
    assert.equal(first.durationMs, 41_250);
    assert.equal(first.artifactDigest, 'sha256:' + '0'.repeat(64));
    assert.equal(rows[1]?.exitCode, 1);
    assert.equal(h.count('events', "type = 'evidence.recorded' AND run_id = 'run_1' AND attempt_id IS NOT NULL"), 2);
  });

  it('stores optional fields as null, and a dirty tree as clean false', () => {
    const h = harness();
    seedRun(h);
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    const { workItem: _w, tests: _t, command: _c, exitCode: _e, durationMs: _d, artifactDigest: _a, ...bare } = evidenceInput(attempt.attemptId, { clean: false });
    const row = must(h.ledger.recordEvidence(bare));
    assert.equal(row.clean, false);
    assert.equal(row.workItem, null);
    assert.equal(row.tests, null);
    assert.equal(row.command, null);
    assert.equal(row.exitCode, null);
    assert.equal(row.durationMs, null);
    assert.equal(row.artifactDigest, null);
  });

  it('accepts each of the six statuses and refuses any other as invalid', () => {
    const h = harness();
    seedRun(h);
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    for (const status of ['passed', 'failed', 'skipped', 'unavailable', 'inconclusive', 'stale'] as const) {
      must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { status, name: `n-${status}` })));
    }
    for (const status of ['pass', 'ok', 'PASSED', 'error', '', 'timeout']) {
      const result = h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { status }));
      refused(result, 'invalid');
      assert.ok(!result.ok && result.error.kind === 'invalid' && result.error.field === 'status');
    }
    assert.equal(h.count('evidence'), 6);
  });

  it('refuses an independence outside deterministic, external, model-review, and accepts those three', () => {
    const h = harness();
    seedRun(h);
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    for (const independence of ['deterministic', 'external', 'model-review'] as const) {
      must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { independence, name: `i-${independence}` })));
    }
    refused(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { independence: 'self-reported' })), 'invalid');
    assert.equal(h.count('evidence'), 3);
  });

  it('refuses an unknown attempt, an attempt of an onboarding carrier, a non-boolean clean and a non-object environment', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    h.db.prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_carrier', ?, 'onboarding', 1, 'onboarding onb_1', 'a', 'a')").run(project);
    h.db.prepare("INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_carrier', 'run_carrier', 1, 'r', 'a')").run();
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    refused(h.ledger.recordEvidence(evidenceInput('att_missing')), 'not_found');
    refused(h.ledger.recordEvidence(evidenceInput('att_carrier')), 'not_found');
    refused(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { clean: 'yes' })), 'invalid');
    refused(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { environment: 'darwin' })), 'invalid');
    refused(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { name: '' })), 'invalid');
    refused(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { contractVersion: 0 })), 'invalid');
    refused(h.ledger.listEvidence('run_missing'), 'not_found');
    assert.equal(h.count('evidence'), 0);
  });

  it('is insert-only: an interrupted check is marked by a new inconclusive row, and the database refuses an UPDATE or DELETE (T-02-06)', () => {
    const h = harness();
    seedRun(h);
    const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { status: 'passed' })));
    must(h.ledger.recordEvidence(evidenceInput(attempt.attemptId, { status: 'inconclusive', nowMs: T0 + 200 })));
    assert.deepEqual(must(h.ledger.listEvidence('run_1')).map((r) => r.status), ['passed', 'inconclusive']);
    assert.throws(() => h.db.prepare("UPDATE evidence SET status = 'passed' WHERE status = 'inconclusive'").run(), /insert-only/);
    assert.throws(() => h.db.prepare('DELETE FROM evidence').run(), /insert-only/);
    assert.equal(h.count('evidence'), 2);
  });

  it('keeps evidence of different runs apart', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    seedRun(h, 'run_2', project);
    const a1 = must(h.ledger.recordRunAttempt('run_1', { reason: 'r', nowMs: T0 + 10 }));
    const a2 = must(h.ledger.recordRunAttempt('run_2', { reason: 'r', nowMs: T0 + 10 }));
    must(h.ledger.recordEvidence(evidenceInput(a1.attemptId, { name: 'one' })));
    must(h.ledger.recordEvidence(evidenceInput(a2.attemptId, { name: 'two' })));
    assert.deepEqual(must(h.ledger.listEvidence('run_1')).map((r) => r.name), ['one']);
    assert.deepEqual(must(h.ledger.listEvidence('run_2')).map((r) => r.name), ['two']);
  });
});

describe('gate results', () => {
  const gate = { runId: 'run_1', gate: 'G2', workItem: 'A', contractVersion: 1, policyRevision: 'p', revision: 'git:abc', passed: false, failures: [{ rule: 'scope', detail: 'src/x.ts outside write' }], nowMs: T0 + 50 };

  it('round trips failures_json, passed and the revision, oldest first, and records an event with the run', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.recordGateResult(gate));
    must(h.ledger.recordGateResult({ ...gate, gate: 'G4', workItem: undefined, passed: true, failures: [], nowMs: T0 + 60 }));
    const rows = must(h.ledger.listGateResults('run_1'));
    assert.deepEqual(rows.map((r) => [r.gate, r.passed, r.workItem]), [['G2', false, 'A'], ['G4', true, null]]);
    assert.deepEqual(rows[0]?.failures, [{ rule: 'scope', detail: 'src/x.ts outside write' }]);
    assert.deepEqual(rows[1]?.failures, []);
    assert.equal(rows[0]?.revision, 'git:abc');
    assert.equal(rows[0]?.contractVersion, 1);
    assert.equal(h.count('events', "type = 'gate.result' AND run_id = 'run_1'"), 2);
  });

  it('refuses an empty gate name, a non-boolean passed and an unknown run, and is insert-only', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.recordGateResult({ ...gate, gate: '' }), 'invalid');
    refused(h.ledger.recordGateResult({ ...gate, passed: 1 as unknown as boolean }), 'invalid');
    refused(h.ledger.recordGateResult({ ...gate, runId: 'run_missing' }), 'not_found');
    refused(h.ledger.listGateResults('run_missing'), 'not_found');
    must(h.ledger.recordGateResult(gate));
    assert.throws(() => h.db.prepare('UPDATE gate_results SET passed = 1').run(), /insert-only/);
    assert.throws(() => h.db.prepare('DELETE FROM gate_results').run(), /insert-only/);
    assert.equal(h.count('gate_results'), 1);
  });
});

describe('work items', () => {
  const item = { runId: 'run_1', itemId: 'A', dependsOn: [] as string[], size: 'medium', model: 'sonnet', spec: { goal: 'fix slug' }, nowMs: T0 + 10 };

  it('upserts an item at ready, keeps its state on a second upsert, and lists them', () => {
    const h = harness();
    seedRun(h);
    const created = must(h.ledger.upsertWorkItem(item));
    assert.equal(created.state, 'ready');
    assert.equal(created.type, 'implement');
    assert.equal(created.attempts, 0);
    assert.deepEqual(created.spec, { goal: 'fix slug' });
    must(h.ledger.upsertWorkItem({ ...item, itemId: 'B', dependsOn: ['A'], type: 'harden' }));
    const lease = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 11));
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence: lease.fence }, { to: 'delegated', nowMs: T0 + 12 }));
    const again = must(h.ledger.upsertWorkItem({ ...item, size: 'large', spec: { goal: 'fix slug', more: true } }));
    assert.equal(again.state, 'delegated', 'an upsert never moves the state');
    assert.equal(again.size, 'large');
    assert.equal(again.attempts, 1);
    const all = must(h.ledger.listWorkItems('run_1'));
    assert.deepEqual(all.map((i) => [i.itemId, i.state, i.type, i.dependsOn]), [['A', 'delegated', 'implement', []], ['B', 'ready', 'harden', ['A']]]);
  });

  it('applies assertItemTransition, appends a work_item.transition event with the run, and counts delegations as attempts', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.upsertWorkItem(item));
    const fence = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 11)).fence;
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'delegated', nowMs: T0 + 12, gsdSession: 'sess-1' }));
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'ready', nowMs: T0 + 13 }));
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'delegated', nowMs: T0 + 14 }));
    for (const to of ['implemented', 'gated', 'done'] as const) must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to, nowMs: T0 + 20 }));
    const done = must(h.ledger.listWorkItems('run_1'))[0];
    assert.equal(done?.state, 'done');
    assert.equal(done?.attempts, 2);
    assert.equal(done?.gsdSession, 'sess-1');
    const events = h.db.prepare("SELECT run_id, data_json FROM events WHERE type = 'work_item.transition' ORDER BY seq").all() as Array<{ run_id: string; data_json: string }>;
    assert.equal(events.length, 6);
    assert.ok(events.every((e) => e.run_id === 'run_1'));
    const last = JSON.parse(events[5]?.data_json ?? '{}') as Record<string, unknown>;
    assert.equal(last['itemId'], 'A');
    assert.equal(last['from'], 'gated');
    assert.equal(last['to'], 'done');
  });

  it('refuses an invalid edge as invalid, a stale fence as conflict and an unknown item or run as not_found, writing nothing', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.upsertWorkItem(item));
    const fence = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 11)).fence;
    const before = h.count('events');
    const skip = h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'done', nowMs: T0 + 12 });
    refused(skip, 'invalid');
    assert.ok(!skip.ok && skip.error.kind === 'invalid' && skip.error.field === 'state');
    refused(h.ledger.transitionWorkItem('run_1', 'A', { fence: fence + 1 }, { to: 'delegated', nowMs: T0 + 12 }), 'conflict');
    refused(h.ledger.transitionWorkItem('run_1', 'Z', { fence }, { to: 'delegated', nowMs: T0 + 12 }), 'not_found');
    refused(h.ledger.transitionWorkItem('run_missing', 'A', { fence }, { to: 'delegated', nowMs: T0 + 12 }), 'not_found');
    assert.equal(h.count('events'), before);
    assert.equal(must(h.ledger.listWorkItems('run_1'))[0]?.state, 'ready');
  });

  it('lets any non-done item move to blocked_on_decision and back to ready, and nothing leave done', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.upsertWorkItem(item));
    const fence = must(h.ledger.acquireRunLease('run_1', 'a', 1_000, T0 + 11)).fence;
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'delegated', nowMs: T0 + 12 }));
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'blocked_on_decision', nowMs: T0 + 13 }));
    must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'ready', nowMs: T0 + 14 }));
    for (const to of ['delegated', 'implemented', 'gated', 'done'] as const) must(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to, nowMs: T0 + 20 }));
    refused(h.ledger.transitionWorkItem('run_1', 'A', { fence }, { to: 'blocked_on_decision', nowMs: T0 + 30 }), 'invalid');
  });

  it('refuses a malformed item: empty ID, unknown type, unknown run', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.upsertWorkItem({ ...item, itemId: '' }), 'invalid');
    refused(h.ledger.upsertWorkItem({ ...item, type: 'refactor' as never }), 'invalid');
    refused(h.ledger.upsertWorkItem({ ...item, runId: 'run_missing' }), 'not_found');
    refused(h.ledger.listWorkItems('run_missing'), 'not_found');
    assert.equal(h.count('work_items'), 0);
  });
});

describe('decisions', () => {
  const decision = {
    runId: 'run_1',
    contractVersion: 1,
    class: 'acceptance',
    issue: 'The brief does not say whether slugs keep digits',
    options: [{ id: 'keep', label: 'keep digits' }, { id: 'drop', label: 'drop digits' }],
    consequences: { keep: 'matches the tests', drop: 'breaks 3 tests' },
    evidenceRefs: ['ev_1'],
    affectedItems: ['A'],
    stateDigest: 'sha256:' + '9'.repeat(64),
    urgency: 'blocking' as const,
    nowMs: T0 + 70,
  };

  it('opens a decision in state open with a dec_ ID, an event with the run, and filters by run and state', () => {
    const h = harness();
    const project = seedProject(h);
    seedRun(h, 'run_1', project);
    seedRun(h, 'run_2', project);
    const opened = must(h.ledger.openDecision(decision));
    assert.match(opened.decisionId, /^dec_/);
    assert.equal(opened.state, 'open');
    assert.equal(opened.class, 'acceptance');
    assert.equal(opened.recommendation, null);
    assert.equal(opened.authorizedDefault, null);
    assert.equal(opened.answeredAt, null);
    assert.deepEqual(opened.options, decision.options);
    assert.deepEqual(opened.affectedItems, ['A']);
    assert.deepEqual(opened.evidenceRefs, ['ev_1']);
    const other = must(h.ledger.openDecision({ ...decision, runId: 'run_2', class: 'budget', urgency: 'digest', recommendation: 'raise the cap', authorizedDefault: 'stop', nowMs: T0 + 80 }));
    assert.equal(other.recommendation, 'raise the cap');
    assert.equal(other.authorizedDefault, 'stop');
    assert.deepEqual(must(h.ledger.listDecisions({})).map((d) => d.decisionId), [opened.decisionId, other.decisionId]);
    assert.deepEqual(must(h.ledger.listDecisions({ runId: 'run_2' })).map((d) => d.decisionId), [other.decisionId]);
    assert.deepEqual(must(h.ledger.listDecisions({ state: 'open' })).length, 2);
    assert.deepEqual(must(h.ledger.listDecisions({ state: 'answered' })), []);
    assert.deepEqual(must(h.ledger.listDecisions({ runId: 'run_1', state: 'open' })).map((d) => d.decisionId), [opened.decisionId]);
    assert.equal(h.count('events', "type = 'decision.opened' AND run_id = 'run_1'"), 1);
  });

  it('accepts exactly the eight documented classes and the two urgencies, and refuses anything else', () => {
    const h = harness();
    seedRun(h);
    for (const cls of ['acceptance', 'architecture', 'scope_expansion', 'permission', 'repeated_failure', 'equivalent_mutant', 'contradiction', 'budget']) {
      must(h.ledger.openDecision({ ...decision, class: cls }));
    }
    refused(h.ledger.openDecision({ ...decision, class: 'preference' }), 'invalid');
    refused(h.ledger.openDecision({ ...decision, urgency: 'whenever' as never }), 'invalid');
    refused(h.ledger.openDecision({ ...decision, issue: '' }), 'invalid');
    refused(h.ledger.openDecision({ ...decision, contractVersion: 0 }), 'invalid');
    refused(h.ledger.openDecision({ ...decision, runId: 'run_missing' }), 'not_found');
    assert.equal(h.count('decisions'), 8);
  });

  it('refuses a filter state outside open, answered, stale, withdrawn', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.listDecisions({ state: 'closed' as never }), 'invalid');
  });
});

describe('check validations', () => {
  const validation = { projectId: 'proj_1', baseRevision: 'git:9f1cd8d', specDigest: 'sha256:' + '5'.repeat(64), name: 'test', verdict: 'active', detail: { reason: 'wrote only declared paths' }, nowMs: T0 + 90 };

  it('round trips one row per check name and filters by project, revision and spec digest', () => {
    const h = harness();
    must(h.ledger.recordCheckValidation(validation));
    must(h.ledger.recordCheckValidation({ ...validation, name: 'lint', verdict: 'rejected', detail: { reason: 'unexpected-write', paths: ['dist/x'] } }));
    must(h.ledger.recordCheckValidation({ ...validation, specDigest: 'sha256:' + '6'.repeat(64), name: 'test' }));
    const rows = must(h.ledger.getCheckValidations('proj_1', 'git:9f1cd8d', validation.specDigest));
    assert.deepEqual(rows.map((r) => [r.name, r.verdict]), [['test', 'active'], ['lint', 'rejected']]);
    assert.deepEqual(rows[1]?.detail, { reason: 'unexpected-write', paths: ['dist/x'] });
    assert.equal(rows[0]?.validatedAt, new Date(T0 + 90).toISOString());
    assert.deepEqual(must(h.ledger.getCheckValidations('proj_1', 'git:other', validation.specDigest)), []);
    assert.deepEqual(must(h.ledger.getCheckValidations('proj_2', 'git:9f1cd8d', validation.specDigest)), []);
    assert.equal(must(h.ledger.getCheckValidations('proj_1', 'git:9f1cd8d', 'sha256:' + '6'.repeat(64))).length, 1);
  });

  it('never overwrites a verdict: a second record for the same key is a conflict that leaves the first', () => {
    const h = harness();
    must(h.ledger.recordCheckValidation(validation));
    refused(h.ledger.recordCheckValidation({ ...validation, verdict: 'rejected', detail: { reason: 'network' }, nowMs: T0 + 95 }), 'conflict');
    const [row] = must(h.ledger.getCheckValidations('proj_1', 'git:9f1cd8d', validation.specDigest));
    assert.equal(row?.verdict, 'active');
    assert.equal(h.count('check_validations'), 1);
  });

  it('refuses an empty name or verdict', () => {
    const h = harness();
    refused(h.ledger.recordCheckValidation({ ...validation, name: '' }), 'invalid');
    refused(h.ledger.recordCheckValidation({ ...validation, verdict: '' }), 'invalid');
    assert.equal(h.count('check_validations'), 0);
  });
});

describe('hook reads', () => {
  it('lists the rows the hook wrote with its own SQL, by seq, for one invocation', () => {
    const h = harness();
    const insert = h.db.prepare('INSERT INTO hook_reads (invocation_id, agent_id, path, digest, seq, recorded_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('inv_1', 'main', 'src/b.ts', 'sha256:bb', 2, '2026-11-05T09:00:02.000Z');
    insert.run('inv_1', 'main', 'src/a.ts', 'sha256:aa', 1, '2026-11-05T09:00:01.000Z');
    insert.run('inv_1', 'sub-1', 'src/a.ts', 'sha256:aa', 3, '2026-11-05T09:00:03.000Z');
    insert.run('inv_2', 'main', 'src/c.ts', 'sha256:cc', 1, '2026-11-05T09:00:04.000Z');
    const rows = must(h.ledger.listHookReads('inv_1'));
    assert.deepEqual(rows.map((r) => [r.agentId, r.path, r.digest, r.seq]), [['main', 'src/a.ts', 'sha256:aa', 1], ['main', 'src/b.ts', 'sha256:bb', 2], ['sub-1', 'src/a.ts', 'sha256:aa', 3]]);
    assert.equal(rows[0]?.invocationId, 'inv_1');
    assert.equal(rows[0]?.recordedAt, '2026-11-05T09:00:01.000Z');
    assert.deepEqual(must(h.ledger.listHookReads('inv_none')), []);
  });
});
