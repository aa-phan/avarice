// `avarice decide` (plan 03-20; D-13 to D-17, AUT-4, AUT-5, S-17, SC3). The four-item scenario of plan 03-18 is run through the real CLI with the fake run host until B
// asks and the run is blocked; the command then runs in this process through main() on a terminal that is a stream claiming to be one. When a
// supervisor has to start, it is the real detached `supervise` of the test CLI (the entry is swapped for the duration of the call, as the shell's
// supervisor test does). Every write is observed with raw SQL on the ledger. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { AppDeps } from '../../src/app/deps.ts';
import { stateDigestOf } from '../../src/app/run-stages/blocked.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { renderDecision } from '../../src/cli/render/decision-view.ts';
import type { DecisionRow } from '../../src/ports/ledger.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { err as portErr, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
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
  // The questions the command asked through the io, in order.
  questions: string[];
}

interface DecideOptions {
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  ancestry?: () => Result<ProcessEntry[]>;
  columns?: number;
  // The answers to the questions the command asks (the prompt and the amendment confirmation), in order. An exhausted list answers end of input.
  answers?: string[];
}

// `avarice decide <argv>` in this process, on a terminal.
async function decide(roots: CliRoots, argv: readonly string[], options: DecideOptions = {}): Promise<Ran> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true, ...(options.columns !== undefined ? { columns: options.columns } : {}) });
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const answers = [...(options.answers ?? [])];
  const code = await main(['decide', ...argv], {
    env: { ...profileEnv(roots), ...options.env },
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: options.ancestry ?? CALM_CHAIN,
    ...(options.answers !== undefined
      ? {
          ask: (question: string): Promise<string | undefined> => {
            questions.push(question);
            return Promise.resolve(answers.shift());
          },
        }
      : {}),
  });
  return { code, out: out.join(''), err: err.join(''), questions };
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

// ---- the response validation suite: every check of the D-15 order, end to end ------------------------------------------------------------------

interface Seed {
  class: string;
  issue?: string;
  options: unknown;
  consequences?: unknown;
  affectedItems: string[];
}

// Opens one more decision on a run in this process, stamped with the digest of the contract it is on now (what blockRun does when a unit asks).
function seedDecision(roots: CliRoots, runId: string, seed: Seed): string {
  return withDeps(roots, (deps) => {
    const contract = deps.ledger.getRunContract(runId);
    assert.ok(contract.ok && contract.value !== null, 'the run has a contract');
    const opened = deps.ledger.openDecision({
      runId,
      contractVersion: contract.value.version,
      class: seed.class,
      issue: seed.issue ?? 'a seeded question',
      options: seed.options,
      consequences: seed.consequences ?? {},
      evidenceRefs: ['check:test'],
      affectedItems: seed.affectedItems,
      stateDigest: stateDigestOf(contract.value.version, contract.value.body as RunContract),
      urgency: 'blocking',
      nowMs: Date.now(),
    });
    assert.ok(opened.ok, JSON.stringify(opened));
    return opened.value.decisionId;
  });
}

function holdLease(roots: CliRoots, runId: string): void {
  withDeps(roots, (deps) => {
    const lease = deps.ledger.acquireRunLease(runId, 'another-supervisor', 600_000, Date.now());
    assert.ok(lease.ok, JSON.stringify(lease));
  });
}

const eventsOf = (roots: CliRoots, runId: string, type: string): Array<Record<string, unknown>> =>
  ledgerRows<{ data_json: string }>(roots, 'SELECT data_json FROM events WHERE run_id = ? AND type = ? ORDER BY seq', runId, type).map((e) => JSON.parse(e.data_json) as Record<string, unknown>);

const eventCount = (roots: CliRoots): number => ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM events')[0]?.n ?? 0;

const storeDigest = (roots: CliRoots): string => {
  const hash = createHash('sha256');
  for (const name of ['state.db', 'state.db-wal']) {
    const path = join(roots.AVARICE_DATA_ROOT, name);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest('hex');
};

// A digest of every row of every table but the adapter descriptors. A command that opens the store read-write records the descriptors of its adapters,
// so the bytes of the file move when the store is merely opened; no decision, event, run, step or evidence row may.
const ledgerDigest = (roots: CliRoots): string => {
  const hash = createHash('sha256');
  const tables = ledgerRows<{ name: string }>(roots, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'adapter_configs' ORDER BY name");
  for (const { name } of tables) hash.update(`${name}:${JSON.stringify(ledgerRows(roots, `SELECT * FROM ${name} ORDER BY rowid`))}\n`);
  return hash.digest('hex');
};

const contractVersions = (roots: CliRoots, runId: string): number[] => ledgerRows<{ version: number }>(roots, 'SELECT version FROM contracts WHERE run_id = ? ORDER BY version', runId).map((r) => r.version);

interface FullDecision {
  decision_id: string;
  state: string;
  answer: string | null;
  answered_by: string | null;
  answer_channel: string | null;
  contract_version: number;
  state_digest: string;
  supersedes: string | null;
  options_json: string;
  issue: string;
  affected_items_json: string;
}

const fullDecision = (roots: CliRoots, decisionId: string): FullDecision =>
  ledgerRows<FullDecision>(roots, 'SELECT * FROM decisions WHERE decision_id = ?', decisionId)[0] as FullDecision;

// `contract amend` in this process with a scripted yes: the one way a contract version is written in a test.
async function amendBudget(roots: CliRoots, runId: string, costUsdPerRun: number): Promise<void> {
  const term = fakeTerminal({});
  const err: string[] = [];
  const code = await main(['contract', 'amend', runId, '--budget', `costUsdPerRun=${costUsdPerRun}`, '--reason', 'room to go on'], {
    env: profileEnv(roots),
    io: { out: () => undefined, err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: CALM_CHAIN,
    ask: () => Promise.resolve('y'),
  });
  assert.equal(code, 0, err.join(''));
}

const OPTIONS_12 = [
  { key: '1', label: '404', kind: 'choice' },
  { key: '2', label: '410', kind: 'choice' },
];
const TEXT_OPTION = [{ key: 'text', label: 'free text', kind: 'text' }];
const WITHDRAW_ONLY = [{ key: 'withdraw', label: 'withdraw', kind: 'withdraw' }];

// D-14, CS-11, T-03-38: the run does not answer its own question. The refusals sit in usage(), before the profile is resolved, so on a profile that was
// never created they leave no data root, no store file and no row, and on an existing store not one byte changes.
describe('decide: refused inside a run, off a terminal and from a run process tree (identity, D-14)', () => {
  const ARGV = ['dec_01ABCDEFGH', '1'];
  const INSIDE_A_RUN = (): Result<ProcessEntry[]> =>
    ok([entry(300, 250, 'bash'), entry(250, 200, 'claude --print'), entry(200, 1, 'node --disable-warning=ExperimentalWarning /opt/avarice/bin/avarice.ts supervise run_01ABC'), entry(1, 0, '/sbin/launchd')]);
  const cases: ReadonlyArray<{ name: string; options: DecideOptions; message: RegExp }> = [
    { name: 'AVARICE_RUN is set', options: { env: { AVARICE_RUN: 'run_01ABC' } }, message: /refused inside a run \(AVARICE_RUN is set\)/ },
    { name: 'standard input is not a terminal', options: { stdinIsTty: false }, message: /needs an interactive terminal/ },
    { name: 'standard output is not a terminal', options: { stdoutIsTty: false }, message: /needs an interactive terminal/ },
    { name: 'an ancestor is a run supervisor', options: { ancestry: INSIDE_A_RUN }, message: /refused from inside a run's process tree/ },
    {
      name: 'the process table cannot be read (fail closed)',
      options: { ancestry: () => portErr({ kind: 'unavailable', cause: 'ps is not allowed here' }) },
      message: /refused from inside a run's process tree/,
    },
  ];

  for (const c of cases) {
    it(`exits 64 naming the reason and creates no data root, store or row when ${c.name}`, async () => {
      const roots = makeRoots();
      cleanup.push(roots.base);
      const r = await decide(roots, ARGV, c.options);
      assert.equal(r.code, 64, r.err + r.out);
      assert.match(r.err, c.message);
      assert.equal(r.out, '');
      assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false, 'no data root');
      assert.equal(existsSync(roots.AVARICE_CONFIG_HOME), false, 'no config home');
    });
  }

  const s = startBlocked();
  it('leaves the store of a real blocked run byte for byte as it was, with a valid answer, in every one of those cases', async () => {
    const before = { digest: storeDigest(s.f.roots), events: eventCount(s.f.roots) };
    for (const c of cases) {
      const r = await decide(s.f.roots, [s.decisionId, '1'], c.options);
      assert.equal(r.code, 64, `${c.name}: ${r.err}`);
    }
    assert.equal(storeDigest(s.f.roots), before.digest, 'the store file is untouched');
    assert.equal(eventCount(s.f.roots), before.events, 'no event was appended');
    assert.equal(decisionRow(s.f.roots, s.decisionId).state, 'open');
    assert.deepEqual(stepsOf(s.f.roots, s.runId, 'supervisor:decide'), []);
  });
});

describe('decide: the checks of D-15 in their order, end to end', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;
  // A supervisor that someone else holds keeps decide from starting one, so the run stays as these answers leave it.
  holdLease(f.roots, runId);

  it('option: a key the record does not list is refused with exit 64 and recorded as decision.rejected with the check name only', async () => {
    const r = await decide(f.roots, [decisionId, '9']);
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /"9" is not one of the options \(1, 2\)/);
    const rejected = eventsOf(f.roots, runId, 'decision.rejected');
    assert.deepEqual(rejected, [{ runId, decisionId, check: 'option-not-listed' }]);
    assert.equal(decisionRow(f.roots, decisionId).state, 'open', 'nothing was applied');
  });

  it('option: --text on a record that lists its options is refused as free-text-not-allowed', async () => {
    const r = await decide(f.roots, [decisionId, '--text', 'whatever you think']);
    assert.equal(r.code, 64, r.err + r.out);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId, check: 'free-text-not-allowed' });
    assert.equal(decisionRow(f.roots, decisionId).state, 'open');
  });

  it('option: free text is taken where the record allows it, and 3000 characters of it are refused as text-invalid', async () => {
    const textId = seedDecision(f.roots, runId, { class: 'acceptance', options: TEXT_OPTION, affectedItems: ['C'] });
    const tooLong = await decide(f.roots, [textId, '--text', 'x'.repeat(3000)]);
    assert.equal(tooLong.code, 64, tooLong.err + tooLong.out);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId: textId, check: 'text-invalid' });
    assert.equal(decisionRow(f.roots, textId).state, 'open');

    const given = await decide(f.roots, [textId, '--text', 'use the util name']);
    assert.equal(given.code, 0, given.err + given.out);
    assert.match(given.out, new RegExp(`decision ${textId} answered \\(text\\)`));
    const row = decisionRow(f.roots, textId);
    assert.deepEqual([row.state, row.answer, row.answered_by, row.answer_channel], ['answered', 'use the util name', `owner:${userInfo().username}`, 'terminal']);
  });

  it('duplicate: an identical second answer is ignored and recorded; a different one is refused and recorded; the row does not change', async () => {
    const first = await decide(f.roots, [decisionId, '1']);
    assert.equal(first.code, 0, first.err + first.out);
    const answered = fullDecision(f.roots, decisionId);
    assert.deepEqual([answered.state, answered.answer], ['answered', '1']);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.answered').filter((e) => e['decisionId'] === decisionId).length, 1);

    const again = await decide(f.roots, [decisionId, '1']);
    assert.equal(again.code, 0, again.err + again.out);
    assert.match(again.out, /already answered; ignored/);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.duplicate'), [{ runId, decisionId }]);

    const different = await decide(f.roots, [decisionId, '2']);
    assert.equal(different.code, 3, different.err + different.out);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId, check: 'decision-answered' });
    assert.deepEqual(fullDecision(f.roots, decisionId), answered, 'the row is as the first answer left it');
    assert.equal(eventsOf(f.roots, runId, 'decision.answered').filter((e) => e['decisionId'] === decisionId).length, 1, 'one answer was ever applied');
  });

  it('open: a Phase 2 decision with no options is answered by withdraw only; once withdrawn, any answer exits 3 as decision-withdrawn', async () => {
    const legacy = seedDecision(f.roots, runId, { class: 'permission', options: [], affectedItems: ['C'] });
    const listed = await decide(f.roots, [legacy, '1']);
    assert.equal(listed.code, 64, listed.err + listed.out);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId: legacy, check: 'option-not-listed' });
    assert.equal(decisionRow(f.roots, legacy).state, 'open');

    const withdrawn = await decide(f.roots, [legacy, 'withdraw']);
    assert.equal(withdrawn.code, 0, withdrawn.err + withdrawn.out);
    assert.match(withdrawn.out, new RegExp(`decision ${legacy} withdrawn`));
    assert.equal(decisionRow(f.roots, legacy).state, 'withdrawn');

    const late = await decide(f.roots, [legacy, 'withdraw']);
    assert.equal(late.code, 3, late.err + late.out);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId: legacy, check: 'decision-withdrawn' });
    const lateKey = await decide(f.roots, [legacy, '1']);
    assert.equal(lateKey.code, 3, 'the state of the decision is looked at before the option');
  });

  it('a decision that is answered by an amendment: an option key records an amendment request, prints the amend command from the record and applies nothing', async () => {
    const command = 'avarice contract amend RUN --decision <decision-id> --reason "<why>" --add-write \'src/extra.ts\'';
    const wide = seedDecision(f.roots, runId, {
      class: 'scope_expansion',
      options: WITHDRAW_ONLY,
      consequences: { withdraw: 'the decision closes', amend: { command: command.replace('RUN', runId), request: { addWrite: ['src/extra.ts'] } } },
      affectedItems: ['C'],
    });
    const versions = contractVersions(f.roots, runId);
    const r = await decide(f.roots, [wide, '1']);
    assert.equal(r.code, 3, r.err + r.out);
    assert.ok(r.out.includes(`avarice contract amend ${runId} --decision ${wide} --reason "<why>" --add-write 'src/extra.ts'`), r.out);
    assert.equal(r.out.includes('<decision-id>'), false, 'the placeholder is replaced by the ID');
    assert.deepEqual(eventsOf(f.roots, runId, 'amendment.requested'), [{ runId, decisionId: wide }]);
    assert.equal(decisionRow(f.roots, wide).state, 'open', 'nothing was applied');
    assert.deepEqual(contractVersions(f.roots, runId), versions, 'no contract version was written');
    // The same record does not take free text, and withdraw closes it.
    assert.equal((await decide(f.roots, [wide, '--text', 'yes'])).code, 64);
    assert.equal((await decide(f.roots, [wide, 'withdraw'])).code, 0);
    assert.equal(decisionRow(f.roots, wide).state, 'withdrawn');
  });

  it('state-digest: after an amendment, the answer to the old decision re-opens it with the answer kept as context and applies nothing (SC3 stale path)', async () => {
    const asked = seedDecision(f.roots, runId, { class: 'acceptance', issue: 'Which name?', options: OPTIONS_12, affectedItems: ['C'] });
    const before = fullDecision(f.roots, asked);
    assert.equal(before.contract_version, 1);
    await amendBudget(f.roots, runId, 11);
    assert.deepEqual(contractVersions(f.roots, runId), [1, 2]);
    const answeredEvents = eventsOf(f.roots, runId, 'decision.answered').length;

    const r = await decide(f.roots, [asked, '1']);
    assert.equal(r.code, 3, r.err + r.out);
    const old = fullDecision(f.roots, asked);
    assert.deepEqual([old.state, old.answer, old.answered_by, old.answer_channel], ['stale', '1', `owner:${userInfo().username}`, 'terminal']);
    const successor = ledgerRows<FullDecision>(f.roots, 'SELECT * FROM decisions WHERE supersedes = ?', asked);
    assert.equal(successor.length, 1, 'one successor');
    const next = successor[0] as FullDecision;
    assert.equal(next.state, 'open');
    assert.equal(next.contract_version, 2);
    assert.notEqual(next.state_digest, before.state_digest, 'the successor carries the digest of the new state');
    assert.equal(next.options_json, before.options_json);
    assert.equal(next.issue, 'Which name?');
    assert.ok(r.out.includes(next.decision_id), 'the output names the new decision');
    assert.match(r.out, /contract v1 -> v2/);
    assert.match(r.out, /the run changed/);
    assert.equal(eventsOf(f.roots, runId, 'decision.answered').length, answeredEvents, 'no answer was applied');
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.stale'), [{ runId, decisionId: asked, channel: 'terminal' }]);

    // The old decision now refuses and names its successor.
    const late = await decide(f.roots, [asked, '2']);
    assert.equal(late.code, 3, late.err + late.out);
    assert.ok(late.err.includes(next.decision_id), late.err);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId: asked, check: 'decision-stale' });

    // The new one applies.
    const applied = await decide(f.roots, [next.decision_id, '1']);
    assert.equal(applied.code, 0, applied.err + applied.out);
    assert.equal(decisionRow(f.roots, next.decision_id).state, 'answered');
  });

  it('records a rejection with the run, the decision and the check name and nothing more: never the typed text or the issue', () => {
    const rejected = eventsOf(f.roots, runId, 'decision.rejected');
    assert.ok(rejected.length >= 6);
    for (const data of rejected) assert.deepEqual(Object.keys(data).sort(), ['check', 'decisionId', 'runId']);
  });
});

// A withdrawal that leaves nothing to deliver: no live supervisor holds the run, so decide starts the one that ends it (D-16), and the run is failed with
// the undelivered items and the withdrawn decisions named.
describe('decide: a withdrawal that makes the blocked run continuable starts the supervisor, which ends the run failed', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;

  it('withdraws the decision, spawns once, and the run moves blocked_on_decision -> running -> failed naming B and D', async () => {
    // The question of B is taken back with the ledger (a test setup step), and a decision that offers only withdraw takes its place.
    withDeps(f.roots, (deps) => {
      const done = deps.ledger.withdrawDecision({ runId, decisionId, reason: 'owner', nowMs: Date.now() });
      assert.ok(done.ok, JSON.stringify(done));
    });
    const wide = seedDecision(f.roots, runId, { class: 'scope_expansion', options: WITHDRAW_ONLY, affectedItems: ['B', 'D'] });
    assert.deepEqual([runRowOf(f.roots, runId).state, runRowOf(f.roots, runId).lease_holder], ['blocked_on_decision', null]);

    const r = await withSupervisorEntry(s17Host({ question: undefined }), () => decide(f.roots, [wide, 'withdraw', '--wait']));
    assert.equal(r.code, 3, r.err + r.out);
    assert.match(r.out, new RegExp(`decision ${wide} withdrawn`));
    assert.match(r.out, new RegExp(`run ${runId}: supervisor started`));
    assert.equal(runRowOf(f.roots, runId).state, 'failed');
    assert.equal(decisionRow(f.roots, wide).state, 'withdrawn');
    assert.equal(stepsOf(f.roots, runId, 'supervisor:decide').length, 1);
    const moves = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId).map(
      (e) => JSON.parse(e.data_json) as { from: string; to: string; undelivered?: string[]; withdrawn?: string[] },
    );
    const end = moves.at(-1) as (typeof moves)[number];
    assert.deepEqual([end.from, end.to], ['running', 'failed']);
    assert.deepEqual(end.undelivered, ['B', 'D']);
    assert.deepEqual([...(end.withdrawn ?? [])].sort(), [decisionId, wide].sort());
  });
});

// The record as the owner reads it before answering (OPS-7). Model-derived text (the issue, the labels) is data: control characters and escapes are
// stripped, every line is cut to the terminal width and the issue to 1000 characters.
describe('decide <id> without an answer prints the record and writes nothing', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;

  it('prints the run, the items, the class, the question as data, each option, the consequences and the way to answer, then exits 64 with the store untouched', async () => {
    const before = { digest: ledgerDigest(f.roots), events: eventCount(f.roots) };
    const r = await decide(f.roots, [decisionId]);
    assert.equal(r.code, 64, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.includes(`decision ${decisionId} (open)`), r.out);
    assert.ok(lines.includes(`run ${runId}`), r.out);
    assert.ok(lines.includes('class: acceptance'), r.out);
    assert.ok(lines.includes('item: B (also affects D)'), r.out);
    assert.ok(lines.includes('question from the unit (data):'), r.out);
    assert.ok(lines.includes('  Which status code?'), r.out);
    assert.ok(lines.includes('options:'), r.out);
    assert.ok(lines.includes('  1: 404'), r.out);
    assert.ok(lines.includes('  2: 410'), r.out);
    assert.ok(lines.includes('consequences:'), r.out);
    assert.ok(lines.includes('  1: item B resumes with this answer'), r.out);
    assert.match(r.err, /give an option key or --text/);
    assert.equal(ledgerDigest(f.roots), before.digest, 'no ledger row changed');
    assert.equal(eventCount(f.roots), before.events, 'no event was appended');
    assert.equal(decisionRow(f.roots, decisionId).state, 'open');
  });

  it('prints the amend command of a record answered by an amendment, with its own ID, and no way to answer with an option', async () => {
    const wide = seedDecision(f.roots, runId, {
      class: 'scope_expansion',
      options: WITHDRAW_ONLY,
      consequences: { withdraw: 'the decision closes', amend: { command: `avarice contract amend ${runId} --decision <decision-id> --reason "<why>" --add-write 'src/extra.ts'`, request: {} } },
      affectedItems: ['C'],
    });
    const r = await decide(f.roots, [wide]);
    assert.equal(r.code, 64);
    assert.ok(r.out.includes(`amend: avarice contract amend ${runId} --decision ${wide} --reason "<why>" --add-write 'src/extra.ts'`), r.out);
    assert.ok(r.out.split('\n').includes('  withdraw: withdraw'));
  });

  it('strips control characters and escape sequences from the issue and the labels, cuts every line to the width (80 when unknown) and the issue to 1000 characters', async () => {
    const hostile = seedDecision(f.roots, runId, {
      class: 'acceptance',
      issue: `\u001b[31mred\u001b[0m\u0007 bell\u001b]0;owned\u0007\n${Array.from({ length: 30 }, () => 'y'.repeat(60)).join('\n')}`,
      options: [
        { key: '1', label: `\u001b[2Jwipe ${'z'.repeat(150)}`, kind: 'choice' },
        { key: '2', label: 'fine', kind: 'choice' },
      ],
      affectedItems: ['C'],
    });
    const r = await decide(f.roots, [hostile]);
    assert.equal(r.code, 64);
    assert.doesNotMatch(r.out, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/, 'no control character reaches the terminal');
    assert.equal(r.out.includes('owned'), false, 'the OSC string is removed with its text');
    assert.ok(r.out.includes('red bell'), 'the readable text stays');
    for (const line of r.out.split('\n')) assert.ok(Array.from(line).length <= 80, `a line is cut to 80: ${line.length}`);
    const issueChars = r.out
      .split('\n')
      .filter((line) => /^ {2}y+$/.test(line))
      .reduce((sum, line) => sum + line.trim().length, 0);
    assert.ok(issueChars > 0 && issueChars <= 1000, `the issue is cut to 1000 characters (${issueChars} of 1800)`);
  });

  it('exits 64 naming the ID of a decision that does not exist, with or without an answer', async () => {
    for (const argv of [['dec_01NOSUCHDECISION'], ['dec_01NOSUCHDECISION', '1']]) {
      const r = await decide(f.roots, argv);
      assert.equal(r.code, 64, r.err + r.out);
      assert.ok(r.err.includes('dec_01NOSUCHDECISION'), r.err);
    }
  });
});

describe('renderDecision: a pure view of one decision row', () => {
  const row = (over: Partial<DecisionRow>): DecisionRow => ({
    decisionId: 'dec_01AAAA',
    runId: 'run_01BBBB',
    contractVersion: 1,
    class: 'acceptance',
    issue: 'Which?',
    recommendation: 'the unit recommended option 2',
    options: OPTIONS_12,
    consequences: { '1': 'one', '2': 'two' },
    evidenceRefs: [],
    affectedItems: ['B'],
    authorizedDefault: null,
    stateDigest: 'sha256:x',
    urgency: 'blocking',
    state: 'open',
    openedAt: '2026-11-09T00:00:00.000Z',
    answeredAt: null,
    answeredBy: null,
    answer: null,
    answerChannel: null,
    supersedes: null,
    ...over,
  });

  it('shows the recommendation as the unit’s data, and a successor’s predecessor', () => {
    const text = renderDecision(row({ supersedes: 'dec_01OLD' }), 80);
    assert.match(text, /^recommendation: the unit recommended option 2$/m);
    assert.match(text, /^re-opens: dec_01OLD$/m);
  });

  it('cuts to a narrow width and reads a record with no options (Phase 2) as withdraw only', () => {
    const text = renderDecision(row({ options: [], consequences: {}, issue: 'a'.repeat(200) }), 30);
    for (const line of text.split('\n')) assert.ok(Array.from(line).length <= 30, line);
    assert.match(text, /^ {2}withdraw: withdraw$/m);
    assert.doesNotMatch(text, /^ {2}1: /m);
  });
});

// ---- the prompt after the record, and the chain into amend (plan 03-25; D-13, D-17) ---------------------------------------------------------
// On a terminal `decide <id>` with no answer prints the record and asks. Whatever is typed goes through the same engine as the one-line form, so the
// outcome, the events and the pickup are the ones `decide <id> <answer>` gives. `amend` on a record that carries an amend command chains into the
// `contract amend` diff and confirmation, so one `y` writes contract version n+1 and answers the decision in the same transaction.
const PROMPT = /^answer \(1, 2(, withdraw)?; empty leaves it open\): $/;

describe('decide <id> on a terminal shows the record and prompts for the answer (D-13)', () => {
  const s = startBlocked();
  const { f, runId, decisionId } = s;
  holdLease(f.roots, runId);

  it('an empty answer leaves the decision open: the record, `left open`, exit 0, and not one ledger row changed', async () => {
    const before = { digest: ledgerDigest(f.roots), events: eventCount(f.roots) };
    const r = await decide(f.roots, [decisionId], { answers: [''] });
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(r.questions.length, 1);
    assert.match(r.questions[0] as string, PROMPT);
    const lines = r.out.split('\n');
    assert.ok(lines.includes(`decision ${decisionId} (open)`), 'the record is printed first');
    assert.ok(lines.includes('  1: 404'), r.out);
    assert.ok(lines.includes('left open'), r.out);
    assert.equal(ledgerDigest(f.roots), before.digest);
    assert.equal(eventCount(f.roots), before.events);
    assert.equal(decisionRow(f.roots, decisionId).state, 'open');
  });

  it('end of input at the prompt leaves it open the same way', async () => {
    const r = await decide(f.roots, [decisionId], { answers: [] });
    assert.equal(r.code, 0, r.err + r.out);
    assert.ok(r.out.split('\n').includes('left open'), r.out);
    assert.equal(decisionRow(f.roots, decisionId).state, 'open');
  });

  it('a key the record does not list is refused as the one-line form refuses it: exit 64 and decision.rejected', async () => {
    const r = await decide(f.roots, [decisionId], { answers: ['9'] });
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /"9" is not one of the options \(1, 2\)/);
    assert.deepEqual(eventsOf(f.roots, runId, 'decision.rejected').at(-1), { runId, decisionId, check: 'option-not-listed' });
    assert.equal(decisionRow(f.roots, decisionId).state, 'open');
  });

  it('free text is taken where the record allows it and its prompt offers text', async () => {
    const textId = seedDecision(f.roots, runId, { class: 'acceptance', options: TEXT_OPTION, affectedItems: ['C'] });
    const r = await decide(f.roots, [textId], { answers: ['use the util name'] });
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.questions[0] as string, /^answer \(text; empty leaves it open\): $/);
    assert.ok(r.out.includes(`decision ${textId} answered (text)`), r.out);
    const row = decisionRow(f.roots, textId);
    assert.deepEqual([row.state, row.answer, row.answered_by, row.answer_channel], ['answered', 'use the util name', `owner:${userInfo().username}`, 'terminal']);
  });

  it('an option key is applied: the record, then `answered (2)` and the pickup of `decide <id> 2`', async () => {
    const r = await decide(f.roots, [decisionId], { answers: ['2'] });
    assert.equal(r.code, 0, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.indexOf(`decision ${decisionId} (open)`) >= 0 && lines.indexOf(`decision ${decisionId} (open)`) < lines.indexOf(`decision ${decisionId} answered (2)`), r.out);
    assert.ok(lines.includes(`run ${runId}: a running supervisor takes item B next`), r.out);
    const row = decisionRow(f.roots, decisionId);
    assert.deepEqual([row.state, row.answer, row.answered_by, row.answer_channel], ['answered', '2', `owner:${userInfo().username}`, 'terminal']);
    assert.equal(stepsOf(f.roots, runId, 'supervisor:decide').length, 0, 'a live lease holder takes the item; nothing was started');
  });

  it('with no way to ask (no io.ask, standard input not a terminal) it keeps the record and exit 64 of the one-line form', async () => {
    const other = seedDecision(f.roots, runId, { class: 'acceptance', options: OPTIONS_12, affectedItems: ['C'] });
    const r = await decide(f.roots, [other]);
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /give an option key or --text/);
    assert.deepEqual(r.questions, []);
  });
});

describe('decide <id> on a non-pause decision: amend chains into the contract amend confirmation (D-17)', () => {
  const amendRecord = (runId: string): { options: unknown; consequences: unknown } => ({
    options: WITHDRAW_ONLY,
    consequences: {
      withdraw: 'the decision closes',
      amend: {
        command: `avarice contract amend ${runId} --decision <decision-id> --reason "<why>" --add-write 'src/extra.ts'`,
        request: { addWrite: ['src/extra.ts'] },
      },
    },
  });

  // The question of B is taken back, and a scope_expansion decision that asks to write src/extra.ts takes its place on B and D.
  function blockedOnScope(): Started & { wide: string } {
    const started = startBlocked();
    withDeps(started.f.roots, (deps) => {
      const done = deps.ledger.withdrawDecision({ runId: started.runId, decisionId: started.decisionId, reason: 'owner', nowMs: Date.now() });
      assert.ok(done.ok, JSON.stringify(done));
    });
    const wide = seedDecision(started.f.roots, started.runId, { class: 'scope_expansion', ...amendRecord(started.runId), affectedItems: ['B', 'D'] });
    return { ...started, wide };
  }

  it('`n` at the confirmation records the request, writes no contract version and leaves the decision open', async () => {
    const t = blockedOnScope();
    const before = contractVersions(t.f.roots, t.runId);
    const r = await decide(t.f.roots, [t.wide], { answers: ['amend', 'n'] });
    assert.equal(r.code, 0, r.err + r.out);
    assert.ok(r.out.split('\n').includes('not amended'), r.out);
    assert.ok(r.out.split('\n').includes(`decision ${t.wide} left open`), r.out);
    assert.deepEqual(contractVersions(t.f.roots, t.runId), before);
    assert.deepEqual(eventsOf(t.f.roots, t.runId, 'amendment.requested'), [{ runId: t.runId, decisionId: t.wide }]);
    assert.equal(decisionRow(t.f.roots, t.wide).state, 'open');
    assert.equal(stepsOf(t.f.roots, t.runId, 'supervisor:decide').length, 0);
  });

  it('`amend` is not offered, and is refused, on a pause decision that carries no amend command', async () => {
    const t = startBlocked();
    const r = await decide(t.f.roots, [t.decisionId], { answers: ['amend'] });
    assert.match(r.questions[0] as string, PROMPT);
    assert.equal(r.code, 64, r.err + r.out);
    assert.deepEqual(contractVersions(t.f.roots, t.runId), [1]);
    assert.equal(decisionRow(t.f.roots, t.decisionId).state, 'open');
  });

  it('a record whose amend command carries no measured request says so and points at the command; nothing is written', async () => {
    const t = startBlocked();
    const bare = seedDecision(t.f.roots, t.runId, {
      class: 'budget',
      options: WITHDRAW_ONLY,
      consequences: { amend: { command: `avarice contract amend ${t.runId} --decision <decision-id> --reason "<why>" --budget costUsdPerRun=<value>`, request: {} } },
      affectedItems: ['C'],
    });
    const r = await decide(t.f.roots, [bare], { answers: ['amend'] });
    assert.equal(r.code, 3, r.err + r.out);
    assert.ok(r.out.includes(`avarice contract amend ${t.runId} --decision ${bare} --reason "<why>" --budget costUsdPerRun=<value>`), r.out);
    assert.deepEqual(contractVersions(t.f.roots, t.runId), [1]);
    assert.equal(decisionRow(t.f.roots, bare).state, 'open');
  });

  it('the prompt offers withdraw and amend; `amend` then `y` writes contract v2 and answers the decision in one transaction, then the supervisor continues the run (tracer)', async () => {
    const t = blockedOnScope();
    assert.deepEqual(contractVersions(t.f.roots, t.runId), [1]);
    const r = await withSupervisorEntry(s17Host({ question: undefined }), () => decide(t.f.roots, [t.wide, '--wait'], { answers: ['amend', 'y'] }));
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(r.questions.length, 2);
    assert.match(r.questions[0] as string, /^answer \(withdraw, amend; empty leaves it open\): $/);
    assert.equal(r.questions[1], 'apply contract v2? [y/N] ');

    const lines = r.out.split('\n');
    assert.ok(lines.includes(`decision ${t.wide} (open)`), 'the record is printed first');
    assert.ok(lines.some((l) => l.startsWith('files.write:') && l.includes('src/extra.ts')), `the diff names files.write and the suggested path:\n${r.out}`);
    assert.ok(lines.includes('contract v2 recorded'), r.out);
    assert.ok(lines.includes(`decision ${t.wide} answered amended:v2`), r.out);
    assert.ok(lines.includes(`run ${t.runId}: supervisor started`), r.out);

    assert.deepEqual(contractVersions(t.f.roots, t.runId), [1, 2]);
    const row = decisionRow(t.f.roots, t.wide);
    assert.deepEqual([row.state, row.answer, row.answered_by, row.answer_channel], ['answered', 'amended:v2', `owner:${userInfo().username}`, 'terminal']);
    assert.deepEqual(eventsOf(t.f.roots, t.runId, 'amendment.requested'), [{ runId: t.runId, decisionId: t.wide }]);
    const amended = eventsOf(t.f.roots, t.runId, 'contract.amended');
    assert.equal(amended.length, 1);
    assert.equal(amended[0]?.['version'], 2);
    assert.equal(amended[0]?.['resolvedDecisionId'], t.wide, 'the one contract.amended event names the decision it answered: both were written together');
    assert.equal(runRowOf(t.f.roots, t.runId).state, 'ready_for_review');
    assert.equal(stepsOf(t.f.roots, t.runId, 'supervisor:decide').length, 1);
  });
});

// unitOf is used by a later suite of this file.
void unitOf;
