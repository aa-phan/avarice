// The three exit runs of Phase 3 (D-03), offline, before any live spend (D-04; plan 03-26; AUT-3, AUT-4, AUT-5, AUT-12; SC1 to SC3). Each run is the four-item
// scenario of plan 03-18 (A, B depends on A, C independent, D depends on B; the unit of B stops to ask) driven through the real CLI with the fake run host and
// the real supervisor, ledger, gates, git and notifier adapter:
//
//   run 1  B blocks, C and A complete, `decide <id> 1` resumes B's own session with the answer, and the run reaches ready_for_review with every item committed.
//   run 2  an amendment lands between the question and the answer: `decide` exits 3 and names the re-opened decision, and a second answer finishes the run.
//   run 3  a failing osascript path, a passed batch window and a passed digest time leave the decision open and visible, and an answer finishes the run.
//
// The fake run host plays the units and osascript is a script that exits 1, so no test calls a model or posts a banner.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { reconcileRun } from '../../src/app/run-resume.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { runDigest } from '../../src/app/digest.ts';
import { flushDueNotifications, notifyRunStop } from '../../src/app/notify.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { nextDigestAt } from '../../src/domain/notify-policy.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import { MovableClock, decideMain, resumedHost, runMain, startBlocked, withSupervisorEntry, writeProfileConfig } from '../helpers/decide-cli.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, parkRefOf, runRowOf, s17Fixture, s17Host } from '../helpers/independent-work.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const ALL_COMMITS = ['Collapse repeated dashes', 'Add a helper module', 'Map a status code', 'Cover the status mapper with a test'];

interface Recorded {
  prompt: string;
  resumeSessionId?: string;
  observed: Record<string, string | null>;
}

const launchSteps = (roots: CliRoots, runId: string): Array<{ itemId: string; sessionId: string; answeredDecisionId?: string }> =>
  ledgerRows<{ result_json: string }>(roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map(
    (r) => JSON.parse(r.result_json) as { itemId: string; sessionId: string; answeredDecisionId?: string },
  );

describe('D-03 run 1: B blocks, independent work completes, `decide` resumes B\'s own session and the run reaches ready_for_review (tracer)', () => {
  const b = startBlocked(cleanup);
  const { f, runId, decisionId, firstSession } = b;
  const recordB = join(f.roots.base, 'unit-B-resumed.json');

  it('is blocked on one open decision with A and C done, B parked and D waiting', () => {
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:blocked_on_decision', 'C:done', 'D:ready'],
    );
    assert.deepEqual([runRowOf(f.roots, runId).state, runRowOf(f.roots, runId).reason], ['blocked_on_decision', 'decision']);
    assert.equal(decisionsOf(f.roots, runId).filter((d) => d.state === 'open').length, 1);
    assert.notEqual(parkRefOf(runRowOf(f.roots, runId).workspace_path, runId, 'B'), null, 'B\'s delta is parked');
  });

  it('answers with option 1 and the supervisor it starts takes the run to ready_for_review with every item committed', async () => {
    const decided = await withSupervisorEntry(resumedHost(recordB), () => decideMain(f.roots, [decisionId, '1', '--wait']));
    assert.equal(decided.code, 0, decided.err + decided.out);
    assert.equal(runRowOf(f.roots, runId).state, 'ready_for_review');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
    assert.deepEqual(
      commitsOfRun(runRowOf(f.roots, runId).workspace_path, f.pin).map((c) => c.subject),
      ALL_COMMITS,
      'A, C, B and D each committed once, in that order',
    );
    assert.deepEqual(
      decisionsOf(f.roots, runId).map((d) => [d.state, d.answer]),
      [['answered', '1']],
      'one decision, answered with the key the owner typed',
    );
  });

  it('resumed the session B first ran under (from the ledger), with the answer carried as data, and B\'s own attempt has the reason resume', () => {
    const request = JSON.parse(readFileSync(recordB, 'utf8')) as Recorded;
    assert.equal(request.resumeSessionId, firstSession, 'resumeSessionId is the session recorded on the work item');
    assert.ok(request.prompt.includes('1. 404'), "the owner's choice by its label");
    assert.equal(request.observed['src/status.ts'], 'export const status = 410;\n', 'the parked file was back in the clone when the resumed unit began');
    const resumed = launchSteps(f.roots, runId).filter((l) => l.itemId === 'B' && l.answeredDecisionId === decisionId);
    assert.equal(resumed.length, 1, 'one resumed launch of B');
    assert.equal(resumed[0]?.sessionId, firstSession);
    assert.deepEqual(
      attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['C', 'initial'],
        ['B', 'resume'],
        ['D', 'initial'],
      ],
    );
  });
});

describe('D-03 run 2: an amendment between the question and the answer re-opens the decision, and a second answer finishes the run', () => {
  const b = startBlocked(cleanup);
  const { f, runId, decisionId } = b;
  const recordB = join(f.roots.base, 'unit-B-resumed-2.json');
  let successor = '';

  it('records contract version 2 for an add-write amendment and appends the stale gate rows', async () => {
    const amended = await runMain(f.roots, ['contract', 'amend', runId, '--add-write', 'test/extra.test.ts', '--reason', 'tests live in test/'], { answers: ['y'] });
    assert.equal(amended.code, 0, amended.err + amended.out);
    assert.match(amended.out, /contract v2 recorded/);
    const contracts = ledgerRows<{ version: number; authorized_by: string }>(f.roots, 'SELECT version, authorized_by FROM contracts WHERE run_id = ? ORDER BY version', runId);
    assert.deepEqual(contracts.map((c) => c.version), [1, 2]);
    assert.equal(contracts[1]?.authorized_by, `owner:${userInfo().username}`, 'version 2 is the owner\'s');
    const stale = ledgerRows<{ gate: string; contract_version: number; passed: number; failures_json: string }>(
      f.roots,
      "SELECT gate, contract_version, passed, failures_json FROM gate_results WHERE run_id = ? AND failures_json LIKE '%stale-after-amendment%' ORDER BY rowid",
      runId,
    );
    assert.ok(stale.length >= 1, 'the amendment left stale gate rows');
    assert.ok(stale.every((g) => g.contract_version === 2 && g.passed === 0), 'they are rows of version 2 that did not pass');
    assert.equal(runRowOf(f.roots, runId).state, 'blocked_on_decision', 'an amendment does not move the run');
  });

  it('exits 3 on the answer to the old decision, names the re-opened one, applies nothing and starts no supervisor', async () => {
    const stepsBefore = ledgerRows(f.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'supervisor:decide'", runId).length;
    const r = await decideMain(f.roots, [decisionId, '1']);
    assert.equal(r.code, 3, r.err + r.out);
    const [old, ...rest] = decisionsOf(f.roots, runId);
    assert.deepEqual([old?.decision_id, old?.state, old?.answer], [decisionId, 'stale', '1']);
    assert.equal(rest.length, 1, 'one successor');
    const next = rest[0] as NonNullable<typeof old>;
    successor = next.decision_id;
    assert.equal(next.state, 'open');
    assert.equal(next.contract_version, 2);
    assert.ok(r.out.includes(successor), 'the output names the decision to answer now');
    assert.equal(runRowOf(f.roots, runId).state, 'blocked_on_decision');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:blocked_on_decision', 'C:done', 'D:ready'],
      'the stale answer released nothing',
    );
    assert.equal(ledgerRows(f.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'supervisor:decide'", runId).length, stepsBefore, 'no supervisor was started');
  });

  it('answers the successor and the supervisor it starts finishes the run: one stale decision and one answered successor, every item done', async () => {
    const decided = await withSupervisorEntry(resumedHost(recordB), () => decideMain(f.roots, [successor, '1', '--wait']));
    assert.equal(decided.code, 0, decided.err + decided.out);
    assert.equal(runRowOf(f.roots, runId).state, 'ready_for_review');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
    assert.deepEqual(
      decisionsOf(f.roots, runId).map((d) => [d.decision_id === decisionId ? 'old' : 'new', d.state, d.answer]),
      [
        ['old', 'stale', '1'],
        ['new', 'answered', '1'],
      ],
    );
    assert.deepEqual(
      commitsOfRun(runRowOf(f.roots, runId).workspace_path, f.pin).map((c) => c.subject),
      ALL_COMMITS,
    );
    const request = JSON.parse(readFileSync(recordB, 'utf8')) as Recorded;
    assert.equal(request.resumeSessionId, b.firstSession, 'B resumed its own first session after the amendment');
  });
});

// The notifier of run 3 is the real osascript adapter pointed at a script that exits 1, and the clock is one the test moves, so the batch window and the digest
// time pass without the test waiting. The delivery attempts wait through the injected sleep, which moves the same clock.
function withFastSleep(deps: AppDeps, clock: MovableClock): AppDeps {
  assert.ok(deps.notify !== undefined, 'the composition has a notifier');
  return { ...deps, notify: { ...deps.notify, sleep: (ms: number) => Promise.resolve(clock.advance(ms)) } };
}

// The next local digest time after `nowMs` (12:30 or 17:30), as a millisecond instant.
function nextDigestInstant(nowMs: number, times: readonly string[]): number {
  const now = new Date(nowMs);
  const next = nextDigestAt(now.getHours() * 60 + now.getMinutes(), times);
  assert.ok(next !== null, 'a digest time is set');
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (next.nextDay ? 1 : 0), Math.floor(next.minute / 60), next.minute % 60, 0, 0).getTime();
}

describe('D-03 run 3: a failing notifier, a passed batch window and a passed digest time leave the decision open and visible; an answer finishes the run', () => {
  const f = s17Fixture(cleanup);
  const logDir = mkdtempSync(join(tmpdir(), 'avarice-exit-run3-'));
  cleanup.push(logDir);
  const log = join(logDir, 'osascript.log');
  const failing = join(logDir, 'osascript-fails.sh');
  writeFileSync(failing, `#!/bin/sh\necho "$#" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  writeProfileConfig(f.roots, { notify: { batchWindowMinutes: 1, local: { osascriptPath: failing } } });
  const clock = new MovableClock();
  const composed = createDeps(profileEnv(f.roots), { host: new FakeRunHost(s17Host()), clock });
  assert.ok(composed.ok, 'composition');
  const deps = withFastSleep(composed.value.deps, clock);
  let runId = '';
  let decisionId = '';

  it('blocks the run on B, and every delivery attempt of the banner fails and is recorded on the notice rows', async () => {
    const started = startRun(deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    runId = started.value.runId;
    const outcome = await runSupervisor(deps, runId, { prelude: reconcileRun });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.deepEqual([outcome.value.state, outcome.value.reason], ['blocked_on_decision', 'decision']);
    const raised = await notifyRunStop(deps, runId, { state: outcome.value.state, reason: outcome.value.reason });
    assert.ok(raised.ok, JSON.stringify(raised));
    decisionId = (decisionsOf(f.roots, runId).find((d) => d.state === 'open') as { decision_id: string }).decision_id;

    const notices = ledgerRows<{ state: string; attempts: number; last_error: string | null }>(f.roots, "SELECT state, attempts, last_error FROM notifications WHERE kind = 'decisions'");
    assert.ok(notices.length >= 1);
    for (const n of notices) assert.deepEqual([n.state, n.attempts, n.last_error], ['failed', 3, 'osascript-failed'], 'three attempts, each recorded, none delivered');
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 3 * notices.length, 'the script was called once per attempt');
  });

  it('moves the clock past the batch window and the next digest time: the flush finds nothing to resend and the digest fails and is recorded', async () => {
    const settings = deps.notify?.settings();
    assert.ok(settings?.ok);
    const digestAt = nextDigestInstant(clock.nowMs(), settings.value.digestTimes);
    clock.setTo(digestAt);
    const flushed = await flushDueNotifications(deps, runId);
    assert.ok(flushed.ok, JSON.stringify(flushed));
    assert.equal(flushed.value.result, 'none', 'a failed row is final: the batch flush does not resend it');
    const digest = await runDigest(deps, clock.nowMs());
    assert.ok(digest.ok, JSON.stringify(digest));
    assert.deepEqual([digest.value.posted, digest.value.result, digest.value.decisions], [false, 'failed', 1]);
    assert.deepEqual(
      ledgerRows<{ state: string; attempts: number }>(f.roots, "SELECT state, attempts FROM notifications WHERE kind = 'digest'"),
      [{ state: 'failed', attempts: 3 }],
    );
    // A banner, a retry, a passed window and a passed digest time answered nothing.
    const row = ledgerRows<{ state: string; answered_at: string | null; answered_by: string | null; answer: string | null; answer_channel: string | null }>(
      f.roots,
      'SELECT state, answered_at, answered_by, answer, answer_channel FROM decisions WHERE decision_id = ?',
      decisionId,
    )[0];
    assert.deepEqual(row, { state: 'open', answered_at: null, answered_by: null, answer: null, answer_channel: null });
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:blocked_on_decision', 'C:done', 'D:ready'],
    );
  });

  it('shows the decision open with a failed notification in `inbox --json` and `status --json`', async () => {
    const inbox = await runMain(f.roots, ['inbox', '--json'], { clock });
    assert.equal(inbox.code, 0, inbox.err);
    const view = JSON.parse(inbox.out) as { decisions: Array<{ decisionId: string; notification?: { state: string; attempts: number; lastError?: string } }> };
    const listed = view.decisions.find((d) => d.decisionId === decisionId);
    assert.ok(listed !== undefined, 'the inbox lists the decision');
    assert.equal(listed.notification?.state, 'failed');
    assert.equal(listed.notification?.lastError, 'osascript-failed');

    const status = await runMain(f.roots, ['status', '--json'], { clock });
    assert.equal(status.code, 0, status.err);
    const projects = JSON.parse(status.out) as Array<{ runs?: Array<{ runId: string; state: string; openDecisions: number; decisions?: Array<{ decisionId: string; state: string }>; notifications?: { failed: number; delivered: number } }> }>;
    const shown = projects.flatMap((p) => p.runs ?? []).find((r) => r.runId === runId);
    assert.ok(shown !== undefined, 'status lists the run');
    assert.equal(shown.state, 'blocked_on_decision');
    assert.equal(shown.openDecisions, 1);
    assert.deepEqual(shown.decisions?.find((d) => d.decisionId === decisionId)?.state, 'open');
    assert.ok((shown.notifications?.failed ?? 0) >= 1 && shown.notifications?.delivered === 0, JSON.stringify(shown.notifications));
  });

  it('answers with option 1 and the supervisor it starts finishes the run', async () => {
    composed.value.close();
    const recordB = join(f.roots.base, 'unit-B-resumed-3.json');
    const decided = await withSupervisorEntry(resumedHost(recordB), () => decideMain(f.roots, [decisionId, '1', '--wait']));
    assert.equal(decided.code, 0, decided.err + decided.out);
    assert.equal(runRowOf(f.roots, runId).state, 'ready_for_review');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
    assert.deepEqual(
      commitsOfRun(runRowOf(f.roots, runId).workspace_path, f.pin).map((c) => c.subject),
      ALL_COMMITS,
    );
    const answered = decisionsOf(f.roots, runId).find((d) => d.decision_id === decisionId);
    assert.deepEqual([answered?.state, answered?.answer], ['answered', '1']);
  });
});
