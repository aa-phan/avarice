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
import type { AmendRunContractInput } from '../../src/ports/ledger.ts';
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
