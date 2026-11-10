// Finishing a run in place (plan 03-49; RC-6, AUT-3, AUT-5). The shape of exit run 1 of the real portfolio, offline: three items, A and B committed, C parked on a
// pause-origin acceptance decision whose answer would need a write the contract lacks. The conventions write src/**, test/** and tests/unit/**, and protect
// tests/e2e/**, as the owner's portfolio does. Three ways of finishing the run are measured through the real CLI (amend and decide on a terminal that is a stream
// claiming to be one), the real supervisor, ledger, gates and git; only the model is the fake run host:
//   P  the owner adds a protected path to the write set: the amendment is refused and nothing is written;
//   U  the owner adds an unprotected path inside the conventions and then answers: whether the first answer is stale, which gate rows go stale, how the run ends
//      (recorded, not pinned beyond "every command exits with a documented code and no row is updated or deleted");
//   Y  the owner answers the option that asks for the e2e change: the hook refuses the write to the protected spec;
//   N  the owner answers the option that leaves the protected file alone: C finishes inside the write set and the run is ready for review although a declared
//      check that is not required (and so is never run by the supervisor) fails against the delivered tree.
// The decision of C carries no amend key in any scenario. No test calls a real model; no banner is posted.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { TEST_CLI } from '../helpers/fault-run.ts';
import { decideMain, runMain, withSupervisorEntry } from '../helpers/decide-cli.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, runIdOfOutput, runRowOf } from '../helpers/independent-work.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, writeItemsBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import type { BriefItem } from '../../src/domain/brief.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// Where the measurements of the three scenarios go when a file is named (plan 03-49 turns them into 03-49-finish-analysis.json). They are printed too.
const MEASURE_OUT = process.env['AVARICE_FINISH_MEASURE_OUT'];
function record(scenario: string, value: unknown): void {
  const line = `MEASURED ${scenario} ${JSON.stringify(value)}`;
  console.log(line);
  if (MEASURE_OUT !== undefined) appendFileSync(MEASURE_OUT, `${line}\n`);
}

// The conventions of the owner's portfolio in miniature: the write set and the protected globs, one required check and one declared check that is not required.
const CONVENTIONS = {
  schema: 1,
  checks: [
    { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
    { name: 'e2e', argv: ['node', 'scripts/e2e-check.mjs'], timeoutSec: 60, required: false },
  ],
  paths: { write: ['src/**', 'test/**', 'tests/unit/**'], protected: ['tests/e2e/**', 'scripts/**'], artifacts: [] },
  agentCommands: ['npm test'],
} as const;

// The spec file under the protected glob names the status the code must say; the declared check fails when the code stops saying it.
const E2E_SCRIPT = [
  "import { readFileSync } from 'node:fs';",
  "const spec = readFileSync('tests/e2e/status.spec.txt', 'utf8');",
  "const code = readFileSync('src/status.ts', 'utf8');",
  'const wanted = /[0-9]+/.exec(spec)?.[0] ?? "";',
  "if (!code.includes(wanted)) {",
  "  console.error('e2e: src/status.ts no longer says ' + wanted);",
  '  process.exit(1);',
  '}',
  '',
].join('\n');

const ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Add a helper module', dependsOn: [], acceptance: ['AC2'] },
  { id: 'C', title: 'Name the status in the toast', dependsOn: ['B'], acceptance: ['AC3'] },
];
const ACCEPTANCE: readonly string[] = [
  'Repeated separators collapse to one dash | verifiedBy: check:test',
  'The helper module exists | verifiedBy: check:test',
  'The status is named | verifiedBy: check:test',
];

const QUESTION = ['Allow the one-line e2e change?', '1. Yes, allow the one-line e2e change and re-verify', '2. No, leave the e2e spec failing and let you handle it separately'].join('\n');

const STATUS_404 = 'export const status = 404;\n';
const STATUS_410 = 'export const status = 410;\n';
const UNIT = { summary: true, verification: 'passed' } as const;
const EXTRA_PATH = 'tests/unit/status-extra.ts';

interface Shape {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  runId: string;
  decisionId: string;
}

// The host of the start: A and B finish, C edits src/status.ts and then asks its question (what the unit of run 1's item C did). `finishing` is what C does once
// the owner has answered: its resumed session, or a fresh unit if the supervisor falls back to one, both play it.
function hostOf(finishing: FakeRunOptions): FakeRunOptions {
  return {
    perItem: {
      A: { ...UNIT, edits: { 'src/slug.ts': FIXED_SLUG } },
      B: { ...UNIT, edits: { 'src/helper.ts': 'export const helper = 1;\n' } },
      C: { ...finishing, perAttempt: [{ edits: { 'src/status.ts': STATUS_410 }, question: QUESTION }], resume: finishing },
    },
  };
}

// The host of the continuation: only C runs again.
const finishingHost = (finishing: FakeRunOptions): FakeRunOptions => ({ perItem: { C: { ...finishing, perAttempt: [], resume: finishing } } });

// `start --brief ... --wait` through the test CLI: A and B are committed and C is blocked on its decision.
function startShape(): Shape {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'src/status.ts': STATUS_404, 'tests/e2e/status.spec.txt': 'the toast shows 404\n', 'scripts/e2e-check.mjs': E2E_SCRIPT });
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, CONVENTIONS);
  const brief = writeItemsBrief(join(roots.base, 'briefs'), ITEMS, ACCEPTANCE, { write: ['src/**', 'test/**'], title: 'Name the status in the toast' });
  const result = runCli(['start', '--brief', brief, '--policy', 'routine', '--wait'], {
    roots,
    cwd: repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: hostOf({ ...UNIT, edits: { 'src/status.ts': STATUS_410 } }) }) },
    timeoutMs: 300_000,
  });
  assert.equal(result.code, 3, result.stdout + result.stderr);
  const runId = runIdOfOutput(result.stdout);
  const open = ledgerRows<{ decision_id: string }>(roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId);
  assert.equal(open.length, 1, 'one open decision');
  return { roots, repo, pin, runId, decisionId: (open[0] as { decision_id: string }).decision_id };
}

interface Rows {
  contracts: unknown[];
  decisions: unknown[];
  gates: unknown[];
  evidence: unknown[];
  attempts: unknown[];
  run: unknown;
  events: number;
}

// Every row that matters to "nothing was written or changed", as the ledger holds it.
function rowsOf(roots: CliRoots, runId: string): Rows {
  return {
    contracts: ledgerRows(roots, 'SELECT run_id, version, digest, authorized_by, reason, diff_json, created_at FROM contracts WHERE run_id = ? ORDER BY version', runId),
    decisions: ledgerRows(roots, 'SELECT * FROM decisions WHERE run_id = ? ORDER BY opened_at, rowid', runId),
    gates: ledgerRows(roots, 'SELECT * FROM gate_results WHERE run_id = ? ORDER BY rowid', runId),
    evidence: ledgerRows(roots, 'SELECT e.* FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.rowid', runId),
    attempts: ledgerRows(roots, 'SELECT * FROM attempts WHERE run_id = ? ORDER BY ordinal', runId),
    run: ledgerRows(roots, 'SELECT state, reason, version, lease_holder, lease_fence FROM runs WHERE run_id = ?', runId)[0],
    events: (ledgerRows<{ n: number }>(roots, 'SELECT count(*) AS n FROM events WHERE run_id = ?', runId)[0] as { n: number }).n,
  };
}

interface GateRow {
  gate: string;
  work_item: string | null;
  contract_version: number;
  passed: number;
  failures_json: string;
}
const gateRowsOf = (roots: CliRoots, runId: string): GateRow[] =>
  ledgerRows<GateRow>(roots, 'SELECT gate, work_item, contract_version, passed, failures_json FROM gate_results WHERE run_id = ? ORDER BY rowid', runId);
const gateView = (rows: readonly GateRow[]): string[] => rows.map((g) => `${g.gate}:${g.work_item ?? '-'}:v${g.contract_version}:${g.passed === 1 ? 'passed' : 'failed'}${g.failures_json.includes('stale-after-amendment') ? ':stale-after-amendment' : ''}`);

const contractVersions = (roots: CliRoots, runId: string): number[] => ledgerRows<{ version: number }>(roots, 'SELECT version FROM contracts WHERE run_id = ? ORDER BY version', runId).map((c) => c.version);

const decisionView = (roots: CliRoots, runId: string): Array<{ id: string; state: string; answer: string | null; contractVersion: number; supersedes: string | null }> =>
  decisionsOf(roots, runId).map((d) => ({ id: d.decision_id, state: d.state, answer: d.answer, contractVersion: d.contract_version, supersedes: (d as unknown as { supersedes: string | null }).supersedes ?? null }));

// The Q of the shape, once the run is blocked: A and B are done with a commit each, C is blocked, one open decision of class acceptance that carries no amend command.
function assertShape(s: Shape): void {
  assert.deepEqual(itemStatesOf(s.roots, s.runId), [
    ['A', 'done'],
    ['B', 'done'],
    ['C', 'blocked_on_decision'],
  ]);
  const run = runRowOf(s.roots, s.runId);
  assert.deepEqual([run.state, run.reason], ['blocked_on_decision', 'decision']);
  assert.deepEqual(commitsOfRun(run.workspace_path, s.pin).map((c) => c.subject), ['Collapse repeated dashes', 'Add a helper module']);
  const decisions = decisionsOf(s.roots, s.runId);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.class, 'acceptance');
  assert.equal(decisions[0]?.state, 'open');
  assert.equal(decisions[0]?.contract_version, 1);
  assert.deepEqual(JSON.parse(decisions[0]?.affected_items_json as string), ['C']);
  assert.deepEqual(contractVersions(s.roots, s.runId), [1]);
}

// What `decide <id>` with no answer shows and asks on a terminal: the record and the question; the empty answer leaves the decision open.
async function assertNoAmendKey(s: Shape, decisionId: string): Promise<void> {
  const shown = await decideMain(s.roots, [decisionId], { answers: [''] });
  assert.equal(shown.code, 0, shown.err + shown.out);
  assert.equal(shown.questions.length, 1);
  assert.match(shown.questions[0] as string, /^answer \(1, 2; empty leaves it open\): $/, 'the prompt lists the two choices and nothing else');
  assert.doesNotMatch(shown.questions[0] as string, /amend/);
  assert.doesNotMatch(shown.out, /amend/i, 'the record names no amend command');
  assert.match(shown.out, /left open/);
}

const amendArgs = (runId: string, glob: string): string[] => ['contract', 'amend', runId, '--add-write', glob, '--reason', 'the e2e spec asserts the old toast text'];

describe('scenario P: an add-write of a protected path is refused and nothing is written', () => {
  const s = startShape();

  it('has the shape of run 1: A and B committed, C blocked on one acceptance decision at contract v1, no amend key offered', async () => {
    assertShape(s);
    await assertNoAmendKey(s, s.decisionId);
  });

  it('refuses `contract amend --add-write tests/e2e/x.spec.ts` naming the protected path, exits with the usage code and starts no supervisor', async () => {
    const before = rowsOf(s.roots, s.runId);
    const asked = await runMain(s.roots, amendArgs(s.runId, 'tests/e2e/x.spec.ts'), { answers: ['y'] });
    const after = rowsOf(s.roots, s.runId);
    record('P', { argv: amendArgs(s.runId, 'tests/e2e/x.spec.ts').join(' '), code: asked.code, err: asked.err.trim(), out: asked.out, questions: asked.questions });
    assert.equal(asked.code, 64, asked.err + asked.out);
    assert.match(asked.err, /add-write/);
    assert.match(asked.err, /tests\/e2e\/x\.spec\.ts is a protected path/);
    assert.deepEqual(asked.questions, [], 'nothing was asked: the plan was refused before the confirmation');
    assert.equal(asked.out, '', 'no diff was shown');
    assert.deepEqual(contractVersions(s.roots, s.runId), [1], 'the contract stays at version 1');
    assert.deepEqual(after, before, 'the contracts, decisions, gate rows, evidence rows, attempts, run row and event count are as they were');
    assert.equal(decisionView(s.roots, s.runId)[0]?.state, 'open', 'the decision stays open');
  });

  it('refuses the same for the path the real run needs, tests/e2e/copy-email.spec.ts, and for a glob over the whole directory', async () => {
    const before = rowsOf(s.roots, s.runId);
    for (const glob of ['tests/e2e/copy-email.spec.ts', 'tests/e2e/**']) {
      const asked = await runMain(s.roots, amendArgs(s.runId, glob), { answers: ['y'] });
      assert.equal(asked.code, 64, `${glob}: ${asked.err}`);
      assert.match(asked.err, /is a protected path/);
    }
    assert.deepEqual(rowsOf(s.roots, s.runId), before);
  });

  it('refuses a path outside the conventions\' write set with the conventions message, also writing nothing', async () => {
    const before = rowsOf(s.roots, s.runId);
    const asked = await runMain(s.roots, amendArgs(s.runId, 'other/place.ts'), { answers: ['y'] });
    record('P-outside', { code: asked.code, err: asked.err.trim() });
    assert.equal(asked.code, 64, asked.err);
    assert.match(asked.err, /is not inside the write set of the repository conventions/);
    assert.deepEqual(rowsOf(s.roots, s.runId), before);
    assert.equal(attemptsOfRun(s.roots, s.runId).length, 3, 'no supervisor ran a unit: the attempts are the three of the start');
  });
});

describe('scenario U: amend an unprotected path inside the conventions, then answer', () => {
  const s = startShape();
  // C's finishing unit writes the path the amendment adds, and keeps the status the e2e check wants, so only the amendment is under test.
  const finishing: FakeRunOptions = { ...UNIT, edits: { 'src/status.ts': 'export const status = 404;\nexport const label = "not found";\n', [EXTRA_PATH]: 'export const extra = true;\n' }, quickId: '261105-fk2-resume' };
  const measured: Record<string, unknown> = {};

  it('has the shape of run 1', () => {
    assertShape(s);
  });

  it('records contract v2 with the owner, the reason and a diff naming files.write and files.create, and appends the stale gate rows', async () => {
    const before = rowsOf(s.roots, s.runId);
    const gatesBefore = gateRowsOf(s.roots, s.runId);
    const asked = await runMain(s.roots, amendArgs(s.runId, EXTRA_PATH), { answers: ['y'] });
    const gatesAfter = gateRowsOf(s.roots, s.runId);
    measured['amend'] = { argv: amendArgs(s.runId, EXTRA_PATH).join(' '), code: asked.code, out: asked.out, err: asked.err.trim(), questions: asked.questions };
    measured['gateRowsBeforeAmend'] = gateView(gatesBefore);
    measured['gateRowsAfterAmend'] = gateView(gatesAfter);
    assert.equal(asked.code, 0, asked.err + asked.out);
    assert.deepEqual(contractVersions(s.roots, s.runId), [1, 2]);
    const v2 = ledgerRows<{ authorized_by: string; reason: string; diff_json: string }>(s.roots, 'SELECT authorized_by, reason, diff_json FROM contracts WHERE run_id = ? AND version = 2', s.runId)[0];
    assert.equal(v2?.authorized_by, `owner:${userInfo().username}`);
    assert.equal(v2?.reason, 'the e2e spec asserts the old toast text');
    const diff = JSON.parse(v2?.diff_json as string) as Array<{ path: string; added?: string[] }>;
    assert.deepEqual(diff.map((d) => d.path), ['files.write', 'files.create']);
    assert.deepEqual(diff[0]?.added, [EXTRA_PATH]);
    // Nothing was updated or deleted: every earlier row is as it was, and the new rows are appended.
    const after = rowsOf(s.roots, s.runId);
    assert.deepEqual(after.gates.slice(0, before.gates.length), before.gates, 'the earlier gate rows are untouched');
    assert.deepEqual(after.evidence.slice(0, before.evidence.length), before.evidence, 'the earlier evidence rows are untouched');
    assert.deepEqual(after.decisions, before.decisions, 'the decision is untouched by the amendment');
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(decisionView(s.roots, s.runId)[0]?.state, 'open');
  });

  it('shows no amend key for the decision of C after the amendment either', async () => {
    await assertNoAmendKey(s, s.decisionId);
  });

  it('answers the v1 decision: it is stale (exit 3), applies nothing and opens a successor that keeps the answer as context', async () => {
    const before = rowsOf(s.roots, s.runId);
    const answered = await decideMain(s.roots, [s.decisionId, '1']);
    measured['answerOld'] = { argv: `decide ${s.decisionId} 1`, code: answered.code, out: answered.out, err: answered.err.trim() };
    measured['decisionsAfterOldAnswer'] = decisionView(s.roots, s.runId);
    record('U-answer-old', measured['answerOld']);
    assert.ok([0, 3].includes(answered.code), `a documented exit code: ${answered.code}`);
    const after = rowsOf(s.roots, s.runId);
    assert.deepEqual(after.contracts, before.contracts);
    assert.deepEqual(after.gates, before.gates);
    assert.deepEqual(after.evidence, before.evidence);
  });

  it('answers the successor (when the old answer was stale) and the supervisor takes C; the end state is recorded', async () => {
    const views = decisionView(s.roots, s.runId);
    const open = views.find((d) => d.state === 'open');
    measured['openAfterOldAnswer'] = open ?? null;
    if (open === undefined) {
      // The old answer was applied: the supervisor, if one was started, takes C. Wait for it through the ledger.
      await settle(s);
    } else {
      const next = await withSupervisorEntry(finishingHost(finishing), () => decideMain(s.roots, [open.id, '1', '--wait']));
      measured['answerSuccessor'] = { argv: `decide ${open.id} 1 --wait`, code: next.code, out: next.out, err: next.err.trim() };
      assert.ok([0, 3].includes(next.code), `a documented exit code: ${next.code}\n${next.err}${next.out}`);
    }
    const run = runRowOf(s.roots, s.runId);
    measured['end'] = {
      state: run.state,
      reason: run.reason,
      items: itemStatesOf(s.roots, s.runId),
      attempts: attemptsOfRun(s.roots, s.runId).map((a) => `${a.item_id}:${a.reason}:${a.outcome}`),
      decisions: decisionView(s.roots, s.runId),
      contractVersions: contractVersions(s.roots, s.runId),
      gates: gateView(gateRowsOf(s.roots, s.runId)),
      commits: commitsOfRun(run.workspace_path, s.pin).map((c) => `${c.subject}: ${c.files.join(',')}`),
    };
    record('U', measured);
  });
});

// Waits for the supervisor a decision started to leave a stop state (the ledger is the only witness), then returns.
async function settle(s: Shape): Promise<void> {
  const end = Date.now() + 120_000;
  for (;;) {
    const run = runRowOf(s.roots, s.runId);
    if (run.lease_holder === null && run.state !== 'running') return;
    if (Date.now() > end) assert.fail('timed out waiting for the supervisor');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('scenario N: answer the option that leaves the protected file alone', () => {
  const s = startShape();
  // C's resumed session finishes with the status the owner's answer left: 410, so the declared e2e check, which is not required, fails.
  const finishing: FakeRunOptions = { ...UNIT, edits: { 'src/status.ts': STATUS_410 }, quickId: '261105-fk2-resume' };

  it('has the shape of run 1', () => {
    assertShape(s);
  });

  it('answers option 2: C resumes its own session inside the write set, the run reaches ready_for_review with C committed, and the declared check that is not required is never run', async () => {
    await assertNoAmendKey(s, s.decisionId);
    const answered = await withSupervisorEntry(finishingHost(finishing), () => decideMain(s.roots, [s.decisionId, '2', '--wait']));
    record('N-answer', { argv: `decide ${s.decisionId} 2 --wait`, code: answered.code, out: answered.out, err: answered.err.trim() });
    assert.equal(answered.code, 0, answered.err + answered.out);
    const run = runRowOf(s.roots, s.runId);
    assert.equal(run.state, 'ready_for_review');
    assert.deepEqual(itemStatesOf(s.roots, s.runId), [
      ['A', 'done'],
      ['B', 'done'],
      ['C', 'done'],
    ]);
    assert.deepEqual(contractVersions(s.roots, s.runId), [1], 'no amendment');
    assert.deepEqual(decisionView(s.roots, s.runId).map((d) => [d.state, d.answer]), [['answered', '2']]);
    assert.deepEqual(
      attemptsOfRun(s.roots, s.runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['C', 'initial'],
        ['C', 'resume'],
      ],
    );
    const commits = commitsOfRun(run.workspace_path, s.pin);
    assert.deepEqual(
      commits.map((c) => c.subject),
      ['Collapse repeated dashes', 'Add a helper module', 'Name the status in the toast'],
    );
    assert.deepEqual(commits[2]?.files, ['src/status.ts'], "C's commit holds only a path inside the write set");
    const checksOfC = ledgerRows<{ name: string; status: string }>(
      s.roots,
      "SELECT e.name, e.status FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.work_item = 'C' ORDER BY e.rowid",
      s.runId,
    );
    record('N', {
      state: run.state,
      checksOfC: checksOfC.map((c) => `${c.name}:${c.status}`),
      gates: gateView(gateRowsOf(s.roots, s.runId)),
      commits: commits.map((c) => `${c.subject}: ${c.files.join(',')}`),
      attempts: attemptsOfRun(s.roots, s.runId).map((a) => `${a.item_id}:${a.reason}:${a.outcome}`),
    });
    assert.ok(checksOfC.some((c) => c.name === 'test' && c.status === 'passed'), 'the required check passed for C');
    // The supervisor runs only the required checks and the brief's target checks (src/app/checks.ts, checksToRun): a declared check that is neither is never run,
    // so the run holds no evidence row for it and nothing in the run judges that the delivered tree fails it. Run by hand in the delivered tree, it fails.
    assert.equal(checksOfC.some((c) => c.name === 'e2e'), false, 'the supervisor never ran the declared check that is not required');
    const byHand = spawnSync(process.execPath, ['scripts/e2e-check.mjs'], { cwd: run.workspace_path, encoding: 'utf8' });
    record('N-by-hand', { code: byHand.status, stderr: byHand.stderr.trim() });
    assert.equal(byHand.status, 1, 'the declared check fails against the delivered tree');
    assert.match(byHand.stderr, /src\/status\.ts no longer says 404/);
    const g = gateRowsOf(s.roots, s.runId);
    assert.ok(g.some((row) => row.gate === 'G4' && row.passed === 1), 'G4 passed');
    assert.ok(g.some((row) => row.gate === 'G2' && row.work_item === 'C' && row.passed === 1), 'G2 passed for C');
  });
});

describe('scenario Y: answer the option that asks for the e2e change', () => {
  const s = startShape();
  // C's resumed session tries to write the protected e2e spec, as the answer allows, and finishes the rest.
  const finishing: FakeRunOptions = { ...UNIT, edits: { 'src/status.ts': STATUS_410 }, deniedEdit: 'tests/e2e/status.spec.txt', quickId: '261105-fk2-resume' };

  it('has the shape of run 1', () => {
    assertShape(s);
  });

  it('the answer changes no contract field: the hook refuses the write to the protected spec, which stays as it was at the pin, and the run ends in a documented state', async () => {
    const answered = await withSupervisorEntry(finishingHost(finishing), () => decideMain(s.roots, [s.decisionId, '1', '--wait']));
    const run = runRowOf(s.roots, s.runId);
    const hookEvents = ledgerRows<{ type: string; data_json: string }>(s.roots, "SELECT type, data_json FROM events WHERE run_id = ? AND type LIKE 'hook.%' ORDER BY seq", s.runId);
    const pinSpec = spawnSync('git', ['-C', run.workspace_path, 'show', `${s.pin}:tests/e2e/status.spec.txt`], { encoding: 'utf8' }).stdout;
    const nowSpec = spawnSync('git', ['-C', run.workspace_path, 'show', 'HEAD:tests/e2e/status.spec.txt'], { encoding: 'utf8' }).stdout;
    record('Y', {
      argv: `decide ${s.decisionId} 1 --wait`,
      code: answered.code,
      out: answered.out,
      err: answered.err.trim(),
      state: run.state,
      reason: run.reason,
      items: itemStatesOf(s.roots, s.runId),
      attempts: attemptsOfRun(s.roots, s.runId).map((a) => `${a.item_id}:${a.reason}:${a.outcome}`),
      contractVersions: contractVersions(s.roots, s.runId),
      hookDenials: hookEvents.filter((e) => e.data_json.includes('"decision":"deny"')).map((e) => e.data_json),
      specAtPinEqualsHead: pinSpec === nowSpec,
      gates: gateView(gateRowsOf(s.roots, s.runId)),
    });
    assert.ok([0, 3].includes(answered.code), `a documented exit code: ${answered.code}\n${answered.err}${answered.out}`);
    assert.deepEqual(contractVersions(s.roots, s.runId), [1], 'no amendment');
    assert.ok(
      hookEvents.some((e) => e.data_json.includes('"decision":"deny"') && e.data_json.includes('"rule":"protected-path"')),
      'the hook denied the write to the protected path',
    );
    assert.equal(pinSpec, nowSpec, 'the protected spec is as it was at the pin');
    assert.equal(spawnSync('git', ['-C', run.workspace_path, 'status', '--porcelain', '--', 'tests/e2e'], { encoding: 'utf8' }).stdout, '', 'nor is it changed in the working tree');
  });
});
