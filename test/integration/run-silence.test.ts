// S-18 offline (plan 03-26; AUT-4, AUT-6; SC2): silence, a passed deadline, a held banner and a failed notification are never an answer. An open decision, a notifier that
// fails every delivery and a clock the test moves: the batch window and the digest times pass, the digest runs at each of them and fails and is recorded, and the
// decision stays open, unanswered and visible, with nothing delivered to the item that depends on it. The boundary cases pin the instants where a rule changes
// (the batch window to the millisecond, a digest time to the minute): at each of them only notification rows change.
//
// The decision has no deadline field, so a "passed deadline" is time passing on the injected clock past the batch window and the digest times; no code path turns it
// into an answer, which these tests check against every table that is not a notification. The notifier is a port that fails, and the wait between delivery
// attempts moves the same injected clock, so no test waits and none posts a banner.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { runDigest } from '../../src/app/digest.ts';
import { flushDueNotifications, queueDecisionNotice } from '../../src/app/notify.ts';
import type { AppDeps, Clock } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { nextDigestAt } from '../../src/domain/notify-policy.ts';
import { err } from '../../src/domain/result.ts';
import type { Notifier, NotifierMessage } from '../../src/ports/notifier.ts';
import { MovableClock, runMain, startBlocked } from '../helpers/decide-cli.ts';
import { attemptsOfRun, itemStatesOf, runRowOf } from '../helpers/independent-work.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const HOUR_MS = 3_600_000;
const BATCH_WINDOW_MS = 600_000;
const DIGEST_TIMES = ['12:30', '17:30'] as const;

// A notifier that fails every delivery the way a missing or failing osascript does, and counts the calls.
interface FailingNotifier extends Notifier {
  calls: NotifierMessage[];
}
function failingNotifier(): FailingNotifier {
  const calls: NotifierMessage[] = [];
  return {
    calls,
    descriptor: { port: 'notifier', adapter: 'test-failing', version: '0.0.0', capabilities: {}, offline: true },
    deliver: (message) => {
      calls.push(message);
      return Promise.resolve(err({ kind: 'unavailable', cause: 'osascript-failed' }));
    },
  };
}

// The delivery loop waits 0, 10 and 60 seconds between attempts; here the wait moves the injected clock, so it costs nothing.
function withFastSleep(deps: AppDeps, advance: (ms: number) => void): AppDeps {
  assert.ok(deps.notify !== undefined, 'the composition has a notifier');
  return { ...deps, notify: { ...deps.notify, sleep: (ms: number) => Promise.resolve(advance(ms)) } };
}

class SteppedClock implements Clock {
  now: number;
  constructor(now: number) {
    this.now = now;
  }
  nowMs(): number {
    return this.now;
  }
}

// ---- what a notification may change, and what it may not ----------------------------------------------------------------------------------------

function dumpTables(roots: CliRoots): Record<string, unknown[]> {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
  try {
    const dump: Record<string, unknown[]> = {};
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      // The notification rows are what a banner, a retry and a digest are allowed to change, with the events that record them; the adapter and meta rows
      // describe the process that opened the store, not a run.
      if (name === 'notifications' || name === 'adapter_configs' || name === 'meta') continue;
      const sql = name === 'events' ? "SELECT * FROM events WHERE type NOT LIKE 'notify.%' ORDER BY rowid" : `SELECT * FROM ${name} ORDER BY rowid`;
      dump[name] = (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));
    }
    return dump;
  } finally {
    db.close();
  }
}

interface DecisionDump {
  [column: string]: unknown;
}
const decisionRowOf = (roots: CliRoots, decisionId: string): DecisionDump => ledgerRows<DecisionDump>(roots, 'SELECT * FROM decisions WHERE decision_id = ?', decisionId)[0] as DecisionDump;

interface Notice {
  kind: string;
  state: string;
  attempts: number;
  last_error: string | null;
}
const noticesOf = (roots: CliRoots): Notice[] => ledgerRows<Notice>(roots, 'SELECT kind, state, attempts, last_error FROM notifications ORDER BY rowid');

// ---- a seeded profile with one open decision, for the boundary cases ----------------------------------------------------------------------------

interface Seeded {
  roots: CliRoots;
  deps: AppDeps;
  notifier: FailingNotifier;
  runId: string;
  decisionId: string;
  close(): void;
}

const SEED_AT = Date.UTC(2026, 10, 8, 9, 0, 0);
const SEED_DIGEST = `sha256:${'9'.repeat(64)}`;

// A profile whose ledger holds one run blocked on one decision, seeded through the ledger's own methods; the clock and the notifier are the test's.
function seeded(clock: Clock, advance: (ms: number) => void): Seeded {
  const roots = makeRoots();
  cleanup.push(roots.base);
  const notifier = failingNotifier();
  const composed = createDeps(profileEnv(roots), { clock, notifier });
  assert.ok(composed.ok, 'composition');
  const deps = withFastSleep(composed.value.deps, advance);
  const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
    assert.ok(result.ok, JSON.stringify(result));
    return (result as { ok: true; value: T }).value;
  };
  const ledger = deps.ledger;
  must(ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root1', repoPath: '/repo/1', remote: null, defaultBranch: 'main', nowMs: SEED_AT }));
  const runId = 'run_silent';
  must(ledger.createRun({ runId, projectId: 'proj_1', title: 'a run that waits', nowMs: SEED_AT + 1 }));
  must(ledger.storeRunContract(runId, { fence: 0 }, { version: 1, digest: `sha256:${'a'.repeat(64)}`, body: { schema: 1, notify: { reviewReady: ['local'], blocking: ['local'], digest: ['local'] } }, policyRevision: 'p', authorizedBy: 'owner', nowMs: SEED_AT + 2 }));
  must(ledger.upsertWorkItem({ runId, itemId: 'B', dependsOn: [], size: 'medium', model: 'sonnet', spec: { goal: 'B' }, nowMs: SEED_AT + 3 }));
  must(ledger.upsertWorkItem({ runId, itemId: 'D', dependsOn: ['B'], size: 'medium', model: 'sonnet', spec: { goal: 'D' }, nowMs: SEED_AT + 3 }));
  const lease = must(ledger.acquireRunLease(runId, 'holder', 1_000_000, SEED_AT + 4));
  must(ledger.transitionWorkItem(runId, 'B', { fence: lease.fence }, { to: 'blocked_on_decision', nowMs: SEED_AT + 5 }));
  const decision = must(
    ledger.openDecision({
      runId,
      contractVersion: 1,
      class: 'acceptance',
      issue: 'Which status code?',
      options: [
        { id: '1', label: '404' },
        { id: '2', label: '410' },
      ],
      consequences: {},
      evidenceRefs: [],
      affectedItems: ['B', 'D'],
      stateDigest: SEED_DIGEST,
      urgency: 'blocking',
      nowMs: SEED_AT + 10,
    }),
  );
  must(ledger.releaseRunLease(runId, 'holder', lease.fence));
  return { roots, deps, notifier, runId, decisionId: decision.decisionId, close: composed.value.close };
}

// ---- S-18: 72 hours of silence --------------------------------------------------------------------------------------------------------------------

function localInstant(base: number, dayOffset: number, time: string): number {
  const at = new Date(base);
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + dayOffset, hours, minutes, 0, 0).getTime();
}

describe('S-18 offline: 72 hours of silence with a notifier that fails every delivery approve nothing (AUT-4)', () => {
  const b = startBlocked(cleanup);
  const { f, runId, decisionId } = b;
  const clock = new MovableClock();
  const notifier = failingNotifier();
  const composed = createDeps(profileEnv(f.roots), { clock, notifier });
  assert.ok(composed.ok, 'composition');
  const deps = withFastSleep(composed.value.deps, (ms) => clock.advance(ms));
  const t0 = clock.nowMs();
  const before = { decision: decisionRowOf(f.roots, decisionId), tables: dumpTables(f.roots) };
  const digests: number[] = [];

  it('runs the digest at every digest time of 72 hours, flushes the batch window once, and every delivery fails and is recorded', async () => {
    // The first notice of a batch starts a window; one is queued now and falls due ten minutes later.
    const queued = queueDecisionNotice(deps, runId, decisionId);
    assert.ok(queued.ok, JSON.stringify(queued));
    assert.equal(queued.value.length, 1, 'one pending notice');

    const instants: Array<{ at: number; kind: 'batch' | 'digest' }> = [{ at: Date.parse((queued.value[0] as { createdAt: string }).createdAt) + BATCH_WINDOW_MS, kind: 'batch' }];
    for (let day = 0; day <= 3; day += 1) {
      for (const time of DIGEST_TIMES) {
        const at = localInstant(t0, day, time);
        if (at > t0 && at <= t0 + 72 * HOUR_MS) instants.push({ at, kind: 'digest' });
      }
    }
    instants.sort((x, y) => x.at - y.at);
    assert.equal(instants.filter((i) => i.kind === 'digest').length, 6, 'two digest times a day for three days');

    for (const instant of instants) {
      // A delivery's waits move the clock past an instant that follows soon after: the clock never runs backwards, so that instant is met a little late.
      clock.setTo(Math.max(instant.at, clock.nowMs()));
      if (instant.kind === 'batch') {
        const flushed = await flushDueNotifications(deps, runId);
        assert.ok(flushed.ok, JSON.stringify(flushed));
        assert.equal(flushed.value.result, 'failed', 'the due batch was raised and its delivery failed');
      } else {
        const digest = await runDigest(deps, clock.nowMs());
        assert.ok(digest.ok, JSON.stringify(digest));
        assert.deepEqual([digest.value.posted, digest.value.result, digest.value.decisions, digest.value.errorCode], [false, 'failed', 1, 'osascript-failed']);
        digests.push(clock.nowMs());
      }
    }
    // The last instant of the window, and one more look at what is due: nothing is, a failed notice is final.
    clock.setTo(Math.max(t0 + 72 * HOUR_MS, clock.nowMs()));
    assert.ok(clock.nowMs() - t0 >= 72 * HOUR_MS, '72 hours passed on the injected clock');
    const last = await flushDueNotifications(deps, runId);
    assert.ok(last.ok && last.value.result === 'none', JSON.stringify(last));
    assert.equal(digests.length, 6);

    const notices = noticesOf(f.roots);
    const failedDigests = notices.filter((n) => n.kind === 'digest');
    assert.equal(failedDigests.length, 6, 'one digest row per digest time');
    for (const n of notices.filter((x) => x.state !== 'delivered')) assert.deepEqual([n.state, n.attempts, n.last_error], ['failed', 3, 'osascript-failed'], 'every undelivered row ended failed after three recorded attempts');
    assert.equal(notifier.calls.length, 3 * (6 + 1), 'three attempts for each of the six digests and the one batch');
    assert.ok(notifier.calls.every((m) => m.title === 'AVARICE' && !/\bdec_|Which status/.test(m.body)), 'no banner carried a decision ID or the question text');
  });

  it('leaves the decision open with answered_at, answered_by, answer and answer_channel unset, and every table but the notifications as it was', () => {
    const row = decisionRowOf(f.roots, decisionId);
    assert.equal(row['state'], 'open');
    for (const column of ['answered_at', 'answered_by', 'answer', 'answer_channel']) assert.equal(row[column], null, `${column} is unset`);
    assert.deepEqual(row, before.decision, 'the decision row is byte-identical to the one before the 72 hours');
    assert.deepEqual(dumpTables(f.roots), before.tables, 'nothing but notification rows and their events changed');
    assert.equal(ledgerRows(f.roots, "SELECT 1 FROM decisions WHERE state != 'open'").length, 0, 'no decision was answered, withdrawn or made stale');
  });

  it('delegated no dependent item: D has no attempt, B stays blocked, and the run is still blocked on its decision with no lease', () => {
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:blocked_on_decision', 'C:done', 'D:ready'],
    );
    assert.equal(attemptsOfRun(f.roots, runId).filter((a) => a.item_id === 'D').length, 0, 'no attempt of D');
    const run = runRowOf(f.roots, runId);
    assert.deepEqual([run.state, run.reason, run.lease_holder], ['blocked_on_decision', 'decision', null]);
  });

  it('lists the decision in `inbox --json` and `status --json` after the 72 hours, with the failed notification shown', async () => {
    const inbox = await runMain(f.roots, ['inbox', '--json'], { clock });
    assert.equal(inbox.code, 0, inbox.err);
    const view = JSON.parse(inbox.out) as { decisions: Array<{ decisionId: string; notification?: { state: string; lastError?: string } }> };
    const listed = view.decisions.find((d) => d.decisionId === decisionId);
    assert.ok(listed !== undefined, 'the inbox lists the decision');
    assert.deepEqual([listed.notification?.state, listed.notification?.lastError], ['failed', 'osascript-failed']);

    const status = await runMain(f.roots, ['status', '--json'], { clock });
    assert.equal(status.code, 0, status.err);
    const projects = JSON.parse(status.out) as Array<{ runs?: Array<{ runId: string; state: string; openDecisions: number; decisions?: Array<{ decisionId: string; state: string }> }> }>;
    const shown = projects.flatMap((p) => p.runs ?? []).find((r) => r.runId === runId);
    assert.ok(shown !== undefined, 'status lists the run');
    assert.deepEqual([shown.state, shown.openDecisions, shown.decisions?.find((d) => d.decisionId === decisionId)?.state], ['blocked_on_decision', 1, 'open']);
    composed.value.close();
  });
});

// ---- AUT-4 boundaries: the instants where a rule changes ----------------------------------------------------------------------------------------

describe('AUT-4 boundary: the batch window to the millisecond (600000 ms after the first notice)', () => {
  for (const delta of [BATCH_WINDOW_MS - 1, BATCH_WINDOW_MS, BATCH_WINDOW_MS + 1]) {
    it(`${delta} ms after the notice the batch is ${delta < BATCH_WINDOW_MS ? 'not yet due and nothing happens' : 'due, its delivery fails, and only notification rows change'}`, async () => {
      const clock = new SteppedClock(SEED_AT + 20);
      const s = seeded(clock, (ms) => void (clock.now += ms));
      try {
        const queued = queueDecisionNotice(s.deps, s.runId, s.decisionId);
        assert.ok(queued.ok && queued.value.length === 1, JSON.stringify(queued));
        const before = { decision: decisionRowOf(s.roots, s.decisionId), tables: dumpTables(s.roots) };
        clock.now = (queued.value[0] ? Date.parse(queued.value[0].createdAt) : 0) + delta;

        const flushed = await flushDueNotifications(s.deps, s.runId);
        assert.ok(flushed.ok, JSON.stringify(flushed));
        const notices = noticesOf(s.roots);
        if (delta < BATCH_WINDOW_MS) {
          assert.equal(flushed.value.result, 'none');
          assert.deepEqual(notices, [{ kind: 'decisions', state: 'pending', attempts: 0, last_error: null }], 'the notice still waits, untouched');
          assert.equal(s.notifier.calls.length, 0, 'no banner was tried');
        } else {
          assert.equal(flushed.value.result, 'failed');
          assert.deepEqual(notices, [{ kind: 'decisions', state: 'failed', attempts: 3, last_error: 'osascript-failed' }], 'three attempts, recorded, failed');
          assert.equal(s.notifier.calls.length, 3);
        }
        assert.deepEqual(decisionRowOf(s.roots, s.decisionId), before.decision, 'the decision row is byte-identical');
        assert.equal(decisionRowOf(s.roots, s.decisionId)['state'], 'open');
        assert.deepEqual(dumpTables(s.roots), before.tables, 'only notification rows changed');
      } finally {
        s.close();
      }
    });
  }
});

describe('AUT-4 boundary: a digest time to the minute (12:30 local, and one minute either side)', () => {
  const cases: Array<{ time: string; next: { minute: number; nextDay: boolean } }> = [
    { time: '12:29', next: { minute: 12 * 60 + 30, nextDay: false } },
    { time: '12:30', next: { minute: 17 * 60 + 30, nextDay: false } },
    { time: '12:31', next: { minute: 17 * 60 + 30, nextDay: false } },
  ];
  for (const c of cases) {
    it(`at ${c.time} the digest posts nothing, fails and is recorded, and only notification rows change (the next digest time is ${c.next.minute === 750 ? '12:30' : '17:30'})`, async () => {
      const [hours, minutes] = c.time.split(':').map(Number) as [number, number];
      const clock = new SteppedClock(new Date(2026, 10, 10, hours, minutes, 0, 0).getTime());
      const s = seeded(clock, (ms) => void (clock.now += ms));
      try {
        assert.deepEqual(nextDigestAt(hours * 60 + minutes, DIGEST_TIMES), c.next, 'the schedule rule at this minute');
        const before = { decision: decisionRowOf(s.roots, s.decisionId), tables: dumpTables(s.roots) };
        const digest = await runDigest(s.deps, clock.nowMs());
        assert.ok(digest.ok, JSON.stringify(digest));
        assert.deepEqual([digest.value.posted, digest.value.result, digest.value.decisions], [false, 'failed', 1]);
        assert.deepEqual(noticesOf(s.roots), [{ kind: 'digest', state: 'failed', attempts: 3, last_error: 'osascript-failed' }]);
        assert.deepEqual(decisionRowOf(s.roots, s.decisionId), before.decision, 'the decision row is byte-identical');
        assert.deepEqual(dumpTables(s.roots), before.tables, 'only notification rows changed');
      } finally {
        s.close();
      }
    });
  }
});
