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
import { newId } from '../../src/domain/ids.ts';
import type { IdPrefix } from '../../src/domain/ids.ts';
import type { Result } from '../../src/domain/result.ts';

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
