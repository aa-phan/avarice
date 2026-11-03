// Discriminating tests added by the 01-20 mutation campaign for the ledger's lease and activation rules (docs/contracts-and-state.md
// "Concurrency control", "Persisted entities"; docs/repository-onboarding.md state diagram).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { digestOf } from '../../src/domain/digest.ts';
import { newId } from '../../src/domain/ids.ts';
import type { IdPrefix } from '../../src/domain/ids.ts';
import type { Result } from '../../src/domain/result.ts';
import { settleInvocation } from '../../src/app/budget.ts';
import type { AppDeps } from '../../src/app/deps.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

const T0 = Date.UTC(2026, 0, 1);

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-mut-ledger-'));
  cleanup.push(dir);
  const db = must(openDb(join(dir, 'state.db')));
  must(migrate(db, [MIGRATION_0001], { nowMs: T0 }));
  let counter = 0;
  const ledger = new SqliteLedger(db, (prefix: IdPrefix) => newId(prefix, T0, Uint8Array.from({ length: 10 }, (_, i) => (counter++ * 7 + i) & 0xff)));
  const project = must(ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root', repoPath: '/repo', remote: null, defaultBranch: 'main', nowMs: T0 }));
  const onboarding = must(ledger.createOnboarding({ onboardingId: 'onb_1', projectId: project.projectId, preflight: { pin: 'git:abc' }, nowMs: T0 + 1 }));
  return { ledger, onboarding, db };
}

describe('FC-12: a lease needs the holder and the fence it was granted at', () => {
  it('does not release a lease for a holder presenting an older fence', () => {
    const { ledger, db } = harness();
    const first = must(ledger.acquireLease('onb_1', 'holder-a', 1_000, T0 + 10));
    // The lease expires and the same holder takes it again: the fence moves on.
    const second = must(ledger.acquireLease('onb_1', 'holder-a', 1_000, T0 + 5_000));
    assert.ok(second.fence > first.fence);
    const stale = ledger.releaseLease('onb_1', 'holder-a', first.fence);
    assert.ok(!stale.ok);
    assert.equal(stale.error.kind, 'conflict');
    assert.equal(must(ledger.getOnboarding('onb_1')).leaseHolder, 'holder-a', 'the stale release changed nothing');
    must(ledger.releaseLease('onb_1', 'holder-a', second.fence));
    assert.equal(must(ledger.getOnboarding('onb_1')).leaseHolder, null);
    db.close();
  });
});

describe('FC-12: activation checks the lifecycle edge before it reads the record', () => {
  it('reports the illegal transition, not a problem with the record body, when both apply', () => {
    const { ledger, onboarding, db } = harness();
    assert.equal(onboarding.state, 'discovered');
    const grant = must(ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    const refused = ledger.insertRecordAndActivate('onb_1', { version: must(ledger.getOnboarding('onb_1')).version, fence: grant.fence }, { body: {}, nowMs: T0 + 20 });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'invalid');
    assert.equal(refused.error.kind === 'invalid' ? refused.error.field : '', 'state');
    assert.equal(db.prepare('SELECT count(*) AS n FROM project_records').get()?.['n'], 0);
    db.close();
  });
});

describe('FC-12: a contract is stored once, by the holder of the current fence', () => {
  const contract = (runId: string) => ({ runId, digest: 'sha256:' + 'a'.repeat(64), body: { schema: 1 }, policyRevision: 'p1', authorizedBy: 'test', nowMs: T0 + 30 });

  it('refuses a stale fence and a second contract, and stores nothing in either case', () => {
    const { ledger, db } = harness();
    const grant = must(ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    const stale = ledger.storeContract('onb_1', { fence: grant.fence + 1 }, contract('run_1'));
    assert.ok(!stale.ok);
    assert.equal(stale.error.kind, 'conflict');
    assert.equal(db.prepare('SELECT count(*) AS n FROM contracts').get()?.['n'], 0);

    must(ledger.storeContract('onb_1', { fence: grant.fence }, contract('run_1')));
    const again = ledger.storeContract('onb_1', { fence: grant.fence }, contract('run_2'));
    assert.ok(!again.ok);
    assert.equal(again.error.kind, 'conflict');
    assert.equal(db.prepare('SELECT count(*) AS n FROM contracts').get()?.['n'], 1);
    assert.equal(must(ledger.getOnboarding('onb_1')).contractRunId, 'run_1');
    db.close();
  });
});

describe('FC-4: a reservation can only be settled once it exists', () => {
  it('refuses to charge from a reservation that is not there and leaves the row unchanged', () => {
    const { ledger, db } = harness();
    const grant = must(ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    must(ledger.storeContract('onb_1', { fence: grant.fence }, { runId: 'run_1', digest: 'sha256:' + 'a'.repeat(64), body: { schema: 1 }, policyRevision: 'p1', authorizedBy: 'test', nowMs: T0 + 30, budgets: [{ name: 'invocations', limit: 3, exactness: 'exact' }] }));
    const refused = ledger.chargeBudget('run_1', 'invocations', 1, { fromReserved: true });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'conflict');
    const [row] = must(ledger.getBudgets('run_1'));
    assert.deepEqual([row?.used, row?.reserved], [0, 0]);
    db.close();
  });
});

describe('FC-12: activation stores the record it was given, for its own project', () => {
  // discovered -> contract_proposed -> mapping -> validating -> planning_ready, each transition on the version and fence it last saw.
  function readyToActivate() {
    const h = harness();
    const grant = must(h.ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    let row = h.onboarding;
    for (const to of ['contract_proposed', 'mapping', 'validating', 'planning_ready'] as const) {
      row = must(h.ledger.transitionOnboarding('onb_1', { version: row.version, fence: grant.fence }, { to, nextAction: 'none', nowMs: T0 + 100 }));
    }
    assert.equal(row.state, 'planning_ready');
    return { ...h, guard: { version: row.version, fence: grant.fence } };
  }
  const body = (extra: Record<string, unknown> = {}) => ({ schema: 1, projectId: 'proj_1', revisions: { onboardedAt: 'git:abc' }, gsd: { version: '1.17.0' }, mapping: { mode: 'full', completeness: 'complete', scope: ['.'] }, ...extra });

  it('refuses a record that names another project and stores nothing', () => {
    const { ledger, db, guard } = readyToActivate();
    const refused = ledger.insertRecordAndActivate('onb_1', guard, { body: body({ projectId: 'proj_other' }), nowMs: T0 + 200 });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'invalid');
    assert.equal(refused.error.kind === 'invalid' ? refused.error.field : '', 'projectId');
    assert.equal(db.prepare('SELECT count(*) AS n FROM project_records').get()?.['n'], 0);
    assert.equal(must(ledger.getOnboarding('onb_1')).state, 'planning_ready');
    db.close();
  });

  it('stores the digest of the body it was given and activates version 1', () => {
    const { ledger, db, guard } = readyToActivate();
    const given = body();
    const activated = must(ledger.insertRecordAndActivate('onb_1', guard, { body: given, nowMs: T0 + 200 }));
    assert.equal(activated.recordVersion, 1);
    assert.equal(activated.digest, digestOf(given));
    const record = must(ledger.getActiveRecord('proj_1'));
    assert.ok(record);
    assert.equal(record.digest, digestOf(given));
    assert.deepEqual(record.body, given);
    assert.equal(must(ledger.getOnboarding('onb_1')).state, 'active');
    db.close();
  });
});

describe('FC-4: what a budget accepts', () => {
  it('refuses a negative amount and a negative limit, and a settlement with a measurement that is not a number', () => {
    const { ledger, db } = harness();
    const grant = must(ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    const stored = ledger.storeContract('onb_1', { fence: grant.fence }, { runId: 'run_1', digest: 'sha256:' + 'a'.repeat(64), body: { schema: 1 }, policyRevision: 'p1', authorizedBy: 'test', nowMs: T0 + 30, budgets: [{ name: 'toolCalls', limit: 5, exactness: 'exact' }] });
    assert.ok(stored.ok);
    for (const amount of [-1, Number.NaN]) {
      const reserve = ledger.reserveBudget('run_1', 'toolCalls', amount);
      assert.ok(!reserve.ok, String(amount));
      assert.equal(reserve.error.kind, 'invalid');
      assert.ok(!ledger.chargeBudget('run_1', 'toolCalls', amount, { fromReserved: false }).ok, String(amount));
    }
    const badLimit = ledger.createBudgets('run_1', 1, [{ name: 'costUsd', limit: -1, exactness: 'estimated' }]);
    assert.ok(!badLimit.ok);
    assert.equal(badLimit.error.kind, 'invalid');
    const [row] = must(ledger.getBudgets('run_1'));
    assert.deepEqual([row?.used, row?.reserved], [0, 0]);
    // settleInvocation refuses before it touches the ledger when a measurement is not finite.
    const refused = settleInvocation({} as AppDeps, { runId: 'run_1', purpose: 'map', wallClockMs: 1, costCapUsd: 1 }, { durationMs: Number.NaN, costUsd: 0 });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'invalid');
    db.close();
  });
});

describe('FC-12: a record states the revision it was onboarded at', () => {
  it('refuses a record with no revisions.onboardedAt before it stores anything', () => {
    const h = harness();
    const grant = must(h.ledger.acquireLease('onb_1', 'holder-a', 60_000, T0 + 10));
    let row = h.onboarding;
    for (const to of ['contract_proposed', 'mapping', 'validating', 'planning_ready'] as const) {
      row = must(h.ledger.transitionOnboarding('onb_1', { version: row.version, fence: grant.fence }, { to, nextAction: 'none', nowMs: T0 + 100 }));
    }
    const refused = h.ledger.insertRecordAndActivate('onb_1', { version: row.version, fence: grant.fence }, { body: { schema: 1, projectId: 'proj_1', gsd: { version: '1.17.0' } }, nowMs: T0 + 200 });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'invalid');
    assert.equal(refused.error.kind === 'invalid' ? refused.error.field : '', 'revisions.onboardedAt');
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM project_records').get()?.['n'], 0);
    h.db.close();
  });
});
