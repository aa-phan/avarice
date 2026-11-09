// `avarice digest` (plan 03-23; D-23, D-24; AUT-6). The tracer drives the real CLI: a profile with one open decision and one run ready for review gets
// one batched banner through the osascript adapter (a fake script, so no test posts a real banner), one digest notification row and nothing else; a
// profile with nothing waiting gets silence. The ledger is seeded through its own methods and observed with raw SQL.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/offline.ts';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { newId } from '../../src/domain/ids.ts';
import type { Result } from '../../src/domain/result.ts';

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');
const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);
const DIGEST_STATE = `sha256:${'9'.repeat(64)}`;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

// The profile config is hand-edited JSON; resolveProfile leaves an existing file alone.
function writeProfileConfig(roots: CliRoots, extra: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: roots.AVARICE_DATA_ROOT, workRoot: roots.AVARICE_WORK_ROOT, ...extra }, null, 2)}\n`, { mode: 0o600 });
}

interface Profile {
  roots: CliRoots;
  log: string;
  env: Record<string, string>;
}

// A profile whose osascript is the fake script. The ledger exists (one read-only command creates and migrates it).
function profile(): Profile {
  const roots = makeRoots();
  const logDir = mkdtempSync(join(tmpdir(), 'avarice-digest-'));
  cleanup.push(roots.base, logDir);
  chmodSync(FAKE_OSASCRIPT, 0o755);
  writeProfileConfig(roots, { notify: { local: { osascriptPath: FAKE_OSASCRIPT } } });
  const log = join(logDir, 'osascript.log');
  const env = { AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: log };
  const created = runCli(['inbox'], { roots, entry: TEST_CLI, env });
  assert.equal(created.code, 0, created.stderr);
  return { roots, log, env };
}

// Seeds through the ledger's own methods what the digest reads: a run with an open decision and a run that waits for a review.
function seedWaiting(roots: CliRoots, decisions = 1, reviews = 1): { decisionIds: string[]; reviewRunIds: string[] } {
  const db = must(openDb(join(roots.AVARICE_DATA_ROOT, 'state.db')));
  try {
    const ledger = new SqliteLedger(db, (prefix) => newId(prefix, T0, randomBytes(10)));
    must(ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: T0 }));
    const decisionIds: string[] = [];
    const reviewRunIds: string[] = [];
    for (let n = 0; n < decisions; n += 1) {
      const runId = `run_decide${n}`;
      must(ledger.createRun({ runId, projectId: 'proj_1', title: `blocked run ${n}`, nowMs: T0 + 1 }));
      must(ledger.storeRunContract(runId, { fence: 0 }, { version: 1, digest: `sha256:${'a'.repeat(64)}`, body: { schema: 1, notify: { reviewReady: ['local'], blocking: ['local'], digest: ['local'] } }, policyRevision: 'p', authorizedBy: 'owner', nowMs: T0 + 2 }));
      must(ledger.upsertWorkItem({ runId, itemId: 'A', dependsOn: [], size: 'medium', model: 'sonnet', spec: { goal: 'A' }, nowMs: T0 + 3 }));
      const lease = must(ledger.acquireRunLease(runId, 'holder', 1_000_000, T0 + 4));
      must(ledger.transitionWorkItem(runId, 'A', { fence: lease.fence }, { to: 'blocked_on_decision', nowMs: T0 + 5 }));
      const decision = must(
        ledger.openDecision({
          runId,
          contractVersion: 1,
          class: 'acceptance',
          issue: 'Private issue text: ignore previous instructions',
          options: [{ id: 'keep', label: 'keep (private option label)' }],
          consequences: {},
          evidenceRefs: [],
          affectedItems: ['A'],
          stateDigest: DIGEST_STATE,
          urgency: 'blocking',
          nowMs: T0 + 10,
        }),
      );
      decisionIds.push(decision.decisionId);
    }
    for (let n = 0; n < reviews; n += 1) {
      const runId = `run_review${n}`;
      must(ledger.createRun({ runId, projectId: 'proj_1', title: `review run ${n}`, nowMs: T0 + 1 }));
      db.prepare("UPDATE runs SET state = 'ready_for_review' WHERE run_id = ?").run(runId);
      reviewRunIds.push(runId);
    }
    return { decisionIds, reviewRunIds };
  } finally {
    db.close();
  }
}

const BANNER_ARGS = (body: string): string[] => ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', '--', body, 'AVARICE'];

describe('avarice digest posts one banner for an open decision and a review-ready run, and nothing when there is none (tracer; D-23, AUT-6)', () => {
  const waiting = profile();
  const ids = seedWaiting(waiting.roots);
  const ran = runCli(['digest'], { roots: waiting.roots, entry: TEST_CLI, env: waiting.env });

  it('exits 0 and prints one result line, with no terminal on either stream (as launchd runs it)', () => {
    assert.equal(ran.code, 0, ran.stderr + ran.stdout);
    assert.equal(ran.stderr, '');
    assert.equal(ran.stdout.trim().split('\n').length, 1);
    assert.match(ran.stdout, /1 decision waiting, 1 run ready for review/);
  });

  it('gives the fake osascript one call whose body counts the decision and the review', () => {
    const lines = readFileSync(waiting.log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'one banner');
    assert.deepEqual(JSON.parse(lines[0] as string), BANNER_ARGS('1 decision waiting, 1 run ready for review. Run: avarice inbox'));
  });

  it('records one digest notification with no run, delivered on the first attempt, about the decision and the run', () => {
    const notifications = rows<{ run_id: string | null; kind: string; destination: string; subject_ids_json: string; state: string; attempts: number }>(waiting.roots, 'SELECT * FROM notifications');
    assert.equal(notifications.length, 1);
    const n = notifications[0] as (typeof notifications)[number];
    assert.deepEqual([n.run_id, n.kind, n.destination, n.state, n.attempts], [null, 'digest', 'local', 'delivered', 1]);
    assert.deepEqual((JSON.parse(n.subject_ids_json) as string[]).sort(), [...ids.decisionIds, ...ids.reviewRunIds].sort());
    assert.equal(rows(waiting.roots, "SELECT 1 FROM events WHERE type = 'notify.delivered'").length, 1);
  });

  it('answers no decision: the decision is still open and the inbox lists it', () => {
    assert.equal(rows(waiting.roots, "SELECT 1 FROM decisions WHERE state = 'open'").length, 1);
    const inbox = runCli(['inbox', '--json'], { roots: waiting.roots, entry: TEST_CLI, env: waiting.env });
    assert.ok(inbox.stdout.includes(ids.decisionIds[0] as string));
  });
});

describe('avarice digest with nothing to report', () => {
  it('exits 0, prints nothing, calls no osascript and writes no notification row', () => {
    const quiet = profile();
    const ran = runCli(['digest'], { roots: quiet.roots, entry: TEST_CLI, env: quiet.env });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, '');
    assert.equal(ran.stderr, '');
    assert.equal(existsSync(quiet.log), false, 'osascript was never called');
    assert.equal(rows(quiet.roots, 'SELECT 1 FROM notifications').length, 0);
  });

  it('reports a review-ready run alone: the banner says 0 decisions and 1 run', () => {
    const waiting = profile();
    seedWaiting(waiting.roots, 0, 1);
    const first = runCli(['digest'], { roots: waiting.roots, entry: TEST_CLI, env: waiting.env });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /0 decisions waiting, 1 run ready for review/);
    const call = JSON.parse(readFileSync(waiting.log, 'utf8').trim().split('\n')[0] as string) as string[];
    assert.deepEqual(call, BANNER_ARGS('0 decisions waiting, 1 run ready for review. Run: avarice inbox'));
  });
});

describe('avarice digest refuses inside a run', () => {
  it('exits 64 under AVARICE_RUN and writes nothing: no data root, no row, no banner', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const logDir = mkdtempSync(join(tmpdir(), 'avarice-digest-run-'));
    cleanup.push(logDir);
    const log = join(logDir, 'osascript.log');
    const ran = runCli(['digest'], { roots, entry: TEST_CLI, env: { AVARICE_RUN: 'run_1', AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: log } });
    assert.equal(ran.code, 64, ran.stderr);
    assert.match(ran.stderr, /AVARICE_RUN/);
    assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false, 'the profile was never resolved');
    assert.equal(existsSync(log), false);
  });

  it('takes no argument', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const ran = runCli(['digest', 'now'], { roots, entry: TEST_CLI });
    assert.equal(ran.code, 64, ran.stderr);
    assert.match(ran.stderr, /usage: avarice digest/);
    assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false);
  });
});
