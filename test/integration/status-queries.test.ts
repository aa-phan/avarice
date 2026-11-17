// status reads every per-run table in one batch (plan 04-13; OPS-5, AC-2, T-04-33, T-04-34). getRunStatuses used to issue nine reads per
// run, so `status` cost grew with the run count; it now calls the ledger's loadRunStatusInputs once per chunk of runs. These cases hold
// that down: the number of SQL statements does not depend on how many runs there are, the batch returns exactly what the per-run reads
// return (rows and order), and a store with active, blocked, interrupted and ready runs reads the same through both.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { MIGRATION_0004 } from '../../src/adapters/sqlite/migrations/0004-profiles.ts';
import { getRunStatuses } from '../../src/app/run-status.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunStatusInputs } from '../../src/ports/ledger.ts';

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
const NOW = T0 + 1_000;
const DIGEST = 'sha256:' + 'a'.repeat(64);

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

interface Harness {
  ledger: SqliteLedger;
  db: DatabaseSync;
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-status-queries-'));
  cleanup.push(dir);
  const db = must(openDb(join(dir, 'state.db')));
  must(migrate(db, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003, MIGRATION_0004], { nowMs: T0 }));
  let n = 0;
  const ledger = new SqliteLedger(db, (prefix) => prefix + String(++n).padStart(26, '0'));
  must(ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: T0 }));
  return { ledger, db };
}

type Shape = 'ready' | 'active' | 'blocked' | 'interrupted';
const SHAPES: readonly Shape[] = ['ready', 'active', 'blocked', 'interrupted'];

// One run with a contract, budgets, two work items, an attempt with evidence, a gate result, steps, a decision and a notification, moved
// into the named shape. The shapes cover every branch of the status read model.
function seedRun(h: Harness, index: number, shape: Shape): string {
  const runId = `run_${String(index).padStart(5, '0')}`;
  const at = T0 + index;
  must(
    h.ledger.createRunWithContract({
      run: { runId, projectId: 'proj_1', title: `task ${index}`, nowMs: at, baseRevision: 'git:abc1234', branch: `avarice/${runId}` },
      contract: {
        version: 1,
        digest: DIGEST,
        body: { schema: 1, intent: { requirementRefs: [{ kind: 'brief', id: 'brief.md', revision: 'abc123' }] }, workspace: { conventionsRevision: 'def456' } },
        policyRevision: 'p1',
        authorizedBy: 'owner',
        budgets: [
          { name: 'toolCalls', limit: 400, exactness: 'exact' },
          { name: 'invocations', limit: 3, exactness: 'exact' },
        ],
        nowMs: at,
      },
      workItems: ['A', 'B'].map((itemId) => ({ runId, itemId, dependsOn: itemId === 'B' ? ['A'] : [], size: 'medium', model: 'sonnet', spec: { goal: itemId }, nowMs: at })),
    }),
  );
  let row = must(h.ledger.transitionRun(runId, { version: 1, fence: 0 }, { to: 'running', nextAction: 'launch:run', nowMs: at + 1 }));
  const attempt = must(h.ledger.recordRunAttempt(runId, { reason: 'first try', itemId: 'A', nowMs: at + 2 }));
  must(
    h.ledger.recordEvidence({
      attemptId: attempt.attemptId,
      workItem: 'A',
      kind: 'check',
      name: 'test',
      status: 'passed',
      revision: 'git:abc1234',
      clean: true,
      treeDigest: DIGEST,
      environment: { phase: 'final' },
      contractVersion: 1,
      policyRevision: 'p1',
      independence: 'deterministic',
      acceptance: ['AC-1'],
      nowMs: at + 3,
    }),
  );
  must(h.ledger.recordGateResult({ runId, gate: 'G2', workItem: 'A', contractVersion: 1, policyRevision: 'p1', revision: 'git:abc1234', passed: true, failures: [], nowMs: at + 4 }));
  must(h.ledger.recordRunStep(runId, { step: 'launch:run', status: 'started', result: {}, nowMs: at + 5 }));
  must(h.ledger.recordRunStep(runId, { step: 'handoff:fetch', status: 'completed', result: { commit: 'abc1234' }, nowMs: at + 6, completedAtMs: at + 7 }));
  if (shape === 'ready') {
    must(h.ledger.endRunAttempt(attempt.attemptId, { outcome: 'passed', nowMs: at + 8 }));
    row = must(h.ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'verifying', nextAction: 'verify:checks', nowMs: at + 9 }));
    must(h.ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'ready_for_review', nextAction: 'none', nowMs: at + 10 }));
  } else if (shape === 'active') {
    must(h.ledger.acquireRunLease(runId, 'holder', 1_000_000_000, at + 8));
  } else if (shape === 'blocked') {
    const decision = must(
      h.ledger.openDecision({
        runId,
        contractVersion: 1,
        class: 'acceptance',
        issue: 'The brief does not say whether slugs keep digits',
        options: [{ id: 'keep', label: 'keep digits' }, { id: 'drop', label: 'drop digits' }],
        consequences: { keep: 'matches the tests', drop: 'breaks 3 tests' },
        evidenceRefs: [],
        affectedItems: ['B'],
        stateDigest: DIGEST,
        urgency: 'blocking',
        nowMs: at + 8,
      }),
    );
    must(h.ledger.createNotification({ runId, kind: 'decisions', destination: 'banner', subjectIds: [decision.decisionId], state: 'pending', nowMs: at + 9 }));
    must(h.ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'blocked_on_decision', nextAction: 'none', reason: 'budget_exhausted', nowMs: at + 10 }));
  }
  // `interrupted` stays running with the attempt open and no lease holder.
  return runId;
}

function seed(h: Harness, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(seedRun(h, i, SHAPES[i % SHAPES.length] as Shape));
  return ids;
}

// The statements a call prepares: every read goes through `db.prepare`, so this counts the SQL the call issues.
function countStatements<T>(h: Harness, work: () => T): { value: T; statements: number } {
  const original = h.db.prepare.bind(h.db);
  let statements = 0;
  (h.db as { prepare: unknown }).prepare = (sql: string) => {
    statements += 1;
    return original(sql);
  };
  try {
    const value = work();
    return { value, statements };
  } finally {
    (h.db as { prepare: unknown }).prepare = original;
  }
}

// The ten per-run reads status makes (nine before the batch, plus the task references of plan 04-20), with the attempts it read for an interrupted run: the oracle for the batch.
function perRunInputs(h: Harness, runId: string): RunStatusInputs {
  return {
    checkpoints: must(h.ledger.listRunCheckpoints(runId)),
    evidence: must(h.ledger.listEvidence(runId)),
    gateResults: must(h.ledger.listGateResults(runId)),
    decisions: must(h.ledger.listDecisions({ runId })),
    workItems: must(h.ledger.listWorkItems(runId)),
    notifications: must(h.ledger.listNotifications({ runId })),
    budgets: must(h.ledger.getBudgets(runId)),
    contract: must(h.ledger.getRunContract(runId)),
    steps: must(h.ledger.getRunSteps(runId)),
    attempts: must(h.ledger.listRunAttempts(runId)),
    taskRefs: must(h.ledger.listTaskRefs(runId)),
  };
}

describe('status issues a number of statements that does not grow with the runs (tracer; AC-2, T-04-33)', () => {
  it('prepares the same number of statements for 10 runs and for 200 runs', () => {
    const small = harness();
    seed(small, 10);
    const large = harness();
    seed(large, 200);
    const few = countStatements(small, () => must(getRunStatuses(small.ledger, 'proj_1', NOW)));
    const many = countStatements(large, () => must(getRunStatuses(large.ledger, 'proj_1', NOW)));
    assert.equal(few.value.length, 10);
    assert.equal(many.value.length, 200);
    assert.equal(many.statements, few.statements, `10 runs prepared ${few.statements} statements, 200 runs prepared ${many.statements}`);
  });

  it('prepares a small fixed number of statements, not nine per run', () => {
    const h = harness();
    seed(h, 50);
    const counted = countStatements(h, () => must(getRunStatuses(h.ledger, 'proj_1', NOW)));
    assert.ok(counted.statements <= 20, `50 runs prepared ${counted.statements} statements`);
  });
});

describe('loadRunStatusInputs returns what the per-run reads return', () => {
  const h = harness();
  const ids = seed(h, 24);

  it('every table of every run is equal to the per-run read, in the same order', () => {
    const batch = must(h.ledger.loadRunStatusInputs(ids));
    assert.equal(batch.size, ids.length);
    for (const id of ids) assert.deepEqual(batch.get(id), perRunInputs(h, id), `inputs of ${id}`);
  });

  it('keeps each run to its own rows when the batch holds several runs', () => {
    const batch = must(h.ledger.loadRunStatusInputs(ids));
    for (const id of ids) {
      const inputs = batch.get(id) as RunStatusInputs;
      assert.ok(inputs.checkpoints.every((c) => c.runId === id));
      assert.ok(inputs.evidence.every((e) => e.attemptId !== '' && e.runId === id));
      assert.ok(inputs.workItems.every((w) => w.runId === id));
      assert.equal(inputs.contract?.runId, id);
    }
  });

  it('an empty list of IDs is an empty map and prepares nothing', () => {
    const counted = countStatements(h, () => must(h.ledger.loadRunStatusInputs([])));
    assert.equal(counted.value.size, 0);
    assert.equal(counted.statements, 0);
  });

  it('reads more runs than one chunk holds, and the chunks together equal the per-run reads', () => {
    const big = harness();
    const bigIds = seed(big, 12);
    // Repeat IDs past the 500-ID chunk size: the map holds one entry per distinct run.
    const repeated = Array.from({ length: 1_100 }, (_, i) => bigIds[i % bigIds.length] as string);
    const batch = must(big.ledger.loadRunStatusInputs(repeated));
    assert.equal(batch.size, bigIds.length);
    for (const id of bigIds) assert.deepEqual(batch.get(id), perRunInputs(big, id));
  });

  it('an ID that is not a run is not_found, as the per-run reads say', () => {
    const result = h.ledger.loadRunStatusInputs([ids[0] as string, 'run_missing']);
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'not_found');
  });

  it('an ID with a quote or a SQL fragment is data: it is bound, not interpolated (T-04-34)', () => {
    const result = h.ledger.loadRunStatusInputs(["run_1' OR '1'='1", 'run_1); DROP TABLE runs; --']);
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'not_found');
    assert.equal((h.db.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n, ids.length);
  });
});

describe('getRunStatuses over a store with active, blocked, interrupted and ready runs', () => {
  it('builds the entries the per-run reads build', () => {
    const h = harness();
    const ids = seed(h, 16);
    const statuses = must(getRunStatuses(h.ledger, 'proj_1', NOW));
    assert.equal(statuses.length, ids.length);
    const states = new Set(statuses.map((s) => (s.interrupted !== undefined ? 'interrupted' : s.state)));
    assert.deepEqual([...states].sort(), ['blocked_on_decision', 'interrupted', 'ready_for_review', 'running']);

    // The same read model fed by the per-run reads: a ledger whose batch is built the way status built it before.
    const reference = Object.create(h.ledger) as SqliteLedger;
    reference.loadRunStatusInputs = (runIds: readonly string[]) => {
      const map = new Map<string, RunStatusInputs>();
      for (const id of runIds) map.set(id, perRunInputs(h, id));
      return { ok: true, value: map };
    };
    assert.deepEqual(must(getRunStatuses(reference, 'proj_1', NOW)), statuses);
  });

  it('shows the facts of each shape', () => {
    const h = harness();
    seed(h, 4);
    const byId = new Map(must(getRunStatuses(h.ledger, 'proj_1', NOW)).map((s) => [s.runId, s]));
    const ready = byId.get('run_00000');
    const active = byId.get('run_00001');
    const blocked = byId.get('run_00002');
    const interrupted = byId.get('run_00003');
    assert.equal(ready?.state, 'ready_for_review');
    assert.equal(ready?.commit, 'abc1234');
    assert.deepEqual(ready?.gates, [{ gate: 'G2', passed: true, revision: 'git:abc1234' }]);
    assert.equal(active?.state, 'running');
    assert.equal(active?.interrupted, undefined);
    assert.equal(blocked?.openDecisions, 1);
    assert.equal(blocked?.notifications?.pending, 1);
    assert.equal(interrupted?.interrupted?.reason, 'supervisor interrupted');
    assert.notEqual(interrupted?.interrupted?.attemptId, null);
    assert.deepEqual(
      ready?.budgets.map((b) => b.name),
      ['invocations', 'toolCalls'],
    );
  });
});
