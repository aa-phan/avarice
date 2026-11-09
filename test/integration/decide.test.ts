// `avarice decide` (plan 03-20; D-13 to D-17, AUT-4, AUT-5, S-17, SC3). The four-item scenario of plan 03-18 is run through the real CLI with the fake run host until B
// asks and the run is blocked; the command then runs in this process through main() on a terminal that is a stream claiming to be one. When a
// supervisor has to start, it is the real detached `supervise` of the test CLI (the entry is swapped for the duration of the call, as the shell's
// supervisor test does). Every write is observed with raw SQL on the ledger. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/fault-run.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import { itemStatesOf, runIdOfOutput, runRowOf, s17Fixture, s17Host, unitOf } from '../helpers/independent-work.ts';
import type { S17Fixture } from '../helpers/independent-work.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
// A shell, a login and launchd: a person at a terminal.
const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts decide'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);

interface Started {
  f: S17Fixture;
  runId: string;
  decisionId: string;
}

// `start --brief ... --wait` through the test CLI: the detached supervisor runs the scenario and stops with B blocked on its question.
function startBlocked(): Started {
  const f = s17Fixture(cleanup);
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: s17Host() }) },
    timeoutMs: 300_000,
  });
  assert.equal(result.code, 3, result.stdout + result.stderr);
  const runId = runIdOfOutput(result.stdout);
  const decisionId = (ledgerRows<{ decision_id: string }>(f.roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId)[0] as { decision_id: string }).decision_id;
  return { f, runId, decisionId };
}

function withDeps<T>(roots: CliRoots, body: (deps: AppDeps) => T): T {
  const composed = createDeps(profileEnv(roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    return body(composed.value.deps);
  } finally {
    composed.value.close();
  }
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

interface Ran {
  code: number;
  out: string;
  err: string;
}

interface DecideOptions {
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  ancestry?: () => Result<ProcessEntry[]>;
  columns?: number;
}

// `avarice decide <argv>` in this process, on a terminal.
async function decide(roots: CliRoots, argv: readonly string[], options: DecideOptions = {}): Promise<Ran> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true, ...(options.columns !== undefined ? { columns: options.columns } : {}) });
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['decide', ...argv], {
    env: { ...profileEnv(roots), ...options.env },
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: options.ancestry ?? CALM_CHAIN,
  });
  return { code, out: out.join(''), err: err.join('') };
}

interface DecisionOut {
  state: string;
  answer: string | null;
  answered_by: string | null;
  answer_channel: string | null;
}

const decisionRow = (roots: CliRoots, decisionId: string): DecisionOut =>
  ledgerRows<DecisionOut>(roots, 'SELECT state, answer, answered_by, answer_channel FROM decisions WHERE decision_id = ?', decisionId)[0] as DecisionOut;

const stepsOf = (roots: CliRoots, runId: string, step: string): Array<{ result_json: string }> =>
  ledgerRows<{ result_json: string }>(roots, 'SELECT result_json FROM run_steps WHERE run_id = ? AND step = ? ORDER BY rowid', runId, step);

describe('decide: a valid answer on the S-17 blocked run answers, starts the supervisor and the run reaches ready_for_review (tracer)', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;

  it('prints the answer and the supervisor start, records the owner and the terminal, and the run finishes with B answered', async () => {
    assert.deepEqual([runRowOf(f.roots, runId).state, runRowOf(f.roots, runId).lease_holder], ['blocked_on_decision', null]);
    const r = await withSupervisorEntry(s17Host({ question: undefined }), () => decide(f.roots, [decisionId, '1', '--wait']));
    assert.equal(r.code, 0, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.includes(`decision ${decisionId} answered (1)`), r.out);
    assert.ok(lines.includes(`run ${runId}: supervisor started`), r.out);
    assert.ok(lines.indexOf(`decision ${decisionId} answered (1)`) < lines.indexOf(`run ${runId}: supervisor started`), 'the answer comes first');

    const row = decisionRow(f.roots, decisionId);
    assert.deepEqual([row.state, row.answer, row.answered_by, row.answer_channel], ['answered', '1', `owner:${userInfo().username}`, 'terminal']);
    assert.equal(runRowOf(f.roots, runId).state, 'ready_for_review');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
    const spawned = stepsOf(f.roots, runId, 'supervisor:decide');
    assert.equal(spawned.length, 1, 'one supervisor was started by decide');
    assert.ok(Number.isInteger((JSON.parse((spawned[0] as { result_json: string }).result_json) as { pid: number }).pid));
  });
});

describe('decide: a live supervisor holds the lease, so the answer starts nothing and the scheduler takes the item next (D-16)', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;

  it('answers, prints that the running supervisor takes item B next, records no supervisor step and leaves the run to the lease holder', async () => {
    withDeps(f.roots, (deps) => {
      const lease = deps.ledger.acquireRunLease(runId, 'another-supervisor', 600_000, Date.now());
      assert.ok(lease.ok, JSON.stringify(lease));
    });
    const r = await decide(f.roots, [decisionId, '1']);
    assert.equal(r.code, 0, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.includes(`decision ${decisionId} answered (1)`), r.out);
    assert.ok(lines.includes(`run ${runId}: a running supervisor takes item B next`), r.out);
    assert.equal(stepsOf(f.roots, runId, 'supervisor:decide').length, 0, 'no process was started');
    assert.equal(decisionRow(f.roots, decisionId).state, 'answered');
    assert.deepEqual(
      itemStatesOf(f.roots, runId).map((x) => x.join(':')),
      ['A:done', 'B:ready', 'C:done', 'D:ready'],
      'the answer released B, and nothing ran',
    );
    assert.equal(runRowOf(f.roots, runId).lease_holder, 'another-supervisor');
  });
});

// unitOf is used by the later suites of this file.
void unitOf;
