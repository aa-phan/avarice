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
