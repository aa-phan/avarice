// Item-local decisions with independent work continuing (plan 03-18; D-09, D-16, AUT-1 to AUT-4, S-17). Four items: A, B (depends on A), C (independent) and D
// (depends on B). The unit of B stops to ask. B alone is parked and blocked on one decision; C, which does not depend on B, is completed with its own evidence
// and commit; D, which does, never starts; and the run is visibly blocked with one batched banner. An answer starts the run again and the answered item runs as
// a fresh unit that carries it. The fake run host plays the units; git, the checks, the ledger, the gates, the commits and the supervisor are real. No test
// calls a real model, and osascript is a fake script, so no test posts a real banner.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { reconcileRun } from '../../src/app/run-resume.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import type { RunSupervisorOptions } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { RUN_ANSWER_DATA_LINE } from '../../src/app/run-gsd-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { optionsOf } from '../../src/domain/decision-policy.ts';
import { computeStateDigest } from '../../src/domain/state-digest.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import type { Notifier } from '../../src/ports/notifier.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { REPO_ROOT, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/fault-run.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import {
  S17_QUESTION,
  attemptsOfRun,
  commitsOfRun,
  decisionsOf,
  existsInClone,
  headHas,
  itemStatesOf,
  parkRefOf,
  runIdOfOutput,
  runRowOf,
  s17Fixture,
  s17Host,
  unitOf,
} from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The profile config is hand-edited JSON; resolveProfile leaves an existing file alone.
function writeProfileConfig(roots: CliRoots, extra: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: roots.AVARICE_DATA_ROOT, workRoot: roots.AVARICE_WORK_ROOT, ...extra }, null, 2)}\n`, { mode: 0o600 });
}

async function until<T>(what: string, read: () => T | undefined, limitMs = 30_000): Promise<T> {
  const end = Date.now() + limitMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const SILENT: Notifier = {
  descriptor: { port: 'notifier', adapter: 'test-silent', version: '0.0.0', capabilities: {}, offline: true },
  deliver: () => Promise.resolve({ ok: true, value: undefined }),
};

interface Started {
  f: S17Fixture;
  runId: string;
  log: string;
  code: number | null;
  stdout: string;
}

// `start --brief ... --wait` through the test CLI: the detached supervisor runs the scenario, and its banner goes through the fake osascript.
function startS17(host: FakeRunOptions = s17Host()): Started {
  const f = s17Fixture(cleanup);
  const logDir = mkdtempSync(join(tmpdir(), 'avarice-independent-work-'));
  cleanup.push(logDir);
  const log = join(logDir, 'osascript.log');
  chmodSync(FAKE_OSASCRIPT, 0o755);
  writeProfileConfig(f.roots, { notify: { local: { osascriptPath: FAKE_OSASCRIPT } } });
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: host }), AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: log },
    timeoutMs: 300_000,
  });
  return { f, runId: runIdOfOutput(result.stdout), log, code: result.code, stdout: result.stdout };
}

// The ledger and the host of a profile in this process, for the steps a test drives itself (an answer, a supervisor on a blocked run).
function inProcess(roots: CliRoots, run: FakeRunOptions): { host: FakeRunHost; deps: AppDeps; close: () => void } {
  const host = new FakeRunHost(run);
  const composed = createDeps(profileEnv(roots), { host, notifier: SILENT });
  assert.ok(composed.ok, 'composition');
  return { host, deps: composed.value.deps, close: composed.value.close };
}

function answer(deps: AppDeps, runId: string, decisionId: string, text: string): void {
  const answered = deps.ledger.answerDecision({ runId, decisionId, answer: text, answeredBy: 'owner', channel: 'terminal', expectContractVersion: 1, nowMs: Date.now() });
  assert.ok(answered.ok, JSON.stringify(answered));
}

interface Transition {
  from: string;
  to: string;
  nextAction: string;
  reason?: string;
  decisionIds?: string[];
  undelivered?: string[];
  withdrawn?: string[];
  resumedFrom?: string;
}
const transitionsOf = (roots: CliRoots, runId: string): Transition[] =>
  ledgerRows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId).map((e) => JSON.parse(e.data_json) as Transition);

const openDecisionId = (roots: CliRoots, runId: string): string => (decisionsOf(roots, runId).find((d) => d.state === 'open') as { decision_id: string }).decision_id;

describe('S-17 offline: B pauses, C completes with evidence, D waits, the run blocks with one banner (tracer)', () => {
  const s = startS17();
  const { f, runId } = s;
  const clone = (): string => runRowOf(f.roots, runId).workspace_path;

  it('ends blocked_on_decision (decision), exit 3, with A and C done, B blocked and D never started', () => {
    assert.equal(s.code, 3, s.stdout);
    const run = runRowOf(f.roots, runId);
    assert.deepEqual([run.state, run.reason], ['blocked_on_decision', 'decision']);
    assert.deepEqual(itemStatesOf(f.roots, runId), [
      ['A', 'done'],
      ['B', 'blocked_on_decision'],
      ['C', 'done'],
      ['D', 'ready'],
    ]);
    assert.deepEqual(
      attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.reason, a.outcome]),
      [
        ['A', 'initial', 'committed'],
        ['B', 'initial', 'blocked:decision'],
        ['C', 'initial', 'committed'],
      ],
      'attempts exist for A, B and C only, none for D',
    );
  });

  it('opens one decision with the options, the consequences, B and its dependent D as affected items and the shared state digest', () => {
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 1, 'one decision');
    const d = decisions[0] as (typeof decisions)[number];
    assert.equal(d.state, 'open');
    assert.equal(d.class, 'acceptance');
    assert.deepEqual(
      optionsOf(JSON.parse(d.options_json)).map((o) => [o.key, o.label, o.kind]),
      [
        ['1', '404', 'choice'],
        ['2', '410', 'choice'],
      ],
    );
    const consequences = JSON.parse(d.consequences_json) as Record<string, string>;
    assert.deepEqual(Object.keys(consequences).sort(), ['1', '2']);
    assert.match(consequences['1'] as string, /item B resumes with this answer/);
    assert.deepEqual(JSON.parse(d.affected_items_json), ['B', 'D']);
    assert.equal(d.issue, S17_QUESTION, 'the question is stored as the issue');
    const contract = ledgerRows<{ body_json: string; version: number }>(f.roots, 'SELECT body_json, version FROM contracts WHERE run_id = ?', runId)[0] as { body_json: string; version: number };
    const body = JSON.parse(contract.body_json) as RunContract;
    assert.equal(
      d.state_digest,
      computeStateDigest({
        contractVersion: contract.version,
        baseRevision: body.workspace.baseRevision,
        policyRevision: body.policyRevision,
        requirementRefs: body.intent.requirementRefs.map((ref) => ({ kind: ref.kind, revision: ref.revision, id: ref.id })),
      }),
      'the digest is the shared one',
    );
  });

  it('parked the delta of B: a park step names its paths, the ref exists in the clone, and B is in neither HEAD nor the working tree', () => {
    const steps = ledgerRows<{ result_json: string; status: string }>(f.roots, "SELECT result_json, status FROM run_steps WHERE run_id = ? AND step = 'park'", runId);
    assert.equal(steps.length, 1);
    const step = JSON.parse((steps[0] as (typeof steps)[number]).result_json) as { itemId: string; paths: string[]; ref: string };
    assert.equal((steps[0] as (typeof steps)[number]).status, 'completed');
    assert.equal(step.itemId, 'B');
    assert.ok(step.paths.includes('src/status.ts'), `the park names B's file: ${step.paths.join(', ')}`);
    assert.equal(step.ref, `refs/avarice/park/${runId}/B`);
    assert.notEqual(parkRefOf(clone(), runId, 'B'), null, 'the ref is in the clone');
    assert.equal(headHas(clone(), 'src/status.ts'), false);
    assert.equal(existsInClone(clone(), 'src/status.ts'), false);
  });

  it('committed A and C only, each with its own files: no commit touches B or D', () => {
    const commits = commitsOfRun(clone(), f.pin);
    assert.deepEqual(
      commits.map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module'],
    );
    assert.deepEqual(commits[0]?.files, ['src/slug.ts']);
    assert.deepEqual(commits[1]?.files, ['src/helper.ts']);
    assert.ok(!commits.some((c) => c.files.some((file) => file === 'src/status.ts' || file === 'src/status-test-helper.ts')));
  });

  it('judged C at G2 with passed check evidence of its own', () => {
    const gates = ledgerRows<{ work_item: string | null; passed: number }>(f.roots, "SELECT work_item, passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(
      gates.map((g) => [g.work_item, g.passed]),
      [
        ['A', 1],
        ['C', 1],
      ],
    );
    const checks = ledgerRows<{ work_item: string | null; status: string }>(
      f.roots,
      "SELECT e.work_item, e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.work_item = 'C'",
      runId,
    );
    assert.ok(checks.length > 0 && checks.every((c) => c.status === 'passed'), 'C has passed check evidence');
  });

  it('moves the run running -> running to B after A and to C when B blocked, then running -> blocked_on_decision after C with the open decision named', () => {
    const moves = transitionsOf(f.roots, runId).filter((m) => m.from === 'running');
    assert.deepEqual(
      moves.map((m) => `${m.from}>${m.to}`),
      ['running>running', 'running>running', 'running>blocked_on_decision'],
    );
    const last = moves.at(-1) as Transition;
    assert.equal(last.reason, 'decision');
    assert.deepEqual(last.decisionIds, [openDecisionId(f.roots, runId)]);
  });

  it('queued one decisions notice and raised one banner for it', async () => {
    await until('the banner to be delivered', () => (ledgerRows(f.roots, "SELECT 1 FROM notifications WHERE state = 'delivered'").length === 1 ? true : undefined));
    const rows = ledgerRows<{ kind: string; destination: string; subject_ids_json: string; state: string; attempts: number }>(f.roots, 'SELECT kind, destination, subject_ids_json, state, attempts FROM notifications');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]?.kind, rows[0]?.destination, rows[0]?.state, rows[0]?.attempts], ['decisions', 'local', 'delivered', 1]);
    assert.deepEqual(JSON.parse(rows[0]?.subject_ids_json as string), [openDecisionId(f.roots, runId)]);
    const lines = readFileSync(s.log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'exactly one delivery');
    assert.equal((JSON.parse(lines[0] as string) as string[]).at(-2), `${runId}: 1 decision waiting. Run: avarice inbox`);
  });
});

describe('two items that ask send one banner for both decisions (D-22, D-24)', () => {
  const host: FakeRunOptions = { perItem: { ...s17Host().perItem, C: unitOf('C', { question: 'Which helper name?\n1. helper\n2. util' }) } };
  const s = startS17(host);
  const { f, runId } = s;

  it('blocks B and C on a decision each, with D waiting behind B, and the run blocked on both', () => {
    assert.equal(s.code, 3, s.stdout);
    assert.deepEqual(itemStatesOf(f.roots, runId), [
      ['A', 'done'],
      ['B', 'blocked_on_decision'],
      ['C', 'blocked_on_decision'],
      ['D', 'ready'],
    ]);
    const decisions = decisionsOf(f.roots, runId);
    assert.deepEqual(
      decisions.map((d) => [d.state, JSON.parse(d.affected_items_json)]),
      [
        ['open', ['B', 'D']],
        ['open', ['C']],
      ],
    );
    assert.equal(attemptsOfRun(f.roots, runId).length, 3, 'D never started');
    const last = transitionsOf(f.roots, runId).at(-1) as Transition;
    assert.deepEqual([last.from, last.to, last.reason], ['running', 'blocked_on_decision', 'decision']);
    assert.deepEqual(last.decisionIds, decisions.map((d) => d.decision_id).sort());
  });

  it('raised one banner that counts both decisions, and every queued notice shows it delivered', async () => {
    await until('the banner to be delivered', () => (ledgerRows(f.roots, "SELECT 1 FROM notifications WHERE state = 'pending'").length === 0 ? true : undefined));
    const rows = ledgerRows<{ kind: string; state: string; attempts: number; subject_ids_json: string }>(f.roots, 'SELECT kind, state, attempts, subject_ids_json FROM notifications ORDER BY rowid');
    assert.equal(rows.length, 2, 'one notice queued for each decision');
    assert.ok(rows.every((r) => r.kind === 'decisions' && r.state === 'delivered' && r.attempts === 1));
    assert.deepEqual(
      rows.flatMap((r) => JSON.parse(r.subject_ids_json) as string[]).sort(),
      decisionsOf(f.roots, runId)
        .map((d) => d.decision_id)
        .sort(),
    );
    const lines = readFileSync(s.log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'one delivery for both');
    assert.equal((JSON.parse(lines[0] as string) as string[]).at(-2), `${runId}: 2 decisions waiting. Run: avarice inbox`);
  });
});

describe('a supervisor started on a blocked run (D-16)', () => {
  const s = startS17();
  const { f, runId } = s;

  it('returns at once when the decision is still open: no lease taken, nothing written', async () => {
    const eventsBefore = ledgerRows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM events')[0]?.n;
    const before = runRowOf(f.roots, runId);
    const live = inProcess(f.roots, s17Host());
    try {
      const outcome = await runSupervisor(live.deps, runId, { prelude: reconcileRun });
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.deepEqual([outcome.value.state, outcome.value.reason], ['blocked_on_decision', 'decision']);
    } finally {
      live.close();
    }
    const after = runRowOf(f.roots, runId);
    assert.equal(after.lease_holder, null, 'no lease is held');
    assert.equal(after.lease_fence, before.lease_fence, 'no lease was ever taken: the fence did not move');
    assert.equal(ledgerRows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM events')[0]?.n, eventsBefore, 'nothing was written');
    assert.equal(live.host.calls.length, 0, 'no unit was launched');
  });

  it('takes the run once the owner answered, moves it to running and finishes it: B runs again as a fresh unit with the answer, D after it, and the run reaches ready_for_review', async () => {
    const decisionId = openDecisionId(f.roots, runId);
    const recordB = join(f.roots.base, 'unit-B-again.json');
    const live = inProcess(f.roots, s17Host({ question: undefined, recordTo: recordB }));
    try {
      answer(live.deps, runId, decisionId, '2');
      assert.deepEqual(
        itemStatesOf(f.roots, runId).map((r) => r.join(':')),
        ['A:done', 'B:ready', 'C:done', 'D:ready'],
        'the answer released B and only B',
      );
      const outcome = await runSupervisor(live.deps, runId, { prelude: reconcileRun });
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'ready_for_review');
    } finally {
      live.close();
    }

    const moves = transitionsOf(f.roots, runId);
    const pickup = moves.find((m) => m.from === 'blocked_on_decision');
    assert.equal(pickup?.to, 'running');
    assert.equal(pickup?.resumedFrom, 'blocked_on_decision');
    assert.deepEqual(itemStatesOf(f.roots, runId).map((r) => r.join(':')), ['A:done', 'B:done', 'C:done', 'D:done']);

    // B ran a fresh unit (the reason `answer`), whose recorded prompt carries the question and the owner's answer as data; its park ref is gone.
    const attempts = attemptsOfRun(f.roots, runId);
    assert.deepEqual(
      attempts.map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['C', 'initial'],
        ['B', 'answer'],
        ['D', 'initial'],
      ],
    );
    const prompt = (JSON.parse(readFileSync(recordB, 'utf8')) as { prompt: string; resumeSessionId?: string }).prompt;
    assert.ok(prompt.includes(RUN_ANSWER_DATA_LINE), 'the fixed data line');
    assert.ok(prompt.includes('2. 410'), "the owner's choice by its label");
    assert.ok(prompt.includes('Which status code?'), 'the question the unit asked');
    assert.equal(parkRefOf(runRowOf(f.roots, runId).workspace_path, runId, 'B'), null, 'the park ref was dropped when the answered attempt started');

    // The decision is recorded on the launch step of that attempt, so it is used once.
    const launches = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY rowid", runId).map(
      (r) => JSON.parse(r.result_json) as { itemId: string; answeredDecisionId?: string },
    );
    assert.deepEqual(
      launches.map((l) => [l.itemId, l.answeredDecisionId]),
      [
        ['A', undefined],
        ['B', undefined],
        ['C', undefined],
        ['B', decisionId],
        ['D', undefined],
      ],
    );
    assert.deepEqual(
      commitsOfRun(runRowOf(f.roots, runId).workspace_path, f.pin).map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module', 'Map a status code', 'Cover the status mapper with a test'],
      'B is committed after C, D after B, each once',
    );
    assert.equal(runRowOf(f.roots, runId).lease_holder, null);
  });
});

describe('a withdrawn decision ends the run failed with the undelivered items named', () => {
  it('moves blocked_on_decision -> running -> failed, naming B and D', async () => {
    const s = startS17();
    const decisionId = openDecisionId(s.f.roots, s.runId);
    const live = inProcess(s.f.roots, s17Host());
    try {
      const withdrawn = live.deps.ledger.withdrawDecision({ runId: s.runId, decisionId, reason: 'owner', nowMs: Date.now() });
      assert.ok(withdrawn.ok, JSON.stringify(withdrawn));
      const outcome = await runSupervisor(live.deps, s.runId, { prelude: reconcileRun });
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'failed');
    } finally {
      live.close();
    }
    const moves = transitionsOf(s.f.roots, s.runId).filter((m) => m.from === 'blocked_on_decision' || m.to === 'failed');
    assert.deepEqual(
      moves.map((m) => `${m.from}>${m.to}`),
      ['blocked_on_decision>running', 'running>failed'],
    );
    assert.deepEqual(moves[1]?.undelivered, ['B', 'D']);
    assert.deepEqual(moves[1]?.withdrawn, [decisionId]);
    assert.deepEqual(
      itemStatesOf(s.f.roots, s.runId).map((r) => r.join(':')),
      ['A:done', 'B:blocked_on_decision', 'C:done', 'D:ready'],
    );
    assert.equal(attemptsOfRun(s.f.roots, s.runId).length, 3, 'no unit ran for the undelivered items');
  });
});

describe('block, release, re-check: an answer that lands after the release is not lost (research Pattern 2)', () => {
  it('re-acquires the lease in the same process and finishes the run, with a question asked before any work', async () => {
    const f = s17Fixture(cleanup);
    // B asks before it does anything (no edit, no record, no PLAN: the shape a live unit that must ask ends in); its second unit does the work.
    const host: FakeRunOptions = {
      perItem: { ...s17Host().perItem, B: { question: S17_QUESTION, perAttempt: [{}, { ...unitOf('B'), question: undefined }] } },
    };
    const live = inProcess(f.roots, host);
    try {
      const started = startRun(live.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const runId = started.value.runId;
      let released = 0;
      const options: RunSupervisorOptions = {
        afterRelease: () => {
          released += 1;
          // The window between the release of the lease and the re-check: the owner's answer lands here, as `decide` would write it.
          assert.equal(runRowOf(f.roots, runId).lease_holder, null, 'the lease is released in the window');
          answer(live.deps, runId, openDecisionId(f.roots, runId), '1');
        },
      };
      const outcome = await runSupervisor(live.deps, runId, options);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'ready_for_review');
      assert.equal(released, 1, 'the window was open once');
      assert.equal(runRowOf(f.roots, runId).lease_fence, 2, 'the lease was taken twice, by the same supervisor');
      assert.deepEqual(
        attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.reason]),
        [
          ['A', 'initial'],
          ['B', 'initial'],
          ['C', 'initial'],
          ['B', 'answer'],
          ['D', 'initial'],
        ],
      );
      // The question was asked before any work: nothing was parked but the records of the unit, and the answered unit's prompt carries the choice.
      const park = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'park'", runId);
      assert.equal(park.length, 1);
      assert.deepEqual((JSON.parse((park[0] as { result_json: string }).result_json) as { paths: string[] }).paths, []);
      const prompts = live.host.calls.map((c) => c.prompt);
      assert.ok(prompts.at(-2)?.includes('1. 404'), `the answered unit of B carries the choice: ${prompts.at(-2)?.slice(0, 80)}`);
    } finally {
      live.close();
    }
  });
});
