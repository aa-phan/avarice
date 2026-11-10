// Exit run 1's shape offline (plan 03-40; AUT-1 to AUT-3). Three items: A (independent), B (an owner choice between two wordings, listed as numbered lines in
// B's own Behavior paragraph) and C (depends on B). The unit of A finishes its own work, verified, and ends its final text with B's numbered choice, as the
// live unit did. A is attributed no pause and is committed; only B blocks, on its own question; C stays undelegated; the run holds one decision and one
// notification. The controls keep today's pause: a choice that is A's own, a unit that is not verified, a partial match. The fake run host plays the
// units; git, the checks, the ledger, the gates, the commits and the supervisor are real. No test calls a real model, and osascript is a fake script.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import type { BriefItem } from '../../src/domain/brief.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { attemptsOfRun, commitsOfRun, decisionsOf, itemStatesOf, runIdOfOutput, runRowOf, unitOf } from '../helpers/independent-work.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/fault-run.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, itemsBriefText, ledgerRows, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const WORDING_1 = '`Couldn’t map. Try again later.`';
const WORDING_2 = '`Couldn’t map the status. Contact support.`';
const QUESTION = `Which wording should item B use?\n1. ${WORDING_1}\n2. ${WORDING_2}`;

const ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Collapse repeated dashes', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Map a status code', dependsOn: [], acceptance: ['AC2'] },
  { id: 'C', title: 'Add a helper module', dependsOn: ['B'], acceptance: ['AC3'] },
];
const ACCEPTANCE: readonly string[] = [
  'Repeated separators collapse to one dash | verifiedBy: check:test',
  'A status code is mapped with the wording the owner chose | verifiedBy: decision:status-wording, check:test',
  'The helper module exists | verifiedBy: check:test',
];

const PARAGRAPH_A = 'Item A: collapse repeated separators in the slug to one dash.';
const PARAGRAPH_B = [
  'Item B: map a status code to a message. The wording is the owner’s choice between two options; stop and ask which one before writing it:',
  `1. ${WORDING_1}`,
  `2. ${WORDING_2}`,
  'Keep the existing exports unchanged in this item.',
].join('\n');
const PARAGRAPH_C = 'Item C: add the helper module that uses the status mapping.';
const BEHAVIOR = [PARAGRAPH_A, '', PARAGRAPH_B, '', PARAGRAPH_C].join('\n');

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
}

// An onboarded repository with the conventions committed and the brief of the scenario written; the Behavior is the one of exit run 1's shape.
function fixture(behavior: string = BEHAVIOR): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  const text = itemsBriefText(ITEMS, ACCEPTANCE, { title: 'Status wording in three items' }).replace('A slug never contains two dashes in a row, and the slug rules are covered by tests.', behavior);
  assert.ok(text.includes(behavior), 'the brief carries the scenario Behavior');
  return { roots, repo, pin, brief: writeBrief(join(roots.base, 'briefs'), text) };
}

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

interface Started {
  f: Fixture;
  runId: string;
  log: string;
  code: number | null;
  stdout: string;
  records: Record<string, string>;
}

// `start --brief ... --wait` through the test CLI: the detached supervisor plays the scenario, and its banner goes through the fake osascript. Each item's
// prompt is recorded by the fake host under `records`.
function start(host: Readonly<Record<string, FakeRunOptions>>, behavior?: string): Started {
  const f = fixture(behavior);
  const dir = mkdtempSync(join(tmpdir(), 'avarice-pause-attribution-'));
  cleanup.push(dir);
  const log = join(dir, 'osascript.log');
  const records: Record<string, string> = {};
  const perItem: Record<string, FakeRunOptions> = {};
  for (const [id, options] of Object.entries(host)) {
    records[id] = join(dir, `unit-${id}.json`);
    perItem[id] = { ...options, recordTo: records[id] as string };
  }
  chmodSync(FAKE_OSASCRIPT, 0o755);
  writeProfileConfig(f.roots, { notify: { local: { osascriptPath: FAKE_OSASCRIPT } } });
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: { perItem } }), AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: log },
    timeoutMs: 300_000,
  });
  return { f, runId: runIdOfOutput(result.stdout), log, code: result.code, stdout: result.stdout, records };
}

// The three units of exit run 1: A finishes and ends with B's question; B ends with the same question and makes no edit; C would finish.
const RUN1_HOST: Readonly<Record<string, FakeRunOptions>> = {
  A: unitOf('A', { question: `Item A is done.\n\n${QUESTION}` }),
  B: unitOf('B', { edits: {}, summary: false, verification: 'none', question: QUESTION }),
  C: unitOf('C'),
};

interface StepRow {
  step: string;
  result: Record<string, unknown>;
}
const classifyStepsOf = (roots: CliRoots, runId: string): StepRow[] =>
  ledgerRows<{ step: string; result_json: string }>(roots, "SELECT step, result_json FROM run_steps WHERE run_id = ? AND step = 'classify' ORDER BY rowid", runId).map((r) => ({
    step: r.step,
    result: JSON.parse(r.result_json) as Record<string, unknown>,
  }));
const attemptIdOf = (roots: CliRoots, runId: string, itemId: string): string =>
  (ledgerRows<{ attempt_id: string }>(roots, 'SELECT attempt_id FROM attempts WHERE run_id = ? AND item_id = ? ORDER BY ordinal', runId, itemId)[0] as { attempt_id: string }).attempt_id;

describe('exit run 1 offline: A is verified and ends with B’s numbered choice, A commits and only B blocks (tracer)', () => {
  const s = start(RUN1_HOST);
  const { f, runId } = s;
  const clone = (): string => runRowOf(f.roots, runId).workspace_path;

  it('ends blocked_on_decision with A done, B blocked on its own pause and C never started', () => {
    assert.equal(s.code, 3, s.stdout);
    const run = runRowOf(f.roots, runId);
    assert.deepEqual([run.state, run.reason], ['blocked_on_decision', 'decision']);
    assert.deepEqual(itemStatesOf(f.roots, runId), [
      ['A', 'done'],
      ['B', 'blocked_on_decision'],
      ['C', 'ready'],
    ]);
    assert.deepEqual(
      attemptsOfRun(f.roots, runId).map((a) => [a.item_id, a.reason, a.outcome]),
      [
        ['A', 'initial', 'committed'],
        ['B', 'initial', 'blocked:decision'],
      ],
      'attempts exist for A and B only, none for C',
    );
  });

  it('committed A with its own file only, and passed G2 on it', () => {
    const commits = commitsOfRun(clone(), f.pin);
    assert.deepEqual(
      commits.map((c) => c.subject),
      ['Collapse repeated dashes'],
    );
    assert.deepEqual(commits[0]?.files, ['src/slug.ts']);
    const gates = ledgerRows<{ work_item: string | null; passed: number }>(f.roots, "SELECT work_item, passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(
      gates.map((g) => [g.work_item, g.passed]),
      [['A', 1]],
    );
  });

  it('holds one open decision, B’s own, affecting B and its dependent C, and one notification for it', async () => {
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 1, 'one decision');
    const d = decisions[0] as (typeof decisions)[number];
    assert.equal(d.state, 'open');
    assert.deepEqual(JSON.parse(d.affected_items_json), ['B', 'C']);
    assert.equal(d.issue, QUESTION, 'the question of B’s own unit is the issue');
    await until('the banner to be delivered', () => (ledgerRows(f.roots, "SELECT 1 FROM notifications WHERE state = 'delivered'").length === 1 ? true : undefined));
    const rows = ledgerRows<{ kind: string; subject_ids_json: string }>(f.roots, 'SELECT kind, subject_ids_json FROM notifications');
    assert.equal(rows.length, 1, 'one notification');
    assert.deepEqual(JSON.parse(rows[0]?.subject_ids_json as string), [d.decision_id]);
    assert.equal(readFileSync(s.log, 'utf8').trim().split('\n').length, 1, 'one delivery');
  });

  it('records on A’s classify step that its numbered choice was attributed to B, with the signal and no question text', () => {
    const steps = classifyStepsOf(f.roots, runId);
    const a = steps.find((st) => st.result['attemptId'] === attemptIdOf(f.roots, runId, 'A')) as StepRow;
    assert.equal(a.result['kind'], 'progressed');
    assert.equal(a.result['pauseAttributedTo'], 'B');
    assert.equal(a.result['pauseSignal'], null, 'A was classified as if no pause signal were present');
    assert.deepEqual(a.result['pauseAttribution'], { signal: 'numbered-choice', attributedTo: 'B' });
    assert.ok(!JSON.stringify(a.result).includes('Couldn’t'), 'no question text is recorded');
    const b = steps.find((st) => st.result['attemptId'] === attemptIdOf(f.roots, runId, 'B')) as StepRow;
    assert.equal(b.result['kind'], 'paused');
    assert.equal(b.result['pauseSignal'], 'numbered-choice');
    assert.equal(b.result['pauseAttributedTo'], undefined, 'B’s own question is attributed to nobody');
  });
});

// The controls: every case the rule cannot settle pauses the unit as it did before.
interface Control {
  name: string;
  // Why the rule did not attribute, as the classify step records it.
  reason: RegExp;
  host: Readonly<Record<string, FakeRunOptions>>;
  behavior?: string;
}

const CONTROLS: readonly Control[] = [
  {
    name: 'A ends with a numbered choice whose options its own Behavior paragraph lists',
    reason: /the unit's own or shared/,
    behavior: [`${PARAGRAPH_A} Ask which one before you start:\n1. Collapse to one dash\n2. Keep two dashes`, '', PARAGRAPH_B, '', PARAGRAPH_C].join('\n'),
    host: { ...RUN1_HOST, A: unitOf('A', { question: 'Which rule should item A follow?\n1. Collapse to one dash\n2. Keep two dashes' }) },
  },
  {
    name: 'A ends with B’s wordings but its VERIFICATION is gaps_found',
    reason: /not verified/,
    host: { ...RUN1_HOST, A: unitOf('A', { verification: 'gaps_found', question: `Item A is not done.\n\n${QUESTION}` }) },
  },
  {
    name: 'A ends with one of B’s wordings and one paraphrase',
    reason: /no other item owns every choice line/,
    host: { ...RUN1_HOST, A: unitOf('A', { question: `Item A is done.\n\nWhich wording should item B use?\n1. ${WORDING_1}\n2. \`Couldn’t map it. Please try later.\`` }) },
  },
];

for (const control of CONTROLS) {
  describe(`control: ${control.name}`, () => {
    const s = start(control.host, control.behavior);
    const { f, runId } = s;

    it('pauses A as today: A blocks on its own decision and is not committed', () => {
      assert.equal(s.code, 3, s.stdout);
      const states = itemStatesOf(f.roots, runId);
      assert.deepEqual(states.find(([id]) => id === 'A'), ['A', 'blocked_on_decision']);
      const outcomes = attemptsOfRun(f.roots, runId).filter((a) => a.item_id === 'A');
      assert.deepEqual(outcomes.map((a) => [a.reason, a.outcome]), [['initial', 'blocked:decision']]);
      assert.deepEqual(commitsOfRun(runRowOf(f.roots, runId).workspace_path, f.pin), [], 'nothing of A is committed');
      const a = classifyStepsOf(f.roots, runId).find((st) => st.result['attemptId'] === attemptIdOf(f.roots, runId, 'A')) as StepRow;
      assert.equal(a.result['kind'], 'paused');
      assert.equal(a.result['pauseAttributedTo'], undefined);
      assert.equal(a.result['pauseSignal'], 'numbered-choice');
      const attribution = a.result['pauseAttribution'] as { signal: string; attributedTo: string | null; reason: string };
      assert.deepEqual([attribution.signal, attribution.attributedTo], ['numbered-choice', null]);
      assert.match(attribution.reason, control.reason);
      const own = decisionsOf(f.roots, runId).filter((d) => (JSON.parse(d.affected_items_json) as string[])[0] === 'A');
      assert.equal(own.length, 1, 'A’s decision is open');
    });
  });
}
