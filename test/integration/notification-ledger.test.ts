// The delivery state of notifications and the run cancel request (docs/contracts-and-state.md; plan 03-12, AUT-6, AUT-12).
// A notification row moves pending -> delivered | failed | held and held -> delivered | failed with its attempts counted; a cancel
// request is recorded once on the run row. Every write is observed with raw SQL; events carry IDs, counts and codes only.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { ID_PREFIXES, newId } from '../../src/domain/ids.ts';
import type { Result } from '../../src/domain/result.ts';

const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);

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
  count(table: string, where?: string): number;
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-notification-ledger-'));
  cleanup.push(dir);
  const db = must(openDb(join(dir, 'state.db')));
  must(migrate(db, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003], { nowMs: T0 }));
  let n = 0;
  const ledger = new SqliteLedger(db, (prefix) => prefix + String(++n).padStart(26, '0'));
  return {
    ledger,
    db,
    count: (table, where = '1=1') => Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n),
  };
}

function seedRun(h: Harness): void {
  must(h.ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: T0 }));
  must(h.ledger.createRun({ runId: 'run_1', projectId: 'proj_1', title: 'fix the slug helper', nowMs: T0 + 1 }));
}

function eventsOf(h: Harness, type: string): Array<Record<string, unknown>> {
  return (h.db.prepare('SELECT data_json FROM events WHERE type = ? ORDER BY seq').all(type) as Array<{ data_json: string }>).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

function create(h: Harness, overrides: Partial<Parameters<SqliteLedger['createNotification']>[0]> = {}) {
  return must(
    h.ledger.createNotification({ runId: 'run_1', kind: 'decisions', destination: 'local', subjectIds: ['dec_1', 'dec_2'], state: 'pending', nowMs: T0 + 10, ...overrides }),
  );
}

describe('the ntf_ ID prefix', () => {
  it('is an ID prefix and builds a ULID-suffixed ID', () => {
    assert.ok(ID_PREFIXES.includes('ntf_'));
    assert.match(newId('ntf_', T0, new Uint8Array(10)), /^ntf_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('createNotification and listNotifications', () => {
  it('creates a pending row with an ntf_ ID, no attempts and no delivery time', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    assert.match(row.notificationId, /^ntf_/);
    assert.equal(row.runId, 'run_1');
    assert.equal(row.kind, 'decisions');
    assert.equal(row.destination, 'local');
    assert.deepEqual(row.subjectIds, ['dec_1', 'dec_2']);
    assert.equal(row.state, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.nextAttemptAt, null);
    assert.equal(row.lastError, null);
    assert.equal(row.deliveredAt, null);
    assert.equal(row.createdAt, new Date(T0 + 10).toISOString());
    assert.equal(row.updatedAt, row.createdAt);
  });

  it('creates a digest row with no run, and a row that starts held', () => {
    const h = harness();
    const digest = create(h, { runId: null, kind: 'digest', subjectIds: ['dec_9'] });
    assert.equal(digest.runId, null);
    assert.equal(create(h, { runId: null, state: 'held' }).state, 'held');
  });

  it('refuses an empty kind, destination or subject list, and a run that does not exist', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.createNotification({ runId: 'run_1', kind: '', destination: 'local', subjectIds: ['dec_1'], state: 'pending', nowMs: T0 }), 'invalid');
    refused(h.ledger.createNotification({ runId: 'run_1', kind: 'decisions', destination: '', subjectIds: ['dec_1'], state: 'pending', nowMs: T0 }), 'invalid');
    refused(h.ledger.createNotification({ runId: 'run_1', kind: 'decisions', destination: 'local', subjectIds: [], state: 'pending', nowMs: T0 }), 'invalid');
    refused(h.ledger.createNotification({ runId: 'run_missing', kind: 'decisions', destination: 'local', subjectIds: ['dec_1'], state: 'pending', nowMs: T0 }), 'not_found');
    assert.equal(h.count('notifications'), 0);
  });

  it('lists rows oldest first, filtered by state and run', () => {
    const h = harness();
    seedRun(h);
    const first = create(h, { nowMs: T0 + 10 });
    const second = create(h, { nowMs: T0 + 20, state: 'held' });
    const third = create(h, { nowMs: T0 + 30, runId: null });
    must(h.ledger.recordNotificationAttempt(first.notificationId, { outcome: 'delivered', nowMs: T0 + 40 }));
    assert.deepEqual(must(h.ledger.listNotifications()).map((r) => r.notificationId), [first.notificationId, second.notificationId, third.notificationId]);
    assert.deepEqual(must(h.ledger.listNotifications({ states: ['pending', 'held', 'failed'] })).map((r) => r.notificationId), [second.notificationId, third.notificationId]);
    assert.deepEqual(must(h.ledger.listNotifications({ runId: 'run_1' })).map((r) => r.notificationId), [first.notificationId, second.notificationId]);
    assert.deepEqual(must(h.ledger.listNotifications({ states: [] })), []);
  });
});

describe('recordNotificationAttempt', () => {
  it('counts a failed attempt that has a retry: state pending, the code kept, the next time set, one notify.failed event', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    const after = must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'osascript-missing', nextAttemptAtMs: T0 + 60_000, nowMs: T0 + 20 }));
    assert.equal(after.attempts, 1);
    assert.equal(after.state, 'pending');
    assert.equal(after.lastError, 'osascript-missing');
    assert.equal(after.nextAttemptAt, new Date(T0 + 60_000).toISOString());
    assert.equal(after.updatedAt, new Date(T0 + 20).toISOString());
    assert.equal(after.deliveredAt, null);
    assert.deepEqual(eventsOf(h, 'notify.failed'), [{ notificationId: row.notificationId, runId: 'run_1', attempt: 1, code: 'osascript-missing' }]);
    assert.equal(eventsOf(h, 'notify.delivered').length, 0);
  });

  it('delivers on a later attempt: state delivered, delivered_at set, no next time, one notify.delivered event', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'timeout', nextAttemptAtMs: T0 + 60_000, nowMs: T0 + 20 }));
    const done = must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 90_000 }));
    assert.equal(done.attempts, 2);
    assert.equal(done.state, 'delivered');
    assert.equal(done.deliveredAt, new Date(T0 + 90_000).toISOString());
    assert.equal(done.nextAttemptAt, null);
    assert.deepEqual(eventsOf(h, 'notify.delivered'), [{ notificationId: row.notificationId, runId: 'run_1', attempt: 2 }]);
  });

  it('ends the row as failed when a failed attempt has no next attempt', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    const done = must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'exit-1', nowMs: T0 + 20 }));
    assert.equal(done.state, 'failed');
    assert.equal(done.attempts, 1);
    assert.equal(done.nextAttemptAt, null);
    assert.equal(done.lastError, 'exit-1');
  });

  it('attempts a held row, which keeps its state while a retry is due and becomes delivered on success', () => {
    const h = harness();
    seedRun(h);
    const row = create(h, { state: 'held' });
    assert.equal(must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'timeout', nextAttemptAtMs: T0 + 5_000, nowMs: T0 + 20 })).state, 'held');
    assert.equal(must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 30 })).state, 'delivered');
  });

  it('writes a digest notification event with a null run ID', () => {
    const h = harness();
    const row = create(h, { runId: null, kind: 'digest' });
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 20 }));
    assert.deepEqual(eventsOf(h, 'notify.delivered'), [{ notificationId: row.notificationId, runId: null, attempt: 1 }]);
  });

  it('refuses an attempt on a delivered or failed row, an unknown row, and a bad error code, writing nothing', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    const eventsBefore = h.count('events');
    for (const code of ['', 'Has Capitals', 'with space', 'x'.repeat(65), 'tab\t', 'dev/null']) {
      refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: code, nowMs: T0 + 20 }), 'invalid');
    }
    refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', nowMs: T0 + 20 }), 'invalid');
    refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', errorCode: 'x', nowMs: T0 + 20 }), 'invalid');
    refused(h.ledger.recordNotificationAttempt('ntf_missing', { outcome: 'delivered', nowMs: T0 + 20 }), 'not_found');
    assert.equal(must(h.ledger.listNotifications())[0]?.attempts, 0);
    assert.equal(h.count('events'), eventsBefore);
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 30 }));
    refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 40 }), 'conflict');
    const failed = create(h);
    must(h.ledger.recordNotificationAttempt(failed.notificationId, { outcome: 'failed', errorCode: 'exit-1', nowMs: T0 + 50 }));
    refused(h.ledger.recordNotificationAttempt(failed.notificationId, { outcome: 'delivered', nowMs: T0 + 60 }), 'conflict');
    assert.equal(must(h.ledger.listNotifications()).find((r) => r.notificationId === failed.notificationId)?.attempts, 1);
  });

  it('keeps every event free of anything but IDs, the attempt count and the code', () => {
    const h = harness();
    seedRun(h);
    const row = create(h, { subjectIds: ['dec_1'] });
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'osascript-missing', nextAttemptAtMs: T0 + 100, nowMs: T0 + 20 }));
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 30 }));
    for (const type of ['notify.failed', 'notify.delivered']) {
      for (const data of eventsOf(h, type)) {
        assert.deepEqual(Object.keys(data).filter((k) => !['notificationId', 'runId', 'attempt', 'code'].includes(k)), []);
      }
    }
  });
});

describe('setNotificationState', () => {
  it('moves pending rows to held, and held rows to delivered or failed', () => {
    const h = harness();
    seedRun(h);
    const a = create(h);
    const b = create(h);
    const held = must(h.ledger.setNotificationState([a.notificationId, b.notificationId], 'held', T0 + 20));
    assert.deepEqual(held.map((r) => r.state), ['held', 'held']);
    assert.equal(held[0]?.updatedAt, new Date(T0 + 20).toISOString());
    const delivered = must(h.ledger.setNotificationState([a.notificationId], 'delivered', T0 + 30));
    assert.equal(delivered[0]?.state, 'delivered');
    assert.equal(delivered[0]?.deliveredAt, new Date(T0 + 30).toISOString());
    assert.equal(must(h.ledger.setNotificationState([b.notificationId], 'failed', T0 + 40))[0]?.state, 'failed');
  });

  it('also moves a pending row straight to delivered or failed', () => {
    const h = harness();
    seedRun(h);
    const a = create(h);
    const b = create(h);
    assert.equal(must(h.ledger.setNotificationState([a.notificationId], 'delivered', T0 + 20))[0]?.state, 'delivered');
    assert.equal(must(h.ledger.setNotificationState([b.notificationId], 'failed', T0 + 20))[0]?.state, 'failed');
  });

  // The one way out of `failed`: a digest that succeeds covers the banners that did not arrive (plan 03-23). `failed` stays final for the delivery of a
  // single banner, so recordNotificationAttempt on a failed row is still a conflict.
  it('moves a failed row to delivered, stamps its delivery time, and refuses every other move out of failed', () => {
    const h = harness();
    seedRun(h);
    const row = create(h);
    must(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'osascript-failed', nowMs: T0 + 20 }));
    assert.equal(must(h.ledger.listNotifications({ states: ['failed'] })).length, 1);
    for (const state of ['held', 'pending'] as const) refused(h.ledger.setNotificationState([row.notificationId], state as 'held', T0 + 25), 'invalid');
    refused(h.ledger.setNotificationState([row.notificationId], 'failed', T0 + 25), 'invalid');
    refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'delivered', nowMs: T0 + 26 }), 'conflict');
    assert.equal(must(h.ledger.listNotifications({ states: ['failed'] })).length, 1, 'the refused moves changed nothing');
    const moved = must(h.ledger.setNotificationState([row.notificationId], 'delivered', T0 + 30))[0];
    assert.equal(moved?.state, 'delivered');
    assert.equal(moved?.deliveredAt, new Date(T0 + 30).toISOString());
    assert.equal(moved?.attempts, 1, 'the attempts already made are kept');
    refused(h.ledger.setNotificationState([row.notificationId], 'failed', T0 + 40), 'invalid');
    refused(h.ledger.recordNotificationAttempt(row.notificationId, { outcome: 'failed', errorCode: 'x', nowMs: T0 + 40 }), 'conflict');
  });

  it('refuses a move that is not allowed and moves none of the named rows', () => {
    const h = harness();
    seedRun(h);
    const a = create(h);
    const b = create(h);
    must(h.ledger.setNotificationState([b.notificationId], 'delivered', T0 + 20));
    refused(h.ledger.setNotificationState([a.notificationId, b.notificationId], 'held', T0 + 30), 'invalid');
    assert.equal(must(h.ledger.listNotifications({ states: ['pending'] })).length, 1);
    refused(h.ledger.setNotificationState([b.notificationId], 'failed', T0 + 30), 'invalid');
    refused(h.ledger.setNotificationState([a.notificationId, 'ntf_missing'], 'held', T0 + 30), 'not_found');
    assert.equal(must(h.ledger.listNotifications({ states: ['pending'] })).length, 1);
    refused(h.ledger.setNotificationState([a.notificationId], 'pending' as 'held', T0 + 30), 'invalid');
  });
});

describe('requestRunCancel', () => {
  it('records the request once on the run row and appends one run.cancel_requested event', () => {
    const h = harness();
    seedRun(h);
    assert.equal(must(h.ledger.getRun('run_1')).cancelRequestedAt, null);
    const first = must(h.ledger.requestRunCancel('run_1', { by: 'owner:aphan', nowMs: T0 + 20 }));
    assert.deepEqual(first, { requestedAt: new Date(T0 + 20).toISOString(), requestedBy: 'owner:aphan', repeated: false });
    assert.equal(must(h.ledger.getRun('run_1')).cancelRequestedAt, new Date(T0 + 20).toISOString());
    const stored = h.db.prepare("SELECT cancel_requested_at, cancel_requested_by FROM runs WHERE run_id = 'run_1'").get() as Record<string, unknown>;
    assert.deepEqual({ ...stored }, { cancel_requested_at: new Date(T0 + 20).toISOString(), cancel_requested_by: 'owner:aphan' });
    assert.deepEqual(eventsOf(h, 'run.cancel_requested'), [{ runId: 'run_1', requestedBy: 'owner:aphan' }]);
  });

  it('returns the first request for a repeat, with no second event and no change to the row', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.requestRunCancel('run_1', { by: 'owner:aphan', nowMs: T0 + 20 }));
    const again = must(h.ledger.requestRunCancel('run_1', { by: 'someone-else', nowMs: T0 + 99 }));
    assert.deepEqual(again, { requestedAt: new Date(T0 + 20).toISOString(), requestedBy: 'owner:aphan', repeated: true });
    assert.equal(eventsOf(h, 'run.cancel_requested').length, 1);
    assert.equal(must(h.ledger.getRun('run_1')).cancelRequestedAt, new Date(T0 + 20).toISOString());
  });

  it('does not move the run version, state or lease', () => {
    const h = harness();
    seedRun(h);
    const lease = must(h.ledger.acquireRunLease('run_1', 'supervisor', 1_000_000, T0 + 5));
    const before = must(h.ledger.getRun('run_1'));
    must(h.ledger.requestRunCancel('run_1', { by: 'owner', nowMs: T0 + 20 }));
    const after = must(h.ledger.getRun('run_1'));
    assert.equal(after.version, before.version);
    assert.equal(after.state, before.state);
    assert.equal(after.leaseHolder, 'supervisor');
    assert.equal(after.leaseFence, lease.fence);
  });

  it('refuses a closed run with conflict and an unknown run with not_found, and an empty requester', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.requestRunCancel('run_1', { by: '', nowMs: T0 + 20 }), 'invalid');
    refused(h.ledger.requestRunCancel('run_missing', { by: 'owner', nowMs: T0 + 20 }), 'not_found');
    h.db.exec("UPDATE runs SET state = 'closed' WHERE run_id = 'run_1'");
    refused(h.ledger.requestRunCancel('run_1', { by: 'owner', nowMs: T0 + 20 }), 'conflict');
    assert.equal(h.count('events', "type = 'run.cancel_requested'"), 0);
    assert.equal(must(h.ledger.getRun('run_1')).cancelRequestedAt, null);
  });
});
