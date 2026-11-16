// The decision side of the ledger (docs/contracts-and-state.md "Decision records"; plan 03-02, AUT-2, AUT-5, AUT-12).
// A decision is answered, made stale (and re-opened with the old answer kept as context) or withdrawn in one ledger
// transaction under the run lock; every write is observed with raw SQL. The upgrade case builds a version 2 store
// with raw SQL (the Phase 2 schema has no item_id or supersedes column) and migrates it to version 3.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import type { Migration } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import type { DecisionInput } from '../../src/ports/ledger.ts';
import type { Result } from '../../src/domain/result.ts';

const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);
const DIGEST_1 = 'sha256:' + '9'.repeat(64);
const DIGEST_2 = 'sha256:' + '8'.repeat(64);
const ANSWER = 'keep the digits, and say so in the docstring (private answer text)';

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

function harness(migrations: readonly Migration[] = [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003]): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-decision-ledger-'));
  cleanup.push(dir);
  const db = must(openDb(join(dir, 'state.db')));
  must(migrate(db, migrations, { nowMs: T0 }));
  let n = 0;
  const ledger = new SqliteLedger(db, (prefix) => prefix + String(++n).padStart(26, '0'));
  return {
    ledger,
    db,
    dir,
    count: (table, where = '1=1') => Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n),
  };
}

const BODY = { schema: 1, policyPreset: 'routine' };

// A run with contract version 1 and the named items, each moved to blocked_on_decision.
function seedBlockedRun(h: Harness, items: readonly string[] = ['A', 'B'], blocked: readonly string[] = ['B']): void {
  must(h.ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: T0 }));
  must(h.ledger.createRun({ runId: 'run_1', projectId: 'proj_1', title: 'fix the slug helper', nowMs: T0 + 1 }));
  must(h.ledger.storeRunContract('run_1', { fence: 0 }, { version: 1, digest: 'sha256:' + 'a'.repeat(64), body: BODY, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 2 }));
  for (const itemId of items) {
    must(h.ledger.upsertWorkItem({ runId: 'run_1', itemId, dependsOn: [], size: 'medium', model: 'sonnet', spec: { goal: itemId }, nowMs: T0 + 3 }));
  }
  const lease = must(h.ledger.acquireRunLease('run_1', 'holder', 1_000_000, T0 + 4));
  for (const itemId of blocked) must(h.ledger.transitionWorkItem('run_1', itemId, { fence: lease.fence }, { to: 'blocked_on_decision', nowMs: T0 + 5 }));
}

function decisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    runId: 'run_1',
    contractVersion: 1,
    class: 'acceptance',
    issue: 'The brief does not say whether slugs keep digits',
    recommendation: 'keep',
    options: [{ id: 'keep', label: 'keep digits' }, { id: 'drop', label: 'drop digits' }],
    consequences: { keep: 'matches the tests', drop: 'breaks 3 tests' },
    evidenceRefs: ['ev_1'],
    affectedItems: ['B'],
    authorizedDefault: 'keep',
    stateDigest: DIGEST_1,
    urgency: 'blocking',
    nowMs: T0 + 10,
    ...overrides,
  };
}

function answerInput(decisionId: string, overrides: Record<string, unknown> = {}) {
  return { runId: 'run_1', decisionId, answer: ANSWER, answeredBy: 'owner', channel: 'terminal' as const, expectContractVersion: 1, nowMs: T0 + 20, ...overrides };
}

function itemState(h: Harness, itemId: string): string {
  return (h.db.prepare("SELECT state FROM work_items WHERE run_id = 'run_1' AND item_id = ?").get(itemId) as { state: string }).state;
}

function eventsOf(h: Harness, type: string): Array<Record<string, unknown>> {
  return (h.db.prepare('SELECT data_json FROM events WHERE type = ? ORDER BY seq').all(type) as Array<{ data_json: string }>).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

describe('migration 0003 (schema version 3)', () => {
  it('reaches version 3 on a fresh store in one run, with the new columns and the notifications table', () => {
    const h = harness();
    assert.equal((h.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value, '3');
    assert.ok(columns(h.db, 'attempts').includes('item_id'));
    assert.ok(columns(h.db, 'decisions').includes('supersedes'));
    assert.ok(columns(h.db, 'runs').includes('cancel_requested_at'));
    assert.ok(columns(h.db, 'runs').includes('cancel_requested_by'));
    assert.deepEqual(columns(h.db, 'notifications'), [
      'notification_id', 'run_id', 'kind', 'destination', 'subject_ids_json', 'state', 'attempts', 'next_attempt_at', 'last_error', 'created_at', 'updated_at', 'delivered_at',
    ]);
    const names = (h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);
    assert.ok(names.includes('attempts_item'));
    assert.ok(names.includes('notifications_state'));
  });

  it('upgrades a version 2 store: backup first, every row kept, the new columns NULL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-decision-upgrade-'));
    cleanup.push(dir);
    const db = must(openDb(join(dir, 'state.db')));
    must(migrate(db, [MIGRATION_0001, MIGRATION_0002], { nowMs: T0 }));
    db.exec(`
      INSERT INTO projects (project_id, root_commit, repo_path, remote, default_branch, created_at) VALUES ('proj_1', 'root1', '/repo/1', NULL, 'main', '2026-11-08T09:00:00.000Z');
      INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES ('run_1', 'proj_1', 'running', 2, 'old run', '2026-11-08T09:00:00.000Z', '2026-11-08T09:00:00.000Z');
      INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES ('att_1', 'run_1', 1, 'first', '2026-11-08T09:00:00.000Z');
      INSERT INTO decisions (decision_id, run_id, contract_version, class, issue, options_json, consequences_json, evidence_refs_json, affected_items_json, state_digest, urgency, state, opened_at)
        VALUES ('dec_1', 'run_1', 1, 'acceptance', 'q', '[]', '{}', '[]', '["A"]', 'd', 'blocking', 'open', '2026-11-08T09:00:00.000Z');
    `);
    const before = { runs: 1, attempts: 1, decisions: 1 };
    const backupDir = join(dir, 'backups');
    const migrated = must(migrate(db, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003], { nowMs: T0 + 1000, backupDir }));
    assert.deepEqual(migrated, { from: 2, to: 3, applied: [3] });
    assert.ok(existsSync(backupDir));
    assert.equal(readdirSync(backupDir).length, 1, 'a pre-migration backup was written');
    const count = (table: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
    assert.deepEqual({ runs: count('runs'), attempts: count('attempts'), decisions: count('decisions') }, before);
    assert.equal(count('notifications'), 0);
    const attempt = db.prepare("SELECT item_id FROM attempts WHERE attempt_id = 'att_1'").get() as { item_id: string | null };
    assert.equal(attempt.item_id, null);
    const decision = db.prepare("SELECT supersedes FROM decisions WHERE decision_id = 'dec_1'").get() as { supersedes: string | null };
    assert.equal(decision.supersedes, null);
    const run = db.prepare("SELECT cancel_requested_at, cancel_requested_by FROM runs WHERE run_id = 'run_1'").get() as Record<string, unknown>;
    assert.deepEqual({ ...run }, { cancel_requested_at: null, cancel_requested_by: null });
    // The old decision row is read through the ledger: it supersedes nothing.
    const ledger = new SqliteLedger(db, (prefix) => prefix + '0'.repeat(26));
    assert.equal(must(ledger.listDecisions({ runId: 'run_1' }))[0]?.supersedes, null);
    // An attempt written before the migration has no item and is read as item A (D-12).
    assert.deepEqual(must(ledger.listRunAttempts('run_1', { itemId: 'A' })).map((a) => [a.attemptId, a.itemId]), [['att_1', null]]);
    assert.deepEqual(must(ledger.listRunAttempts('run_1', { itemId: 'B' })), []);
    db.close();
  });
});

describe('answerDecision (tracer)', () => {
  it('answers an open decision and releases the item no other open decision blocks, with one decision.answered and one work_item.transition event', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
    const transitionsBefore = h.count('events', "type = 'work_item.transition'");
    const answered = must(h.ledger.answerDecision(answerInput(opened.decisionId)));
    assert.equal(answered.state, 'answered');
    assert.equal(answered.answer, ANSWER);
    assert.equal(answered.answeredBy, 'owner');
    assert.equal(answered.answerChannel, 'terminal');
    assert.equal(answered.answeredAt, new Date(T0 + 20).toISOString());
    assert.equal(itemState(h, 'B'), 'ready');
    assert.equal(itemState(h, 'A'), 'ready');
    assert.equal(h.count('events', "type = 'decision.answered'"), 1);
    assert.equal(h.count('events', "type = 'work_item.transition'"), transitionsBefore + 1);
    const [event] = eventsOf(h, 'decision.answered');
    assert.deepEqual(event, { runId: 'run_1', decisionId: opened.decisionId, channel: 'terminal', itemsReleased: 1 });
    const transition = eventsOf(h, 'work_item.transition').at(-1);
    assert.equal(transition?.['decisionId'], opened.decisionId);
    assert.equal(transition?.['from'], 'blocked_on_decision');
    assert.equal(transition?.['to'], 'ready');
  });

  it('keeps an event free of the answer text (T-03-04): the answer lives in decisions.answer only', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    must(h.ledger.answerDecision(answerInput(opened.decisionId)));
    const rows = h.db.prepare('SELECT data_json FROM events').all() as Array<{ data_json: string }>;
    for (const row of rows) assert.ok(!row.data_json.includes('private answer text'), row.data_json);
    for (const data of eventsOf(h, 'decision.answered')) {
      for (const value of Object.values(data)) assert.notEqual(value, ANSWER);
    }
  });

  it('leaves an item blocked while another open decision still lists it', () => {
    const h = harness();
    seedBlockedRun(h, ['A', 'B', 'C'], ['B', 'C']);
    const first = must(h.ledger.openDecision(decisionInput({ affectedItems: ['B', 'C'] })));
    must(h.ledger.openDecision(decisionInput({ issue: 'second question', affectedItems: ['B'], nowMs: T0 + 11 })));
    const answered = must(h.ledger.answerDecision(answerInput(first.decisionId)));
    assert.equal(answered.state, 'answered');
    assert.equal(itemState(h, 'B'), 'blocked_on_decision', 'B is still listed by the second open decision');
    assert.equal(itemState(h, 'C'), 'ready');
    assert.equal(eventsOf(h, 'decision.answered')[0]?.['itemsReleased'], 1);
  });

  it('refuses a decision that is not open, changing nothing', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    must(h.ledger.answerDecision(answerInput(opened.decisionId)));
    const events = h.count('events');
    refused(h.ledger.answerDecision(answerInput(opened.decisionId, { answer: 'a second answer', nowMs: T0 + 30 })), 'conflict');
    assert.equal(h.count('events'), events);
    assert.equal(must(h.ledger.listDecisions({ runId: 'run_1' }))[0]?.answer, ANSWER);
  });

  it('refuses when the run contract version is not the one the caller validated against, changing nothing', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    must(h.ledger.storeRunContract('run_1', { fence: 1 }, { version: 2, digest: 'sha256:' + 'c'.repeat(64), body: { ...BODY, amended: true }, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 15 }));
    const events = h.count('events');
    refused(h.ledger.answerDecision(answerInput(opened.decisionId, { expectContractVersion: 1 })), 'conflict');
    assert.equal(h.count('events'), events);
    assert.equal(must(h.ledger.listDecisions({ runId: 'run_1' }))[0]?.state, 'open');
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
    must(h.ledger.answerDecision(answerInput(opened.decisionId, { expectContractVersion: 2 })));
  });

  it('refuses an unknown run, a decision of another run and an empty answer', () => {
    const h = harness();
    seedBlockedRun(h);
    must(h.ledger.registerProject({ projectId: 'proj_2', rootCommit: 'root2', repoPath: '/repo/2', remote: null, defaultBranch: 'main', nowMs: T0 }));
    must(h.ledger.createRun({ runId: 'run_2', projectId: 'proj_2', title: 'other', nowMs: T0 + 1 }));
    const opened = must(h.ledger.openDecision(decisionInput()));
    refused(h.ledger.answerDecision(answerInput(opened.decisionId, { runId: 'run_missing' })), 'not_found');
    refused(h.ledger.answerDecision(answerInput(opened.decisionId, { runId: 'run_2' })), 'not_found');
    refused(h.ledger.answerDecision(answerInput('dec_missing')), 'not_found');
    refused(h.ledger.answerDecision(answerInput(opened.decisionId, { answer: '' })), 'invalid');
    assert.equal(must(h.ledger.listDecisions({ runId: 'run_1' }))[0]?.state, 'open');
  });
});
describe('reopenStaleDecision', () => {
  function staleInput(decisionId: string, overrides: Record<string, unknown> = {}) {
    return {
      runId: 'run_1',
      decisionId,
      answer: ANSWER,
      answeredBy: 'owner',
      channel: 'terminal' as const,
      stateDigest: DIGEST_2,
      contractVersion: 2,
      evidenceRefs: ['ev_1', 'ev_2'] as readonly string[],
      nowMs: T0 + 40,
      ...overrides,
    };
  }

  it('marks the open decision stale with the received answer kept, and opens a successor that carries the original question', () => {
    const h = harness();
    seedBlockedRun(h);
    const original = must(h.ledger.openDecision(decisionInput()));
    const { stale, reopened } = must(h.ledger.reopenStaleDecision(staleInput(original.decisionId)));
    assert.equal(stale.decisionId, original.decisionId);
    assert.equal(stale.state, 'stale');
    assert.equal(stale.answer, ANSWER);
    assert.equal(stale.answeredBy, 'owner');
    assert.equal(stale.answerChannel, 'terminal');
    assert.equal(stale.answeredAt, new Date(T0 + 40).toISOString());
    assert.notEqual(reopened.decisionId, original.decisionId);
    assert.equal(reopened.state, 'open');
    assert.equal(reopened.supersedes, original.decisionId);
    assert.equal(reopened.stateDigest, DIGEST_2);
    assert.equal(reopened.contractVersion, 2);
    assert.deepEqual(reopened.evidenceRefs, ['ev_1', 'ev_2']);
    for (const field of ['class', 'issue', 'recommendation', 'options', 'consequences', 'affectedItems', 'authorizedDefault', 'urgency'] as const) {
      assert.deepEqual(reopened[field], original[field], field);
    }
    assert.equal(reopened.answer, null);
    assert.equal(original.supersedes, null);
    assert.equal(h.count('events', "type = 'decision.stale'"), 1);
    const opened = eventsOf(h, 'decision.opened').at(-1);
    assert.equal(opened?.['supersedes'], original.decisionId);
    assert.equal(opened?.['decisionId'], reopened.decisionId);
    for (const row of h.db.prepare('SELECT data_json FROM events').all() as Array<{ data_json: string }>) assert.ok(!row.data_json.includes('private answer text'));
    assert.equal(itemState(h, 'B'), 'blocked_on_decision', 'affected items are unchanged');
  });

  it('refuses a decision that is not open and writes nothing', () => {
    const h = harness();
    seedBlockedRun(h);
    const original = must(h.ledger.openDecision(decisionInput()));
    must(h.ledger.answerDecision(answerInput(original.decisionId)));
    const before = [h.count('events'), h.count('decisions')];
    refused(h.ledger.reopenStaleDecision(staleInput(original.decisionId)), 'conflict');
    assert.deepEqual([h.count('events'), h.count('decisions')], before);
  });
});

describe('withdrawDecision', () => {
  it('moves an open decision to withdrawn with one decision.withdrawn event, the affected items keep their state', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    const withdrawn = must(h.ledger.withdrawDecision({ runId: 'run_1', decisionId: opened.decisionId, reason: 'cancel', nowMs: T0 + 50 }));
    assert.equal(withdrawn.state, 'withdrawn');
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
    assert.deepEqual(eventsOf(h, 'decision.withdrawn'), [{ runId: 'run_1', decisionId: opened.decisionId, reason: 'cancel' }]);
  });

  it('refuses a decision that is not open and a reason outside owner and cancel, writing nothing', () => {
    const h = harness();
    seedBlockedRun(h);
    const opened = must(h.ledger.openDecision(decisionInput()));
    const before = h.count('events');
    refused(h.ledger.withdrawDecision({ runId: 'run_1', decisionId: opened.decisionId, reason: 'whim' as never, nowMs: T0 + 50 }), 'invalid');
    assert.equal(h.count('events'), before);
    must(h.ledger.withdrawDecision({ runId: 'run_1', decisionId: opened.decisionId, reason: 'owner', nowMs: T0 + 51 }));
    refused(h.ledger.withdrawDecision({ runId: 'run_1', decisionId: opened.decisionId, reason: 'owner', nowMs: T0 + 52 }), 'conflict');
    assert.equal(h.count('events', "type = 'decision.withdrawn'"), 1);
  });
});

describe('the per-item attempt key (D-12)', () => {
  it('stores the item an attempt served, keeps ordinals unique per run, and reads an attempt with no item as item A', () => {
    const h = harness();
    seedBlockedRun(h);
    const a = must(h.ledger.recordRunAttempt('run_1', { reason: 'first', nowMs: T0 + 60 }));
    const b = must(h.ledger.recordRunAttempt('run_1', { reason: 'second', itemId: 'B', nowMs: T0 + 61 }));
    const a2 = must(h.ledger.recordRunAttempt('run_1', { reason: 'third', itemId: 'A', nowMs: T0 + 62 }));
    assert.equal(a.itemId, null);
    assert.equal(b.itemId, 'B');
    assert.deepEqual([a.ordinal, b.ordinal, a2.ordinal], [1, 2, 3]);
    assert.equal((h.db.prepare('SELECT item_id FROM attempts WHERE attempt_id = ?').get(b.attemptId) as { item_id: string }).item_id, 'B');
    assert.deepEqual(must(h.ledger.listRunAttempts('run_1', { itemId: 'A' })).map((r) => r.attemptId), [a.attemptId, a2.attemptId]);
    assert.deepEqual(must(h.ledger.listRunAttempts('run_1', { itemId: 'B' })).map((r) => r.attemptId), [b.attemptId]);
    assert.equal(must(h.ledger.listRunAttempts('run_1')).length, 3);
  });
});
