import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../../src/adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../../src/adapters/sqlite/migrations/0003-decisions.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { buildProjectRecord } from '../../src/domain/project-record.ts';
import type { OnboardingState } from '../../src/domain/onboarding-lifecycle.ts';
import type { OnboardingRow } from '../../src/ports/ledger.ts';
import { makeRoots, PRODUCTION_ENTRY, REPO_ROOT, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function freshRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

function rawDb(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
}

describe('status on a fresh profile (tracer)', () => {
  it('exits 0 with an empty project list and migrates the store to the shipped schema version (3 since plan 03-02)', () => {
    const roots = freshRoots();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /No projects registered/);
    assert.equal(r.stderr, '');
    const db = rawDb(roots);
    try {
      assert.deepEqual({ ...(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as object) }, { value: '3' });
      assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n, 3);
      assert.deepEqual({ ...(db.prepare('PRAGMA journal_mode').get() as object) }, { journal_mode: 'wal' });
    } finally {
      db.close();
    }
  });

  it('prints [] with --json', () => {
    const r = runCli(['status', '--json'], { roots: freshRoots() });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });

  it('creates the data and work roots with mode 0700', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    for (const dir of [roots.AVARICE_DATA_ROOT, roots.AVARICE_WORK_ROOT, roots.AVARICE_CONFIG_HOME]) {
      assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
    }
  });

  it('is repeatable: a second run applies no migration', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    assert.equal(runCli(['status', '--json'], { roots }).stdout.trim(), '[]');
    const db = rawDb(roots);
    try {
      assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n, 3);
    } finally {
      db.close();
    }
  });

  it('runs through the shebang entry as an executable', () => {
    const roots = freshRoots();
    const r = spawnSync(PRODUCTION_ENTRY, ['status', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ...roots, NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });

  const sandbox = '/usr/bin/sandbox-exec';
  it('works with the network denied', { skip: !existsSync(sandbox) }, () => {
    const roots = freshRoots();
    const r = runCli(['status', '--json'], { roots, wrap: [sandbox, '-p', '(version 1)(allow default)(deny network*)'] });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '[]');
  });
});

describe('CLI dispatch', () => {
  it('exits 64 for an unknown command and does not touch the profile', () => {
    const roots = freshRoots();
    const r = runCli(['bogus'], { roots });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /unknown command 'bogus'/);
    assert.match(r.stderr, /^avarice: unknown command 'bogus'\nusage: avarice <command> \[options\]\n/, 'before a command is chosen the prefix is `avarice: `, then the usage text');
    assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false);
  });

  it('exits 64 with `avarice: no command given` and the usage text when no command is named', () => {
    const r = runCli([], { roots: freshRoots() });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /^avarice: no command given\nusage: avarice <command> \[options\]\n/);
  });

  it('prefixes a usage error with the command and follows it with the usage text', () => {
    const r = runCli(['context'], { roots: freshRoots() });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /^avarice context: a term is required\n/);
    assert.match(r.stderr, /usage: avarice <command> \[options\]/);
  });

  it('exits 64 for an allowlisted command whose module is not built', () => {
    // Every command is built now (plan 01-17 added `context`), so the dispatch is run from a copy of the tree that lacks one.
    const copy = mkdtempSync(join(tmpdir(), 'avarice-dispatch-'));
    cleanup.push(copy);
    cpSync(join(REPO_ROOT, 'src'), join(copy, 'src'), { recursive: true });
    cpSync(join(REPO_ROOT, 'bin'), join(copy, 'bin'), { recursive: true });
    cpSync(join(REPO_ROOT, 'package.json'), join(copy, 'package.json'));
    rmSync(join(copy, 'src', 'cli', 'commands', 'context.ts'));
    const r = runCli(['context'], { roots: freshRoots(), entry: join(copy, 'bin', 'avarice.ts') });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /not available in this build/);
  });

  it('never imports a name outside the allowlist (path traversal)', () => {
    const r = runCli(['../main'], { roots: freshRoots() });
    assert.equal(r.code, 64);
    assert.match(r.stderr, /unknown command/);
  });
});

describe('store failures exit 70 with the reason on stderr', () => {
  it('a file that is not a database', () => {
    const roots = freshRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    writeFileSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), 'this is not a sqlite database, '.repeat(40));
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /cannot open .*state\.db/);
  });

  it('a recorded migration checksum that differs from the shipped one', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
    db.exec("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
    db.close();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /checksum/);
  });

  it('a store written by a newer build', () => {
    const roots = freshRoots();
    assert.equal(runCli(['status'], { roots }).code, 0);
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
    db.exec("INSERT INTO schema_migrations VALUES (4, '2030-01-01T00:00:00.000Z', 'x')");
    db.close();
    const r = runCli(['status'], { roots });
    assert.equal(r.code, 70);
    assert.match(r.stderr, /newer build/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Ledger behaviours. Rows are seeded through the ledger API only; raw SQL is used to observe and to
// try to tamper.
// ---------------------------------------------------------------------------------------------------

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);

interface Harness {
  roots: CliRoots;
  dbPath: string;
  db: DatabaseSync;
  ledger: SqliteLedger;
  close(): void;
}

function harness(roots: CliRoots = freshRoots()): Harness {
  mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
  const dbPath = join(roots.AVARICE_DATA_ROOT, 'state.db');
  const opened = openDb(dbPath);
  assert.ok(opened.ok, 'openDb');
  const migrated = migrate(opened.value, [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003], { nowMs: T0 });
  assert.ok(migrated.ok, 'migrate');
  let n = 0;
  const ledger = new SqliteLedger(opened.value, (prefix) => prefix + String(++n).padStart(26, '0'));
  return { roots, dbPath, db: opened.value, ledger, close: () => opened.value.close() };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.error));
  return r.value;
}

function count(db: DatabaseSync, table: string, where = '1=1'): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
}

function snapshotRows(db: DatabaseSync): string {
  return JSON.stringify([
    db.prepare('SELECT * FROM onboardings ORDER BY onboarding_id').all(),
    db.prepare('SELECT * FROM checkpoints ORDER BY checkpoint_id').all(),
    db.prepare('SELECT * FROM events ORDER BY seq').all(),
  ]);
}

function registerAndCreate(h: Harness, suffix = '1'): OnboardingRow {
  const project = must(h.ledger.registerProject({ projectId: `proj_${suffix}`, rootCommit: `root${suffix}`, repoPath: `/repo/${suffix}`, remote: null, defaultBranch: 'main', nowMs: T0 }));
  return must(h.ledger.createOnboarding({ onboardingId: `onb_${suffix}`, projectId: project.projectId, preflight: { pin: 'git:abc', request: { mode: 'full' } }, nowMs: T0 + 1 }));
}

// Acquires the lease and walks the onboarding through `states`, returning the last row.
function advance(h: Harness, row: OnboardingRow, ...states: OnboardingState[]): OnboardingRow {
  let current = row;
  let fence = current.leaseFence;
  if (current.leaseHolder === null) fence = must(h.ledger.acquireLease(current.onboardingId, 'host:1:a', 180_000, T0 + 2)).fence;
  let t = T0 + 10;
  for (const to of states) {
    current = must(
      h.ledger.transitionOnboarding(current.onboardingId, { version: current.version, fence }, {
        to,
        nextAction: 'next',
        nowMs: (t += 10),
        ...(to === 'blocked' ? { reason: 'decision' as const } : {}),
      }),
    );
  }
  return current;
}

const BODY = (projectId: string, recordVersion: number, extra: Record<string, unknown> = {}) => ({
  ...buildProjectRecord({
    projectId,
    recordVersion,
    repository: { rootCommit: 'root1', remote: null, defaultBranch: 'main' },
    onboardedAt: 'git:abc123',
    profile: 'personal-local',
    stagingPath: '/work/staging',
    codebase: [],
    snapshot: 'sha256:' + '0'.repeat(64),
    mapping: { mode: 'full', scope: ['src'], mappedAt: 'git:abc123' },
    notMapped: [],
  }),
  ...extra,
});

describe('registration and creation', () => {
  it('registerProject inserts a row and a second call with the same root commit and path returns it', () => {
    const h = harness();
    try {
      const a = must(h.ledger.registerProject({ projectId: 'proj_a', rootCommit: 'r1', repoPath: '/p', remote: 'git@x:y', defaultBranch: 'main', nowMs: T0 }));
      const b = must(h.ledger.registerProject({ projectId: 'proj_other', rootCommit: 'r1', repoPath: '/p', nowMs: T0 + 5 }));
      assert.equal(b.projectId, 'proj_a');
      assert.equal(b.remote, 'git@x:y');
      assert.deepEqual(a, b);
      assert.equal(count(h.db, 'projects'), 1);
      must(h.ledger.registerProject({ projectId: 'proj_c', rootCommit: 'r1', repoPath: '/elsewhere', nowMs: T0 }));
      assert.equal(count(h.db, 'projects'), 2);
      assert.equal(must(h.ledger.findProject({ rootCommit: 'r1', repoPath: '/p' }))?.projectId, 'proj_a');
      assert.equal(must(h.ledger.findProject({ projectId: 'nope' })), null);
    } finally {
      h.close();
    }
  });

  it('createOnboarding writes the row at discovered version 1, checkpoint seq 1 from unregistered and one event', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      assert.equal(row.state, 'discovered');
      assert.equal(row.version, 1);
      assert.equal(row.leaseFence, 0);
      assert.deepEqual(row.preflight, { pin: 'git:abc', request: { mode: 'full' } });
      const checkpoints = h.db.prepare('SELECT * FROM checkpoints').all() as Record<string, unknown>[];
      assert.equal(checkpoints.length, 1);
      assert.equal(checkpoints[0]?.['seq'], 1);
      assert.equal(checkpoints[0]?.['from_state'], 'unregistered');
      assert.equal(checkpoints[0]?.['to_state'], 'discovered');
      assert.equal(checkpoints[0]?.['run_id'], 'onb_1');
      assert.equal(count(h.db, 'events'), 1);
    } finally {
      h.close();
    }
  });
});

describe('leases', () => {
  it('a free row grants fence 1, a second acquire while held conflicts, release frees it for fence 2', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const first = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0));
      assert.equal(first.fence, 1);
      assert.equal(first.expiresAt, new Date(T0 + 180_000).toISOString());
      const second = h.ledger.acquireLease(row.onboardingId, 'host:2:b', 180_000, T0 + 1);
      assert.ok(!second.ok && second.error.kind === 'conflict');
      assert.ok(!h.ledger.releaseLease(row.onboardingId, 'host:2:b', 1).ok, 'only the holder releases');
      must(h.ledger.releaseLease(row.onboardingId, 'host:1:a', 1));
      assert.equal(must(h.ledger.acquireLease(row.onboardingId, 'host:2:b', 180_000, T0 + 2)).fence, 2);
    } finally {
      h.close();
    }
  });

  it('renewLease extends only for the current holder and fence', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 1_000, T0));
      const renewed = must(h.ledger.renewLease(row.onboardingId, 'host:1:a', 1, 5_000, T0 + 500));
      assert.equal(renewed.expiresAt, new Date(T0 + 5_500).toISOString());
      assert.ok(!h.ledger.renewLease(row.onboardingId, 'host:9:z', 1, 5_000, T0 + 600).ok);
      assert.ok(!h.ledger.renewLease(row.onboardingId, 'host:1:a', 7, 5_000, T0 + 600).ok);
    } finally {
      h.close();
    }
  });
});

describe('transitionOnboarding', () => {
  it('moves state, bumps the version, writes one checkpoint and one event', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const checkpointsBefore = count(h.db, 'checkpoints');
      const eventsBefore = count(h.db, 'events');
      const next = must(h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'contract_proposed', nextAction: 'prepare-workspace', nowMs: T0 + 20 }));
      assert.equal(next.state, 'contract_proposed');
      assert.equal(next.version, 2);
      assert.equal(count(h.db, 'checkpoints'), checkpointsBefore + 1);
      assert.equal(count(h.db, 'events'), eventsBefore + 1);
      const latest = must(h.ledger.latestCheckpoint(row.onboardingId));
      assert.equal(latest?.nextAction, 'prepare-workspace');
      assert.equal(latest?.fromState, 'discovered');
      assert.equal(latest?.toState, 'contract_proposed');
      assert.equal(latest?.seq, 2);
    } finally {
      h.close();
    }
  });

  it('rejects a wrong version, a stale fence and an illegal edge without writing anything', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const before = snapshotRows(h.db);
      const wrongVersion = h.ledger.transitionOnboarding(row.onboardingId, { version: 5, fence }, { to: 'contract_proposed', nextAction: 'x', nowMs: T0 + 20 });
      const staleFence = h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence: fence + 1 }, { to: 'contract_proposed', nextAction: 'x', nowMs: T0 + 20 });
      const illegal = h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'active', nextAction: 'x', nowMs: T0 + 20 });
      const missing = h.ledger.transitionOnboarding('onb_missing', { version: 1, fence }, { to: 'contract_proposed', nextAction: 'x', nowMs: T0 + 20 });
      assert.ok(!wrongVersion.ok && wrongVersion.error.kind === 'conflict');
      assert.ok(!staleFence.ok && staleFence.error.kind === 'conflict');
      assert.ok(!illegal.ok && illegal.error.kind === 'invalid');
      assert.ok(!missing.ok && missing.error.kind === 'not_found');
      assert.equal(snapshotRows(h.db), before);
    } finally {
      h.close();
    }
  });

  it('writes state, checkpoint and event together or not at all', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const before = snapshotRows(h.db);
      const other = new DatabaseSync(h.dbPath);
      other.exec("CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
      other.close();
      const failed = h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'contract_proposed', nextAction: 'x', nowMs: T0 + 20 });
      assert.ok(!failed.ok);
      assert.equal(snapshotRows(h.db), before, 'the state update and checkpoint were rolled back');
      assert.equal(h.db.isTransaction, false);
    } finally {
      h.close();
    }
  });

  it('requires a reason for blocked, records it, and refuses one elsewhere', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const noReason = h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'blocked', nextAction: 'x', nowMs: T0 + 20 });
      assert.ok(!noReason.ok && noReason.error.kind === 'invalid');
      const stray = h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'contract_proposed', nextAction: 'x', nowMs: T0 + 20, reason: 'decision' });
      assert.ok(!stray.ok && stray.error.kind === 'invalid');
      const blocked = must(h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'blocked', nextAction: 'x', nowMs: T0 + 30, reason: 'enforcement_failure' }));
      assert.equal(blocked.reason, 'enforcement_failure');
      assert.equal(must(h.ledger.getOnboarding(row.onboardingId)).reason, 'enforcement_failure');
    } finally {
      h.close();
    }
  });

  it('recordCheckpoint adds a checkpoint without changing state or version and enforces the fence', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const cp = must(h.ledger.recordCheckpoint(row.onboardingId, { fence }, { nextAction: 'prepare-workspace', nowMs: T0 + 40, stagingWorktree: '/work/onb_1/staging' }));
      assert.equal(cp.seq, 2);
      assert.equal(cp.fromState, 'discovered');
      assert.equal(cp.toState, 'discovered');
      const after = must(h.ledger.getOnboarding(row.onboardingId));
      assert.equal(after.version, 1);
      assert.equal(after.state, 'discovered');
      assert.equal(after.stagingWorktree, '/work/onb_1/staging');
      assert.ok(!h.ledger.recordCheckpoint(row.onboardingId, { fence: fence + 1 }, { nextAction: 'x', nowMs: T0 + 50 }).ok);
    } finally {
      h.close();
    }
  });
});

describe('contracts, steps and attempts', () => {
  it('storeContract inserts the carrier run and the contract, links the onboarding, and refuses an update of the body', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      assert.equal(must(h.ledger.getContract(row.onboardingId)), null);
      const stored = must(h.ledger.storeContract(row.onboardingId, { fence }, { runId: 'run_1', digest: 'sha256:aa', body: { schema: 1, contractVersion: 1 }, policyRevision: 'sha256:bb', authorizedBy: 'local-user', nowMs: T0 + 5 }));
      assert.equal(stored.runId, 'run_1');
      assert.deepEqual(stored.body, { schema: 1, contractVersion: 1 });
      const run = h.db.prepare('SELECT * FROM runs WHERE run_id = ?').get('run_1') as Record<string, unknown>;
      assert.equal(run['state'], 'onboarding');
      assert.equal(run['title'], 'onboarding onb_1');
      assert.equal(run['project_id'], 'proj_1');
      assert.equal(must(h.ledger.getOnboarding(row.onboardingId)).contractRunId, 'run_1');
      assert.equal(must(h.ledger.getContract(row.onboardingId))?.digest, 'sha256:aa');
      assert.throws(() => h.db.exec("UPDATE contracts SET body_json = '{}' WHERE run_id = 'run_1'"), /immutable/);
      assert.ok(!h.ledger.storeContract(row.onboardingId, { fence: fence + 1 }, { runId: 'run_2', digest: 'd', body: {}, policyRevision: 'p', authorizedBy: 'a', nowMs: T0 }).ok, 'stale fence');
      assert.equal(count(h.db, 'runs'), 1);
    } finally {
      h.close();
    }
  });

  it('keeps checkpoint sequence monotonic across the move to the contract run', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      must(h.ledger.storeContract(row.onboardingId, { fence }, { runId: 'run_1', digest: 'd', body: {}, policyRevision: 'p', authorizedBy: 'a', nowMs: T0 }));
      const next = must(h.ledger.transitionOnboarding(row.onboardingId, { version: 1, fence }, { to: 'contract_proposed', nextAction: 'prepare-workspace', nowMs: T0 + 5 }));
      assert.equal(next.version, 2);
      const latest = must(h.ledger.latestCheckpoint(row.onboardingId));
      assert.equal(latest?.runId, 'run_1');
      assert.equal(latest?.seq, 2);
    } finally {
      h.close();
    }
  });

  it('records step results by (step, attempt) and replaces a repeated one', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      must(h.ledger.recordStepResult(row.onboardingId, { step: 'index:code-graph', status: 'absent', result: { reason: 'graphify-missing' }, nowMs: T0, completedAtMs: T0 + 1 }));
      must(h.ledger.recordStepResult(row.onboardingId, { step: 'index:code-graph', status: 'present', result: { nodes: 3 }, nowMs: T0 + 2, completedAtMs: T0 + 3 }));
      must(h.ledger.recordStepResult(row.onboardingId, { step: 'launch:map', attempt: 2, status: 'progressed', result: {}, nowMs: T0 }));
      const steps = must(h.ledger.getStepResults(row.onboardingId));
      assert.equal(steps.length, 2);
      const graph = steps.find((s) => s.step === 'index:code-graph');
      assert.equal(graph?.status, 'present');
      assert.deepEqual(graph?.result, { nodes: 3 });
      assert.equal(steps.find((s) => s.step === 'launch:map')?.completedAt, null);
    } finally {
      h.close();
    }
  });

  it('records attempts against the carrier run with increasing ordinals, and needs a contract first', () => {
    const h = harness();
    try {
      const row = registerAndCreate(h);
      const fence = must(h.ledger.acquireLease(row.onboardingId, 'host:1:a', 180_000, T0)).fence;
      const early = h.ledger.recordAttempt(row.onboardingId, { reason: 'map', nowMs: T0 });
      assert.ok(!early.ok && early.error.kind === 'invalid');
      must(h.ledger.storeContract(row.onboardingId, { fence }, { runId: 'run_1', digest: 'd', body: {}, policyRevision: 'p', authorizedBy: 'a', nowMs: T0 }));
      const a1 = must(h.ledger.recordAttempt(row.onboardingId, { reason: 'map', nowMs: T0 + 1 }));
      const a2 = must(h.ledger.recordAttempt(row.onboardingId, { reason: 'map-retry', nowMs: T0 + 2, outcome: 'failed', endedAtMs: T0 + 3 }));
      assert.deepEqual([a1.ordinal, a2.ordinal], [1, 2]);
      const list = must(h.ledger.listAttempts(row.onboardingId));
      assert.deepEqual(list.map((a) => a.reason), ['map', 'map-retry']);
      assert.equal(list[1]?.outcome, 'failed');
      assert.equal(list[0]?.runId, 'run_1');
    } finally {
      h.close();
    }
  });
});

describe('insertRecordAndActivate', () => {
  const INDEXES = { graph: { builtAtCommit: 'git:g1', knowledge: { documentsCommit: 'git:k1' } }, intel: { refreshedAtCommit: 'git:i1' } };

  function ready(h: Harness): OnboardingRow {
    return advance(h, registerAndCreate(h), 'contract_proposed', 'mapping', 'validating', 'planning_ready');
  }

  it('inserts version 1 as active, derives the columns and commits planning_ready to active in one step', () => {
    const h = harness();
    try {
      const row = ready(h);
      const result = must(h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence }, { body: BODY('proj_1', 1, { indexes: INDEXES }), nowMs: T0 + 1000 }));
      assert.equal(result.recordVersion, 1);
      assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
      const stored = h.db.prepare('SELECT * FROM project_records WHERE project_id = ?').get('proj_1') as Record<string, unknown>;
      assert.equal(stored['state'], 'active');
      assert.equal(stored['onboarded_revision'], 'git:abc123');
      assert.equal(stored['gsd_version'], 'unknown');
      assert.equal(stored['mapping_mode'], 'full');
      assert.equal(stored['mapping_scope_json'], '["src"]');
      assert.equal(stored['completeness'], 'complete');
      assert.equal(stored['graph_commit'], 'git:g1');
      assert.equal(stored['intel_commit'], 'git:i1');
      assert.equal(stored['knowledge_commit'], 'git:k1');
      assert.equal(stored['superseded_at'], null);
      assert.equal(stored['activated_at'], new Date(T0 + 1000).toISOString());
      assert.equal(stored['digest'], result.digest);
      const after = must(h.ledger.getOnboarding(row.onboardingId));
      assert.equal(after.state, 'active');
      assert.equal(after.version, row.version + 1);
      const active = must(h.ledger.getActiveRecord('proj_1'));
      assert.equal(active?.version, 1);
      assert.equal(active?.graphCommit, 'git:g1');
    } finally {
      h.close();
    }
  });

  it('stores NULL for index commits that are absent', () => {
    const h = harness();
    try {
      const row = ready(h);
      must(h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence }, { body: BODY('proj_1', 1), nowMs: T0 + 1000 }));
      const stored = h.db.prepare('SELECT graph_commit, intel_commit, knowledge_commit FROM project_records').get() as Record<string, unknown>;
      assert.deepEqual({ ...stored }, { graph_commit: null, intel_commit: null, knowledge_commit: null });
    } finally {
      h.close();
    }
  });

  it('supersedes the previous active version and numbers the next one max+1', () => {
    const h = harness();
    try {
      const first = ready(h);
      must(h.ledger.insertRecordAndActivate(first.onboardingId, { version: first.version, fence: first.leaseFence }, { body: BODY('proj_1', 1), nowMs: T0 + 1000 }));
      // A second onboarding of the same project, advanced to planning_ready through the ledger API.
      const second = must(h.ledger.createOnboarding({ onboardingId: 'onb_2', projectId: 'proj_1', preflight: {}, nowMs: T0 + 2000 }));
      const ready2 = advance(h, second, 'contract_proposed', 'mapping', 'validating', 'planning_ready');
      const result = must(h.ledger.insertRecordAndActivate('onb_2', { version: ready2.version, fence: ready2.leaseFence }, { body: BODY('proj_1', 2), nowMs: T0 + 3000 }));
      assert.equal(result.recordVersion, 2);
      const rows = h.db.prepare('SELECT version, state, superseded_at FROM project_records ORDER BY version').all() as Record<string, unknown>[];
      assert.equal(rows[0]?.['superseded_at'], new Date(T0 + 3000).toISOString());
      assert.equal(rows[1]?.['superseded_at'], null);
      assert.equal(must(h.ledger.getActiveRecord('proj_1'))?.version, 2);
    } finally {
      h.close();
    }
  });

  it('refuses a body whose recordVersion is not the next version, and a wrong onboarding state, writing nothing', () => {
    const h = harness();
    try {
      const notReady = advance(h, registerAndCreate(h), 'contract_proposed');
      const before = snapshotRows(h.db);
      const early = h.ledger.insertRecordAndActivate(notReady.onboardingId, { version: notReady.version, fence: notReady.leaseFence }, { body: BODY('proj_1', 1), nowMs: T0 + 1000 });
      assert.ok(!early.ok && early.error.kind === 'invalid');
      const row = advance(h, notReady, 'mapping', 'validating', 'planning_ready');
      const afterAdvance = snapshotRows(h.db);
      assert.notEqual(afterAdvance, before);
      const wrong = h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence }, { body: BODY('proj_1', 9), nowMs: T0 + 1000 });
      assert.ok(!wrong.ok && wrong.error.kind === 'conflict');
      const stale = h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence + 1 }, { body: BODY('proj_1', 1), nowMs: T0 + 1000 });
      assert.ok(!stale.ok && stale.error.kind === 'conflict');
      assert.equal(snapshotRows(h.db), afterAdvance);
      assert.equal(count(h.db, 'project_records'), 0);
    } finally {
      h.close();
    }
  });

  it('refuses an UPDATE of a stored record body or digest, but allows superseding', () => {
    const h = harness();
    try {
      const row = ready(h);
      must(h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence }, { body: BODY('proj_1', 1), nowMs: T0 + 1000 }));
      assert.throws(() => h.db.exec("UPDATE project_records SET body_json = '{}'"), /immutable/);
      assert.throws(() => h.db.exec("UPDATE project_records SET digest = 'sha256:x'"), /immutable/);
      h.db.exec("UPDATE project_records SET superseded_at = '2030-01-01T00:00:00.000Z'");
    } finally {
      h.close();
    }
  });

  it('does not store document text: oversized record bodies are refused and no table has a content column', () => {
    const h = harness();
    try {
      const row = ready(h);
      const huge = 'x'.repeat(2 * 1024 * 1024);
      const refused = h.ledger.insertRecordAndActivate(row.onboardingId, { version: row.version, fence: row.leaseFence }, { body: BODY('proj_1', 1, { notMapped: [huge] }), nowMs: T0 + 1000 });
      assert.ok(!refused.ok && refused.error.kind === 'invalid');
      assert.equal(count(h.db, 'project_records'), 0);
      const tables = (h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      const forbidden = /^(content|text|document|documents|body_text|graph_json|intel_json|map_text|file_text)$/;
      for (const table of tables) {
        for (const col of h.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]) {
          assert.doesNotMatch(col.name, forbidden, `${table}.${col.name}`);
        }
      }
    } finally {
      h.close();
    }
  });
});

describe('events', () => {
  it('every row_hash recomputes from prev_hash and the row fields, starting from 64 zeros', () => {
    const h = harness();
    try {
      const row = advance(h, registerAndCreate(h), 'contract_proposed', 'mapping');
      must(h.ledger.appendEvent({ type: 'invocation.started', runId: row.onboardingId, data: { invocationId: 'inv_1', count: 3 }, nowMs: T0 + 500 }));
      must(h.ledger.appendEvent({ type: 'note', data: {}, nowMs: T0 + 600 }));
      const rows = h.db.prepare('SELECT * FROM events ORDER BY seq').all() as Record<string, string | null>[];
      assert.ok(rows.length >= 5);
      let prev = '0'.repeat(64);
      for (const e of rows) {
        assert.equal(e['prev_hash'], prev);
        const expected = createHash('sha256').update([prev, e['ts'], e['type'], e['run_id'] ?? '', e['data_json']].join('\n')).digest('hex');
        assert.equal(e['row_hash'], expected, `seq ${String(e['seq'])}`);
        prev = e['row_hash'] as string;
      }
    } finally {
      h.close();
    }
  });

  it('refuses UPDATE and DELETE of events', () => {
    const h = harness();
    try {
      registerAndCreate(h);
      assert.throws(() => h.db.exec("UPDATE events SET type = 'x'"), /append-only/);
      assert.throws(() => h.db.exec('DELETE FROM events'), /append-only/);
    } finally {
      h.close();
    }
  });

  it('refuses event data that is not IDs, counts and digests (long strings)', () => {
    const h = harness();
    try {
      const before = count(h.db, 'events');
      const long = h.ledger.appendEvent({ type: 'leak', data: { text: 'x'.repeat(5000) }, nowMs: T0 });
      assert.ok(!long.ok && long.error.kind === 'invalid');
      const nested = h.ledger.appendEvent({ type: 'leak', data: { a: { b: ['y'.repeat(5000)] } }, nowMs: T0 });
      assert.ok(!nested.ok && nested.error.kind === 'invalid');
      assert.equal(count(h.db, 'events'), before);
    } finally {
      h.close();
    }
  });

  it('recordArtifact and upsertAdapterConfig are idempotent by key', () => {
    const h = harness();
    try {
      must(h.ledger.recordArtifact({ digest: 'sha256:aa', size: 10, kind: 'map', retention: 'run', store: 'local-fs', nowMs: T0 }));
      must(h.ledger.recordArtifact({ digest: 'sha256:aa', size: 10, kind: 'map', retention: 'run', store: 'local-fs', nowMs: T0 + 1 }));
      assert.equal(count(h.db, 'artifacts'), 1);
      must(h.ledger.upsertAdapterConfig({ name: 'host', port: 'agent-host', adapter: 'unavailable', configDigest: 'sha256:1', descriptor: { a: 1 } }));
      must(h.ledger.upsertAdapterConfig({ name: 'host', port: 'agent-host', adapter: 'claude', configDigest: 'sha256:2', descriptor: { a: 2 } }));
      const rows = h.db.prepare('SELECT * FROM adapter_configs').all() as Record<string, unknown>[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.['adapter'], 'claude');
      assert.equal(rows[0]?.['config_digest'], 'sha256:2');
    } finally {
      h.close();
    }
  });
});

describe('status over seeded ledger rows', () => {
  it('prints the documented shape per project, with the blocked reason and every index key, and takes no lease', () => {
    const roots = freshRoots();
    const h = harness(roots);
    // Project 1: active with a record and two indexes.
    const active = advance(h, registerAndCreate(h, '1'), 'contract_proposed', 'mapping', 'validating', 'planning_ready');
    must(h.ledger.insertRecordAndActivate(active.onboardingId, { version: active.version, fence: active.leaseFence }, { body: BODY('proj_1', 1, { indexes: { graph: { builtAtCommit: 'git:g1' }, intel: { refreshedAtCommit: 'git:i1' } } }), nowMs: T0 + 1000 }));
    // Project 2: blocked with a reason; Project 3: registered only.
    advance(h, registerAndCreate(h, '2'), 'contract_proposed', 'blocked');
    must(h.ledger.registerProject({ projectId: 'proj_3', rootCommit: 'root3', repoPath: '/repo/3', nowMs: T0 + 5000 }));
    const before = snapshotRows(h.db);
    h.close();

    const r = runCli(['status', '--json'], { roots });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as Record<string, unknown>[];
    assert.equal(out.length, 3);
    const byId = Object.fromEntries(out.map((e) => [e['projectId'] as string, e]));
    assert.deepEqual(Object.keys(byId['proj_1'] as object).sort(), ['indexes', 'mapping', 'onboardedRevision', 'onboardingId', 'projectId', 'reason', 'recordVersion', 'repoPath', 'state']);
    assert.equal(byId['proj_1']?.['state'], 'active');
    assert.equal(byId['proj_1']?.['recordVersion'], 1);
    assert.equal(byId['proj_1']?.['onboardedRevision'], 'git:abc123');
    assert.deepEqual(Object.keys(byId['proj_1']?.['indexes'] as object).sort(), ['graph', 'intel']);
    assert.equal((byId['proj_1']?.['mapping'] as Record<string, unknown>)['mode'], 'full');
    assert.equal(byId['proj_2']?.['state'], 'blocked');
    assert.equal(byId['proj_2']?.['reason'], 'decision');
    assert.equal(byId['proj_2']?.['recordVersion'], null);
    assert.equal(byId['proj_3']?.['onboardingId'], null);
    assert.equal(byId['proj_3']?.['state'], 'unregistered');

    const text = runCli(['status'], { roots });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /onboarding onb_2: blocked \(decision\)/);
    assert.match(text.stdout, /record v1 at git:abc123; mapping full \(complete, fresh\); indexes: graph, intel/);

    const reopened = harness(roots);
    try {
      assert.equal(snapshotRows(reopened.db), before, 'status wrote nothing');
    } finally {
      reopened.close();
    }
  });
});
