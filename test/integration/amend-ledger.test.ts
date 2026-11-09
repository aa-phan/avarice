// Amending a run contract (docs/contracts-and-state.md "Run contract"; plan 03-12, RC-6, D-19, D-20).
// An amendment writes contract version n+1, the changed budget limits, the stale evidence and gate rows and the
// decision it resolves in one transaction, without a lease; every write is observed with raw SQL.
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
import type { AmendRunContractInput, DecisionInput } from '../../src/ports/ledger.ts';
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
  const dir = mkdtempSync(join(tmpdir(), 'avarice-amend-ledger-'));
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

const BODY_1 = { schema: 1, policyPreset: 'routine', files: { write: ['src/**'] } };
const BODY_2 = { schema: 1, policyPreset: 'routine', files: { write: ['src/**', 'docs/**'] } };

// A run at contract version 1 with a costUsd budget (limit 10, used 3.2, reserved 0.5) and a tokens budget (limit 1000, untouched).
function seedRun(h: Harness): void {
  must(h.ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: T0 }));
  must(h.ledger.createRun({ runId: 'run_1', projectId: 'proj_1', title: 'fix the slug helper', nowMs: T0 + 1 }));
  must(
    h.ledger.storeRunContract(
      'run_1',
      { fence: 0 },
      {
        version: 1,
        digest: 'sha256:' + 'a'.repeat(64),
        body: BODY_1,
        policyRevision: 'p1',
        authorizedBy: 'owner',
        budgets: [
          { name: 'costUsd', limit: 10, exactness: 'exact' },
          { name: 'tokens', limit: 1000, exactness: 'estimated' },
        ],
        nowMs: T0 + 2,
      },
    ),
  );
  must(h.ledger.chargeBudget('run_1', 'costUsd', 3.2, { fromReserved: false }));
  must(h.ledger.reserveBudget('run_1', 'costUsd', 0.5));
}

function amendInput(overrides: Partial<AmendRunContractInput> = {}): AmendRunContractInput {
  return {
    runId: 'run_1',
    expectVersion: 1,
    next: {
      body: BODY_2,
      digest: 'sha256:' + 'b'.repeat(64),
      policyRevision: 'p1',
      diff: [{ path: 'files.write', before: ['src/**'], after: ['src/**', 'docs/**'] }, { path: 'budgets.costUsd', before: 10, after: 12 }],
      reason: 'the docs need a slug page',
      authorizedBy: 'owner:aphan',
    },
    budgetChanges: [{ name: 'costUsd', limit: 12 }],
    nowMs: T0 + 100,
    ...overrides,
  };
}

function budgetRow(h: Harness, name: string): Record<string, unknown> {
  return { ...(h.db.prepare("SELECT * FROM budgets WHERE run_id = 'run_1' AND name = ?").get(name) as Record<string, unknown>) };
}

function eventsOf(h: Harness, type: string): Array<Record<string, unknown>> {
  return (h.db.prepare('SELECT data_json FROM events WHERE type = ? ORDER BY seq').all(type) as Array<{ data_json: string }>).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

describe('amendRunContract (tracer)', () => {
  it('writes contract version 2 and raises one budget limit, leaving used and reserved alone, with one contract.amended event', () => {
    const h = harness();
    seedRun(h);
    const before = budgetRow(h, 'costUsd');
    assert.equal(before['limit_value'], 10);
    assert.equal(before['used'], 3.2);
    assert.equal(before['reserved'], 0.5);
    const result = must(h.ledger.amendRunContract(amendInput()));
    assert.equal(result.contract.version, 2);
    assert.equal(result.contract.digest, 'sha256:' + 'b'.repeat(64));
    assert.deepEqual(result.contract.body, BODY_2);
    assert.equal(result.contract.authorizedBy, 'owner:aphan');
    assert.equal(result.contract.reason, 'the docs need a slug page');
    assert.equal(result.staleEvidence, 0);
    assert.equal(result.staleGates, 0);
    assert.equal(result.resolved, null);

    const stored = h.db.prepare("SELECT * FROM contracts WHERE run_id = 'run_1' AND version = 2").get() as Record<string, unknown>;
    assert.equal(stored['policy_revision'], 'p1');
    assert.deepEqual(JSON.parse(String(stored['diff_json'])), amendInput().next.diff);
    const version1 = h.db.prepare("SELECT digest, body_json, diff_json FROM contracts WHERE run_id = 'run_1' AND version = 1").get() as Record<string, unknown>;
    assert.equal(version1['digest'], 'sha256:' + 'a'.repeat(64));
    assert.equal(version1['diff_json'], null);

    const after = budgetRow(h, 'costUsd');
    assert.equal(after['limit_value'], 12);
    assert.equal(after['contract_version'], 2);
    assert.equal(after['used'], 3.2);
    assert.equal(after['reserved'], 0.5);
    const untouched = budgetRow(h, 'tokens');
    assert.equal(untouched['limit_value'], 1000);
    assert.equal(untouched['contract_version'], 1);

    const events = eventsOf(h, 'contract.amended');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.['runId'], 'run_1');
    assert.equal(events[0]?.['version'], 2);
    assert.equal(events[0]?.['budgets'], 1);
    assert.equal(must(h.ledger.getRunContract('run_1'))?.version, 2);
  });

  it('refuses a second amendment of the same version with conflict and writes nothing', () => {
    const h = harness();
    seedRun(h);
    must(h.ledger.amendRunContract(amendInput()));
    const eventsBefore = h.count('events');
    refused(h.ledger.amendRunContract(amendInput({ budgetChanges: [{ name: 'costUsd', limit: 99 }], nowMs: T0 + 200 })), 'conflict');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 2);
    assert.equal(h.count('contracts', 'version = 3'), 0);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 12);
    assert.equal(h.count('events'), eventsBefore);
  });

  it('takes no lease: it succeeds while another holder has a live run lease, and leaves the lease alone', () => {
    const h = harness();
    seedRun(h);
    const lease = must(h.ledger.acquireRunLease('run_1', 'supervisor', 1_000_000, T0 + 10));
    const result = must(h.ledger.amendRunContract(amendInput()));
    assert.equal(result.contract.version, 2);
    const run = must(h.ledger.getRun('run_1'));
    assert.equal(run.leaseHolder, 'supervisor');
    assert.equal(run.leaseFence, lease.fence);
  });

  it('refuses a budget change naming a row that does not exist, writing nothing', () => {
    const h = harness();
    seedRun(h);
    const eventsBefore = h.count('events');
    refused(h.ledger.amendRunContract(amendInput({ budgetChanges: [{ name: 'costUsd', limit: 12 }, { name: 'wallClock', limit: 5 }] })), 'invalid');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 10);
    assert.equal(budgetRow(h, 'costUsd')['contract_version'], 1);
    assert.equal(h.count('events'), eventsBefore);
  });

  it('refuses an unknown run with not_found and a non-finite or negative limit with invalid', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.amendRunContract(amendInput({ runId: 'run_missing' })), 'not_found');
    refused(h.ledger.amendRunContract(amendInput({ budgetChanges: [{ name: 'costUsd', limit: -1 }] })), 'invalid');
    refused(h.ledger.amendRunContract(amendInput({ budgetChanges: [{ name: 'costUsd', limit: Number.NaN }] })), 'invalid');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
  });
});

const DIGEST_STATE = 'sha256:' + '9'.repeat(64);

// Two work items, B blocked on a decision of the given class, and one open decision listing B.
function seedDecision(h: Harness, decisionClass: string): string {
  for (const itemId of ['A', 'B']) {
    must(h.ledger.upsertWorkItem({ runId: 'run_1', itemId, dependsOn: [], size: 'medium', model: 'sonnet', spec: { goal: itemId }, nowMs: T0 + 3 }));
  }
  const lease = must(h.ledger.acquireRunLease('run_1', 'holder', 1_000_000, T0 + 4));
  must(h.ledger.transitionWorkItem('run_1', 'B', { fence: lease.fence }, { to: 'blocked_on_decision', nowMs: T0 + 5 }));
  const decision: DecisionInput = {
    runId: 'run_1',
    contractVersion: 1,
    class: decisionClass,
    issue: 'The item needs a path outside its write scope',
    recommendation: 'amend',
    options: [{ key: 'withdraw', label: 'withdraw', kind: 'withdraw' }],
    consequences: { withdraw: 'the item stays blocked' },
    evidenceRefs: [],
    affectedItems: ['B'],
    stateDigest: DIGEST_STATE,
    urgency: 'blocking',
    nowMs: T0 + 10,
  };
  return must(h.ledger.openDecision(decision)).decisionId;
}

function itemState(h: Harness, itemId: string): string {
  return (h.db.prepare("SELECT state FROM work_items WHERE run_id = 'run_1' AND item_id = ?").get(itemId) as { state: string }).state;
}

// An attempt on item A with one clean, passed evidence row; returns the evidence ID.
function seedEvidence(h: Harness, name = 'unit tests'): string {
  const attempt = must(h.ledger.recordRunAttempt('run_1', { reason: 'first try', itemId: 'A', nowMs: T0 + 20 }));
  const row = must(
    h.ledger.recordEvidence({
      attemptId: attempt.attemptId,
      workItem: 'A',
      kind: 'test',
      name,
      status: 'passed',
      revision: 'git:abc1234',
      clean: true,
      treeDigest: 'sha256:' + 'c'.repeat(64),
      environment: { node: '24' },
      contractVersion: 1,
      policyRevision: 'p1',
      independence: 'deterministic',
      acceptance: ['AC-1'],
      command: ['node', '--test'],
      exitCode: 0,
      durationMs: 1200,
      nowMs: T0 + 21,
    }),
  );
  return row.evidenceId;
}

describe('amendRunContract: stale evidence and gate rows', () => {
  it('appends a stale copy of each named evidence row under the new version and leaves the original alone', () => {
    const h = harness();
    seedRun(h);
    const e1 = seedEvidence(h);
    const original = { ...(h.db.prepare('SELECT * FROM evidence WHERE evidence_id = ?').get(e1) as Record<string, unknown>) };
    const result = must(h.ledger.amendRunContract(amendInput({ staleEvidenceIds: [e1] })));
    assert.equal(result.staleEvidence, 1);
    assert.deepEqual({ ...(h.db.prepare('SELECT * FROM evidence WHERE evidence_id = ?').get(e1) as Record<string, unknown>) }, original);
    const rows = must(h.ledger.listEvidence('run_1'));
    assert.equal(rows.length, 2);
    const copy = rows[1];
    assert.ok(copy !== undefined);
    assert.notEqual(copy.evidenceId, e1);
    assert.equal(copy.status, 'stale');
    assert.equal(copy.contractVersion, 2);
    assert.deepEqual(copy.environment, { invalidatedBy: 'amendment', supersedes: e1 });
    assert.equal(copy.attemptId, rows[0]?.attemptId);
    assert.equal(copy.workItem, 'A');
    assert.equal(copy.kind, 'test');
    assert.equal(copy.name, 'unit tests');
    assert.equal(copy.revision, 'git:abc1234');
    assert.equal(copy.clean, true);
    assert.equal(copy.treeDigest, 'sha256:' + 'c'.repeat(64));
    assert.equal(rows[0]?.status, 'passed');
    assert.equal(rows[0]?.contractVersion, 1);
    const [event] = eventsOf(h, 'contract.amended');
    assert.equal(event?.['staleEvidence'], 1);
    assert.equal(event?.['staleGates'], 0);
  });

  it('refuses evidence of no known row, writing nothing at all', () => {
    const h = harness();
    seedRun(h);
    seedEvidence(h);
    const eventsBefore = h.count('events');
    refused(h.ledger.amendRunContract(amendInput({ staleEvidenceIds: ['ev_missing'] })), 'invalid');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(h.count('evidence'), 1);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 10);
    assert.equal(h.count('events'), eventsBefore);
  });

  it('appends a failed stale-after-amendment row for each named gate with the revision of its latest row', () => {
    const h = harness();
    seedRun(h);
    for (const [revision, passed] of [['git:rev1', true], ['git:rev2', true]] as const) {
      must(h.ledger.recordGateResult({ runId: 'run_1', gate: 'G2', workItem: 'A', contractVersion: 1, policyRevision: 'p1', revision, passed, failures: [], nowMs: T0 + 30 }));
    }
    must(h.ledger.recordGateResult({ runId: 'run_1', gate: 'G3', contractVersion: 1, policyRevision: 'p1', revision: 'git:other', passed: true, failures: [], nowMs: T0 + 31 }));
    const result = must(h.ledger.amendRunContract(amendInput({ staleGates: [{ gate: 'G2', detail: 'files.write changed' }] })));
    assert.equal(result.staleGates, 1);
    const gates = must(h.ledger.listGateResults('run_1'));
    assert.equal(gates.length, 4);
    const row = gates[3];
    assert.ok(row !== undefined);
    assert.equal(row.gate, 'G2');
    assert.equal(row.passed, false);
    assert.deepEqual(row.failures, [{ rule: 'stale-after-amendment', detail: 'files.write changed' }]);
    assert.equal(row.contractVersion, 2);
    assert.equal(row.revision, 'git:rev2');
    assert.equal(row.workItem, 'A');
    assert.equal(gates[0]?.passed, true);
    assert.equal(gates[2]?.contractVersion, 1);
    assert.equal(eventsOf(h, 'contract.amended')[0]?.['staleGates'], 1);
  });

  it('refuses a stale gate that never ran, writing nothing', () => {
    const h = harness();
    seedRun(h);
    refused(h.ledger.amendRunContract(amendInput({ staleGates: [{ gate: 'G2', detail: 'x' }] })), 'invalid');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(h.count('gate_results'), 0);
  });

  it('keeps the insert-only triggers in force', () => {
    const h = harness();
    seedRun(h);
    const e1 = seedEvidence(h);
    must(h.ledger.amendRunContract(amendInput({ staleEvidenceIds: [e1] })));
    assert.throws(() => h.db.exec("UPDATE evidence SET status = 'passed' WHERE status = 'stale'"), /insert-only/);
    assert.throws(() => h.db.exec('DELETE FROM evidence'), /insert-only/);
  });
});

describe('amendRunContract: the decision it resolves', () => {
  it('answers an open scope_expansion decision with amended:v2 and moves its blocked item to ready, in the same transaction', () => {
    const h = harness();
    seedRun(h);
    const decisionId = seedDecision(h, 'scope_expansion');
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
    const result = must(h.ledger.amendRunContract(amendInput({ resolvesDecisionId: decisionId })));
    assert.equal(result.resolved?.decisionId, decisionId);
    assert.equal(result.resolved?.state, 'answered');
    assert.equal(result.resolved?.answer, 'amended:v2');
    assert.equal(result.resolved?.answeredBy, 'owner:aphan');
    assert.equal(result.resolved?.answerChannel, 'terminal');
    assert.equal(itemState(h, 'B'), 'ready');
    assert.equal(eventsOf(h, 'decision.answered').length, 1);
    assert.equal(eventsOf(h, 'decision.answered')[0]?.['itemsReleased'], 1);
    const [event] = eventsOf(h, 'contract.amended');
    assert.equal(event?.['resolvedDecisionId'], decisionId);
  });

  it('releases an item only when no other open decision still lists it', () => {
    const h = harness();
    seedRun(h);
    const first = seedDecision(h, 'permission');
    must(
      h.ledger.openDecision({
        runId: 'run_1',
        contractVersion: 1,
        class: 'budget',
        issue: 'the cost limit is reached',
        options: [{ key: 'withdraw', label: 'withdraw', kind: 'withdraw' }],
        consequences: {},
        evidenceRefs: [],
        affectedItems: ['B'],
        stateDigest: DIGEST_STATE,
        urgency: 'blocking',
        nowMs: T0 + 11,
      }),
    );
    must(h.ledger.amendRunContract(amendInput({ resolvesDecisionId: first })));
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
  });

  it('refuses a pause-class decision and writes nothing: no version 2, no stale rows, no limit change', () => {
    const h = harness();
    seedRun(h);
    const e1 = seedEvidence(h);
    const decisionId = seedDecision(h, 'acceptance');
    const eventsBefore = h.count('events');
    refused(h.ledger.amendRunContract(amendInput({ resolvesDecisionId: decisionId, staleEvidenceIds: [e1] })), 'invalid');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(h.count('evidence'), 1);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 10);
    assert.equal(itemState(h, 'B'), 'blocked_on_decision');
    assert.equal(h.count('events'), eventsBefore);
    assert.equal(must(h.ledger.listDecisions({ runId: 'run_1' }))[0]?.state, 'open');
  });

  it('refuses an answered decision and an unknown one, each writing nothing', () => {
    const h = harness();
    seedRun(h);
    const decisionId = seedDecision(h, 'repeated_failure');
    must(h.ledger.answerDecision({ runId: 'run_1', decisionId, answer: 'withdraw', answeredBy: 'owner', channel: 'terminal', expectContractVersion: 1, nowMs: T0 + 40 }));
    refused(h.ledger.amendRunContract(amendInput({ resolvesDecisionId: decisionId })), 'conflict');
    refused(h.ledger.amendRunContract(amendInput({ resolvesDecisionId: 'dec_missing' })), 'not_found');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 10);
  });
});

describe('amendRunContract: the run states', () => {
  it('refuses a cancelled run with conflict, writing nothing', () => {
    const h = harness();
    seedRun(h);
    const lease = must(h.ledger.acquireRunLease('run_1', 'holder', 1_000_000, T0 + 4));
    const run = must(h.ledger.getRun('run_1'));
    must(h.ledger.transitionRun('run_1', { version: run.version, fence: lease.fence }, { to: 'cancelled', nextAction: 'none', nowMs: T0 + 50 }));
    const eventsBefore = h.count('events');
    refused(h.ledger.amendRunContract(amendInput()), 'conflict');
    assert.equal(h.count('contracts', "run_id = 'run_1'"), 1);
    assert.equal(budgetRow(h, 'costUsd')['limit_value'], 10);
    assert.equal(h.count('events'), eventsBefore);
  });

  it('works for a run in running', () => {
    const h = harness();
    seedRun(h);
    const lease = must(h.ledger.acquireRunLease('run_1', 'holder', 1_000_000, T0 + 4));
    must(h.ledger.transitionRun('run_1', { version: 1, fence: lease.fence }, { to: 'running', nextAction: 'x', nowMs: T0 + 50 }));
    assert.equal(must(h.ledger.amendRunContract(amendInput())).contract.version, 2);
  });
});
