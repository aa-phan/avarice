// `claude -p --resume` for an answered item (plan 03-22; D-08, D-16, AUT-3, AUT-5, AUT-12, S-17, SC3). The four-item scenario of plan 03-18 is run through the real CLI
// with the fake run host until B asks and the run is blocked; `decide` then answers on a terminal that is a stream claiming to be one, and the detached supervisor it
// starts unparks B's delta, resumes B's own session with the answer, and finishes the run. The fallbacks (a session the host does not know, a resume that crashes, a
// parked path another item changed, a spent invocations budget) run in this process so the host's calls can be read. The fake run host plays the units; git, the
// ledger, the gates and the supervisor commit are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDeps } from '../../src/app/deps.ts';
import { reconcileRun } from '../../src/app/run-resume.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import { RUN_ANSWER_DATA_LINE } from '../../src/app/run-gsd-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { FakeRunHost, itemOfPrompt } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/fault-run.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, parkRefOf, runIdOfOutput, runRowOf, s17Fixture, s17Host, unitOf } from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';
import { git } from '../helpers/scratch-repo.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
// A shell, a login and launchd: a person at a terminal.
const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts decide'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);

interface Blocked {
  f: S17Fixture;
  runId: string;
  decisionId: string;
  // The session B's first unit ran under: the one a resume must name (D-08).
  firstSession: string;
}

// `start --brief ... --wait` through the test CLI: the detached supervisor runs the scenario and stops with B blocked on its question.
function startBlocked(host: FakeRunOptions = s17Host(), extraArgs: readonly string[] = []): Blocked {
  const f = s17Fixture(cleanup);
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', ...extraArgs, '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: host }) },
    timeoutMs: 300_000,
  });
  assert.equal(result.code, 3, result.stdout + result.stderr);
  const runId = runIdOfOutput(result.stdout);
  const decisionId = (ledgerRows<{ decision_id: string }>(f.roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId)[0] as { decision_id: string }).decision_id;
  const firstSession = (ledgerRows<{ gsd_session: string }>(f.roots, "SELECT gsd_session FROM work_items WHERE run_id = ? AND item_id = 'B'", runId)[0] as { gsd_session: string }).gsd_session;
  return { f, runId, decisionId, firstSession };
}

// The supervisor `decide` starts is spawned from the script that is running (process.argv[1]); inside a test that is the test runner, so for the
// duration of `body` the entry is the test CLI (production main() with the fake run host), and the host script travels in AVARICE_FAKE_HOST.
async function withSupervisorEntry<T>(host: FakeRunOptions, body: () => Promise<T>): Promise<T> {
  const saved = { argv1: process.argv[1], execArgv: process.execArgv, fake: process.env['AVARICE_FAKE_HOST'] };
  process.argv[1] = TEST_CLI;
  process.execArgv = ['--disable-warning=ExperimentalWarning'];
  process.env['AVARICE_FAKE_HOST'] = JSON.stringify({ run: host });
  try {
    return await body();
  } finally {
    process.argv[1] = saved.argv1 as string;
    process.execArgv = saved.execArgv;
    if (saved.fake === undefined) delete process.env['AVARICE_FAKE_HOST'];
    else process.env['AVARICE_FAKE_HOST'] = saved.fake;
  }
}

// `avarice decide <argv>` in this process, on a terminal.
async function decide(roots: CliRoots, argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const term = fakeTerminal({ inputIsTty: true, outputIsTty: true });
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['decide', ...argv], {
    env: profileEnv(roots),
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: CALM_CHAIN,
  });
  return { code, out: out.join(''), err: err.join('') };
}

// The host script of the resumed run: B's resumed call finishes the item (it edits the file B parked, so the parked content is read first) under its own quick
// directory, and records what it was asked and what it found in the clone.
function resumedHost(recordTo: string, extra: FakeRunOptions = {}): FakeRunOptions {
  const resumed: FakeRunOptions = {
    edits: { 'src/status.ts': 'export const status = 410;\nexport const resumed = true;\n' },
    summary: true,
    verification: 'passed',
    quickId: '261105-fk2-resume',
    recordTo,
    observe: ['src/status.ts'],
    ...extra,
  };
  return { perItem: { A: unitOf('A'), B: { ...unitOf('B'), resume: resumed }, C: unitOf('C'), D: unitOf('D') } };
}

interface Recorded {
  prompt: string;
  runId: string;
  sessionId: string;
  resumeSessionId?: string;
  observed: Record<string, string | null>;
}

const launchSteps = (roots: CliRoots, runId: string): Array<{ itemId: string; attemptId: string; sessionId: string; model: string; answeredDecisionId?: string }> =>
  ledgerRows<{ result_json: string }>(roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map(
    (r) => JSON.parse(r.result_json) as { itemId: string; attemptId: string; sessionId: string; model: string; answeredDecisionId?: string },
  );

describe('SC3 offline: decide answers, the supervisor unparks B and resumes B\'s own session with the answer, and the run finishes (tracer)', () => {
  const s = startBlocked();
  const { f, runId, decisionId, firstSession } = s;
  const recordB = join(f.roots.base, 'unit-B-resumed.json');
  let decided: { code: number; out: string; err: string };

  it('answers with option 2 and the supervisor it starts takes the run to ready_for_review with every item done', async () => {
    assert.match(firstSession, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'the work item carries the session B first ran under');
    decided = await withSupervisorEntry(resumedHost(recordB), () => decide(f.roots, [decisionId, '2', '--wait']));
    assert.equal(decided.code, 0, decided.err + decided.out);
    assert.equal(runRowOf(f.roots, runId).state, 'ready_for_review');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
  });

  it('resumed B\'s own first session (the one in work_items.gsd_session) with the answer as data and B\'s model', () => {
    const request = JSON.parse(readFileSync(recordB, 'utf8')) as Recorded;
    assert.equal(request.resumeSessionId, firstSession, 'the session ID comes from the ledger');
    assert.ok(request.prompt.includes('Work item B:'), 'the prompt names the item');
    assert.ok(request.prompt.includes(RUN_ANSWER_DATA_LINE), 'the answer sits under the fixed data line');
    assert.ok(request.prompt.includes('2. 410'), "the owner's choice by its label");

    const launches = launchSteps(f.roots, runId);
    const first = launches.find((l) => l.itemId === 'B' && l.answeredDecisionId === undefined) as (typeof launches)[number];
    const resumed = launches.find((l) => l.itemId === 'B' && l.answeredDecisionId === decisionId) as (typeof launches)[number];
    assert.equal(first.sessionId, firstSession, 'B first ran under that session');
    assert.equal(resumed.sessionId, firstSession, "the resumed launch:run step carries the resumed session ID, so a reap finds the host by it");
    assert.equal(resumed.model, first.model, "B's model");
  });

  it('showed the resumed unit B\'s parked file in the clone when it began', () => {
    const request = JSON.parse(readFileSync(recordB, 'utf8')) as Recorded;
    assert.equal(request.observed['src/status.ts'], 'export const status = 410;\n');
  });

  it('records the attempt of the resume with the reason resume, and runs no fresh unit of B', () => {
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
    assert.equal(decisionsOf(f.roots, runId).filter((d) => d.state === 'answered').length, 1);
  });

  it('judged and committed B like any unit: its one commit holds the parked and the resumed changes, D runs after it, and B\'s park ref is gone', () => {
    const clone = runRowOf(f.roots, runId).workspace_path;
    const commits = commitsOfRun(clone, f.pin);
    assert.deepEqual(
      commits.map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module', 'Map a status code', 'Cover the status mapper with a test'],
      'B is committed after C, D after B, each once',
    );
    assert.deepEqual(commits[2]?.files, ['src/status.ts']);
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), 'export const status = 410;\nexport const resumed = true;\n', 'the parked line and the resumed line are both in the file');
    const gates = ledgerRows<{ work_item: string | null; passed: number }>(f.roots, "SELECT work_item, passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(
      gates.map((g) => [g.work_item, g.passed]),
      [
        ['A', 1],
        ['C', 1],
        ['B', 1],
        ['D', 1],
      ],
    );
    assert.equal(parkRefOf(clone, runId, 'B'), null, 'the park ref was dropped after the commit');
  });
});

// ---- the fallbacks, in this process -----------------------------------------------------------------------------------------------------------
// The ledger and the host of a profile in this process, so a test answers the decision itself and reads every call the host got.

function inProcess(roots: CliRoots, run: FakeRunOptions): { host: FakeRunHost; deps: AppDeps; close: () => void } {
  const host = new FakeRunHost(run);
  const composed = createDeps(profileEnv(roots), { host });
  assert.ok(composed.ok, 'composition');
  return { host, deps: composed.value.deps, close: composed.value.close };
}

function answer(deps: AppDeps, runId: string, decisionId: string, text: string): void {
  const answered = deps.ledger.answerDecision({ runId, decisionId, answer: text, answeredBy: 'owner', channel: 'terminal', expectContractVersion: 1, nowMs: Date.now() });
  assert.ok(answered.ok, JSON.stringify(answered));
}

// Answers the open decision with option 2 and runs a supervisor on the blocked run in this process; returns the calls the host got and where the run ended.
async function answerAndRun(b: Blocked, host: FakeRunOptions): Promise<{ calls: FakeRunHost['calls']; state: string; reason: string | null }> {
  const live = inProcess(b.f.roots, host);
  try {
    answer(live.deps, b.runId, b.decisionId, '2');
    const outcome = await runSupervisor(live.deps, b.runId, { prelude: reconcileRun });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return { calls: [...live.host.calls], state: outcome.value.state, reason: outcome.value.reason ?? null };
  } finally {
    live.close();
  }
}

const callsOfB = (calls: FakeRunHost['calls']): FakeRunHost['calls'] => calls.filter((c) => itemOfPrompt(c.prompt) === 'B');

const stepResults = (roots: CliRoots, runId: string, step: string): Array<Record<string, unknown>> =>
  ledgerRows<{ result_json: string }>(roots, 'SELECT result_json FROM run_steps WHERE run_id = ? AND step = ? ORDER BY rowid', runId, step).map((r) => JSON.parse(r.result_json) as Record<string, unknown>);

const gsdSessionOfB = (roots: CliRoots, runId: string): string =>
  (ledgerRows<{ gsd_session: string }>(roots, "SELECT gsd_session FROM work_items WHERE run_id = ? AND item_id = 'B'", runId)[0] as { gsd_session: string }).gsd_session;

const invocationsUsed = (roots: CliRoots, runId: string): number | undefined => ledgerRows<{ used: number }>(roots, "SELECT used FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0]?.used;

const eventsOf = (roots: CliRoots, runId: string, type: string): Array<Record<string, unknown>> =>
  ledgerRows<{ data_json: string }>(roots, 'SELECT data_json FROM events WHERE run_id = ? AND type = ? ORDER BY seq', runId, type).map((e) => JSON.parse(e.data_json) as Record<string, unknown>);

const attemptRows = (roots: CliRoots, runId: string): Array<[string | null, string, string | null]> => attemptsOfRun(roots, runId).map((a) => [a.item_id, a.reason, a.outcome]);

// B's fresh call after a fallback: the first unit's file and records were parked and then taken out of the tree again, so it writes them anew.
const FRESH_B: FakeRunOptions = unitOf('B');
const STATUS_410 = 'export const status = 410;\n';

// The attempts of a run whose resume fell back: B's resume is discarded and the fresh unit that follows is an `answer` attempt.
const FALLBACK_ATTEMPTS: Array<[string, string, string]> = [
  ['A', 'initial', 'committed'],
  ['B', 'initial', 'blocked:decision'],
  ['C', 'initial', 'committed'],
  ['B', 'resume', 'discarded'],
  ['B', 'answer', 'committed'],
  ['D', 'initial', 'handed-off'],
];

describe('a session the host does not know: the item falls back to a fresh unit with the answer (spike S3-A)', () => {
  const b = startBlocked();

  it('ends the resumed call with the host\'s error result, discards to the item base, runs a fresh unit that carries the question and the answer, and finishes the run', async () => {
    const host: FakeRunOptions = { perItem: { A: unitOf('A'), B: { ...FRESH_B, resume: { missingSession: true } }, C: unitOf('C'), D: unitOf('D') } };
    const ran = await answerAndRun(b, host);
    assert.equal(ran.state, 'ready_for_review');

    const calls = callsOfB(ran.calls);
    assert.equal(calls.length, 2, 'the resumed call and the fresh one');
    assert.equal(calls[0]?.resumeSessionId, b.firstSession, 'the first call resumed the session of B');
    assert.equal(calls[1]?.resumeSessionId, undefined, 'the second is a fresh unit');
    assert.ok(calls[1]?.prompt.includes('Which status code?'), 'the fresh unit is told the question it asked');
    assert.ok(calls[1]?.prompt.includes('2. 410'), "and the owner's answer");
    assert.deepEqual(attemptRows(b.f.roots, b.runId), FALLBACK_ATTEMPTS);
    const fresh = gsdSessionOfB(b.f.roots, b.runId);
    assert.notEqual(fresh, b.firstSession, 'the work item carries the session of the fresh unit now');
    assert.equal(fresh, calls[1]?.sessionId);
    assert.deepEqual(
      stepResults(b.f.roots, b.runId, 'resume:fallback').map((r) => [r['itemId'], r['reason']]),
      [['B', 'session-gone']],
    );
    assert.equal(invocationsUsed(b.f.roots, b.runId), 6, 'both calls of B are charged: A, B, C, the resume, the fresh unit and D');
    const clone = runRowOf(b.f.roots, b.runId).workspace_path;
    assert.equal(parkRefOf(clone, b.runId, 'B'), null);
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), STATUS_410);
  });
});

describe('a resumed unit that crashes with no moved HEAD: the same fallback, and nothing the crash wrote stays', () => {
  const b = startBlocked();

  it("discards the unparked delta and the crash's partial write, runs a fresh unit, and charges both calls", async () => {
    const host: FakeRunOptions = { perItem: { A: unitOf('A'), B: { ...FRESH_B, resume: { crash: { afterFiles: ['src/status.ts'], costUsd: 0.05 } } }, C: unitOf('C'), D: unitOf('D') } };
    const ran = await answerAndRun(b, host);
    assert.equal(ran.state, 'ready_for_review');
    assert.equal(callsOfB(ran.calls).length, 2);
    assert.deepEqual(attemptRows(b.f.roots, b.runId), FALLBACK_ATTEMPTS);
    assert.deepEqual(
      stepResults(b.f.roots, b.runId, 'resume:fallback').map((r) => r['reason']),
      ['crashed'],
    );
    assert.equal(invocationsUsed(b.f.roots, b.runId), 6);
    const clone = runRowOf(b.f.roots, b.runId).workspace_path;
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), STATUS_410, 'the partial write of the crashed unit is not in the commit');
    assert.deepEqual(
      commitsOfRun(clone, b.f.pin).map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module', 'Map a status code', 'Cover the status mapper with a test'],
    );
  });
});

describe('another item committed a change to a path B parked: the delta is never written over it (T-03-43)', () => {
  // C commits its own file and also creates src/status.ts, the path B parked.
  const taken = 'export const status = 404;\n';
  const c: FakeRunOptions = { ...unitOf('C'), edits: { 'src/helper.ts': 'export const helper = 1;\n', 'src/status.ts': taken } };
  const b = startBlocked({ perItem: { ...s17Host().perItem, C: c } });

  it("records item.unpark_conflict with the count of paths, keeps the other item's content, runs B as a fresh unit from the current HEAD and drops the park ref", async () => {
    const clone = runRowOf(b.f.roots, b.runId).workspace_path;
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), taken, 'C committed src/status.ts before the answer');
    const host: FakeRunOptions = {
      perItem: { A: unitOf('A'), B: { edits: { 'src/status-b.ts': 'export const statusB = 410;\n' }, summary: true, verification: 'passed' }, C: unitOf('C'), D: unitOf('D') },
    };
    const ran = await answerAndRun(b, host);
    assert.equal(ran.state, 'ready_for_review');

    assert.deepEqual(eventsOf(b.f.roots, b.runId, 'item.unpark_conflict'), [{ runId: b.runId, itemId: 'B', paths: 1 }]);
    const calls = callsOfB(ran.calls);
    assert.equal(calls.length, 1, 'no call resumed the session: the conflict was found before the host was called');
    assert.equal(calls[0]?.resumeSessionId, undefined);
    assert.ok(calls[0]?.prompt.includes('2. 410'), 'the fresh unit carries the answer');
    assert.deepEqual(attemptRows(b.f.roots, b.runId), FALLBACK_ATTEMPTS);
    assert.equal(git(clone, ['show', 'HEAD:src/status.ts']), taken, "the other item's file is as it was committed: nothing was overwritten");
    assert.equal(git(clone, ['show', 'HEAD:src/status-b.ts']), 'export const statusB = 410;\n');
    assert.equal(parkRefOf(clone, b.runId, 'B'), null, 'the park ref was dropped');
    assert.deepEqual(
      stepResults(b.f.roots, b.runId, 'resume:fallback').map((r) => r['reason']),
      ['unpark-conflict'],
    );
    assert.equal(invocationsUsed(b.f.roots, b.runId), 5, 'only the fresh unit was charged for B');
  });
});

describe('the invocations budget spent before the fallback: the item blocks with a budget decision naming invocations', () => {
  // Four items allow 9 invocations; 4 leaves exactly A, B, C and the resume.
  const b = startBlocked(s17Host(), ['--budget', 'invocations=4']);

  it('does not run a fresh unit, and the run is blocked on a budget decision that names invocations', async () => {
    const host: FakeRunOptions = { perItem: { A: unitOf('A'), B: { ...FRESH_B, resume: { missingSession: true } }, C: unitOf('C'), D: unitOf('D') } };
    const ran = await answerAndRun(b, host);
    assert.deepEqual([ran.state, ran.reason], ['blocked_on_decision', 'budget_exhausted']);
    assert.equal(callsOfB(ran.calls).length, 1, 'only the resumed call ran');
    const open = decisionsOf(b.f.roots, b.runId).filter((d) => d.state === 'open');
    assert.equal(open.length, 1);
    assert.equal(open[0]?.class, 'budget');
    assert.match(open[0]?.issue ?? '', /invocations/);
  });
});
