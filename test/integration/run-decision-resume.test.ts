// `claude -p --resume` for an answered item (plan 03-22; D-08, D-16, AUT-3, AUT-5, AUT-12, S-17, SC3). The four-item scenario of plan 03-18 is run through the real CLI
// with the fake run host until B asks and the run is blocked; `decide` then answers on a terminal that is a stream claiming to be one, and the detached supervisor it
// starts unparks B's delta, resumes B's own session with the answer, and finishes the run. The fallbacks (a session the host does not know, a resume that crashes, a
// parked path another item changed, a spent invocations budget) run in this process so the host's calls can be read. The fake run host plays the units; git, the
// ledger, the gates and the supervisor commit are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_ANSWER_DATA_LINE } from '../../src/app/run-gsd-config.ts';
import { main } from '../../src/cli/main.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
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
function startBlocked(host: FakeRunOptions = s17Host()): Blocked {
  const f = s17Fixture(cleanup);
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
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
