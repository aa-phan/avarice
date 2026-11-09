// `status` and `inbox` for runs (plan 02-15; FR-11, OPS-7, S-3, AC-3, D-19; threats T-02-49 and T-02-52). A run is produced by the real
// `start --wait` with the fake run host standing in for the model; everything the views read is a ledger row. Every check here runs
// the production entry (no fake host, no claude) because `status` and `inbox` take no lease, start no model and open the store read-only.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import { EXPIRY_WAIT_MS, SHORT_TTL_MS, sleepSync } from '../helpers/fault-run.ts';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI, offlineAvailable, runOffline } from '../helpers/offline.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import { decisionsOf, runIdOfOutput, s17Fixture, s17Host } from '../helpers/independent-work.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

// An onboarded scratch GSD project with committed conventions and a brief; no run yet.
function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

const FIX = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' } as const;

function runIdOf(stdout: string): string {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

const status = (roots: CliRoots, ...extra: string[]): CliResult => runCli(['status', ...extra], { roots, entry: PRODUCTION_ENTRY });

interface RunJson {
  runId: string;
  title: string;
  state: string;
  reason: string | null;
  lastCheckpoint: { seq: number; nextAction: string; revision: string | null; at: string } | null;
  branch: string | null;
  commit: string | null;
  clean: boolean | null;
  evidence: Array<{ name: string; kind: string; status: string; revision: string; clean: boolean; preExisting?: boolean }>;
  gates: Array<{ gate: string; passed: boolean; revision: string }>;
  openDecisions: number;
  budgets: Array<{ name: string; used: number; limit: number }>;
  references: Array<{ kind: string; id: string; revision: string }>;
  interrupted?: Record<string, unknown>;
}

interface ProjectJson {
  runs?: RunJson[];
  [key: string]: unknown;
}

const PHASE_1_KEYS = ['projectId', 'repoPath', 'onboardingId', 'state', 'reason', 'recordVersion', 'onboardedRevision', 'mapping', 'indexes'];

describe('status shows a finished run: state, checkpoint, evidence and branch, offline (tracer; FR-11, SC 2)', () => {
  const f = fixture();
  // The status of the project as Phase 1 printed it: no run exists yet.
  const before = status(f.roots, '--json');
  const started = startWithFakeRunHost(f.roots, f.repo, f.brief, FIX);
  const runId = runIdOf(started.stdout);

  it('the run reached ready_for_review', () => {
    assert.equal(started.code, 0, started.stderr + started.stdout);
    assert.equal(before.code, 0, before.stderr);
  });

  it('prints the run row and the detail lines of a ready run', () => {
    const ran = status(f.roots);
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, new RegExp(`^runs: 1$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^${runId}\\s+ready_for_review\\s+Collapse repeated dashes in slugs$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^run ${runId}: ready_for_review$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^  branch avarice/${runId} at [0-9a-f]{7} \\(clean\\)$`, 'm'));
    assert.match(ran.stdout, /^ {2}evidence: test passed$/m);
    assert.match(ran.stdout, /^ {2}gates: G0 passed, G1 passed, G2 passed, G4 passed$/m);
    assert.match(ran.stdout, /^ {2}last checkpoint: handoff:fetch \(\d{2}:\d{2}, [^)]+\)$/m);
    assert.match(ran.stdout, /^ {2}budget: cost [0-9.]+ USD of 10\.00 USD; invocations 1 of 3; tool calls \d+ of 400; /m);
    assert.match(ran.stdout, /^ {2}references: brief \S+ at [0-9a-f]{12}; conventions \.avarice\/config\.json at [0-9a-f]{12}$/m);
    assert.doesNotMatch(ran.stdout, /decisions: \d+ open/);
    assert.doesNotMatch(ran.stdout, /interrupted/);
  });

  it('status --json: every Phase 1 key and value is as before, and the project gains a `runs` array with one run', () => {
    const ran = status(f.roots, '--json');
    assert.equal(ran.code, 0, ran.stderr);
    const [entry] = JSON.parse(ran.stdout) as ProjectJson[];
    assert.ok(entry !== undefined);
    assert.deepEqual(Object.keys(entry), [...PHASE_1_KEYS, 'runs'], 'the Phase 1 keys in their order, then runs last');
    // The entry without `runs`, as text, is the Phase 1 entry byte for byte.
    const { runs, ...rest } = entry;
    const [was] = JSON.parse(before.stdout) as ProjectJson[];
    assert.equal(JSON.stringify(rest, null, 2), JSON.stringify(was, null, 2));
    assert.ok(runs !== undefined && runs.length === 1);
    const run = runs[0] as RunJson;
    assert.deepEqual(Object.keys(run), ['runId', 'title', 'state', 'reason', 'lastCheckpoint', 'branch', 'commit', 'clean', 'evidence', 'gates', 'openDecisions', 'budgets', 'references']);
    assert.equal(run.runId, runId);
    assert.equal(run.state, 'ready_for_review');
    assert.equal(run.reason, null);
    assert.equal(run.branch, `avarice/${runId}`);
    assert.match(run.commit ?? '', /^[0-9a-f]{40}$/);
    assert.equal(run.clean, true);
    assert.deepEqual(
      run.evidence.map((e) => [e.name, e.kind, e.status, e.clean, e.preExisting]),
      [['test', 'check', 'passed', true, undefined]],
    );
    assert.equal(run.evidence[0]?.revision, `git:${run.commit}`);
    assert.deepEqual(
      run.gates.map((g) => [g.gate, g.passed]),
      [
        ['G0', true],
        ['G1', true],
        ['G2', true],
        ['G4', true],
      ],
    );
    assert.equal(run.lastCheckpoint?.nextAction, 'handoff:fetch');
    assert.equal(run.lastCheckpoint?.revision, `git:${run.commit}`);
    assert.equal(run.openDecisions, 0);
    assert.deepEqual(run.budgets.map((b) => b.name).sort(), ['costUsd', 'invocations', 'subagentsTotal', 'toolCalls', 'wallClockMs']);
    assert.equal(run.budgets.find((b) => b.name === 'costUsd')?.limit, 10);
    assert.deepEqual(run.references.map((r) => r.kind), ['brief', 'conventions']);
    assert.equal(run.interrupted, undefined);
  });

  it('a project without runs has no `runs` key', () => {
    const g = fixture();
    const ran = status(g.roots, '--json');
    assert.equal(ran.code, 0, ran.stderr);
    const [entry] = JSON.parse(ran.stdout) as ProjectJson[];
    assert.deepEqual(Object.keys(entry as ProjectJson), PHASE_1_KEYS);
    assert.doesNotMatch(status(g.roots).stdout, /^runs:/m);
  });

  it('takes no lease, writes no row and starts no model: the ledger is the same after status and inbox-free reads', () => {
    const count = (): unknown => ({
      events: rows(f.roots, 'SELECT count(*) AS n FROM events'),
      checkpoints: rows(f.roots, 'SELECT count(*) AS n FROM checkpoints'),
      steps: rows(f.roots, 'SELECT count(*) AS n FROM run_steps'),
      runs: rows(f.roots, 'SELECT * FROM runs ORDER BY run_id'),
    });
    const was = count();
    for (const argv of [['status'], ['status', '--json']]) assert.equal(runCli(argv, { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: undefined } }).code, 0);
    assert.deepEqual(count(), was);
    const [run] = rows<{ lease_holder: string | null; lease_fence: number }>(f.roots, 'SELECT lease_holder, lease_fence FROM runs WHERE run_id = ?', runId);
    assert.equal(run?.lease_holder, null);
  });

  it('works with the network denied and no claude binary', { skip: !offlineAvailable() }, () => {
    const ran = runOffline(['status'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, new RegExp(`^run ${runId}: ready_for_review$`, 'm'));
    const json = runOffline(['status', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
    assert.equal(json.code, 0, json.stderr);
    assert.equal((JSON.parse(json.stdout) as ProjectJson[])[0]?.runs?.length, 1);
  });

  it('reads ledger rows only: the run-status module calls no method that writes', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'app', 'run-status.ts'), 'utf8');
    assert.doesNotMatch(text, /acquireRunLease|transitionRun|recordRun|renewRunLease|releaseRunLease|appendEvent/);
  });
});

// ---- Task 2: interrupted and blocked runs, and the inbox -------------------------------------------------------------------------------------

// `start --wait` with a fault armed: the supervisor is killed at the named point, so the command exits 3 reporting the interruption.
function startKilledAt(f: Fixture, fault: string): string {
  const killed = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: FIX }), AVARICE_FAULT: fault, AVARICE_LEASE_TTL_MS: String(SHORT_TTL_MS) },
    timeoutMs: 300_000,
  });
  assert.equal(killed.code, 3, killed.stderr + killed.stdout);
  // The killed supervisor's short lease must lapse, or the run is not shown as interrupted.
  sleepSync(EXPIRY_WAIT_MS + 200);
  return runIdOf(killed.stdout);
}

const openAttemptOf = (f: Fixture, runId: string): string => {
  const open = rows<{ attempt_id: string }>(f.roots, 'SELECT attempt_id FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId);
  assert.equal(open.length, 1, 'one attempt is open');
  return (open[0] as { attempt_id: string }).attempt_id;
};

describe('an interrupted run is shown as paused with the attempt, the step and the command that continues it (S-3, AC-3)', () => {
  it('killed at mid-verify: paused (verification interrupted), at verify:checks', () => {
    const f = fixture();
    const runId = startKilledAt(f, 'mid-verify');
    const attemptId = openAttemptOf(f, runId);

    const human = status(f.roots);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, new RegExp(`^${runId}\\s+paused \\(verification interrupted\\)\\s+`, 'm'));
    assert.match(human.stdout, new RegExp(`^run ${runId}: paused \\(verification interrupted\\)$`, 'm'));
    assert.match(human.stdout, new RegExp(`^ {2}interrupted attempt ${attemptId} at verify:checks$`, 'm'));
    assert.match(human.stdout, new RegExp(`^ {2}continue with: avarice resume ${runId}$`, 'm'));

    const json = JSON.parse(status(f.roots, '--json').stdout) as ProjectJson[];
    const run = json[0]?.runs?.[0] as RunJson;
    assert.equal(run.state, 'verifying', 'the run row keeps the ledger state');
    assert.deepEqual(run.interrupted, {
      state: 'verifying',
      presentedAs: 'paused',
      reason: 'verification interrupted',
      attemptId,
      step: 'verify:checks',
      nextAction: 'verify:checks',
      resumeCommand: `avarice resume ${runId}`,
    });
  });

  it('killed at after-checkpoint:launch:run: paused (supervisor interrupted), at launch:run', () => {
    const f = fixture();
    const runId = startKilledAt(f, 'after-checkpoint:launch:run');
    const attemptId = openAttemptOf(f, runId);
    const human = status(f.roots).stdout;
    assert.match(human, new RegExp(`^run ${runId}: paused \\(supervisor interrupted\\)$`, 'm'));
    assert.match(human, new RegExp(`^ {2}interrupted attempt ${attemptId} at launch:run$`, 'm'));
    assert.match(human, new RegExp(`^ {2}continue with: avarice resume ${runId}$`, 'm'));
    const run = (JSON.parse(status(f.roots, '--json').stdout) as ProjectJson[])[0]?.runs?.[0] as RunJson;
    assert.equal(run.state, 'running');
    assert.equal(run.interrupted?.['reason'], 'supervisor interrupted');
    assert.equal(run.interrupted?.['attemptId'], attemptId);
    assert.equal(run.interrupted?.['step'], 'launch:run');
  });

  it('a run whose lease is still live is not shown as interrupted', () => {
    const f = fixture();
    // No short lease here: the killed supervisor's lease (default length) has not lapsed when status reads it.
    const started = runCli(['start', '--brief', f.brief, '--policy', 'routine'], {
      roots: f.roots,
      cwd: f.repo.path,
      entry: TEST_CLI,
      env: { AVARICE_FAKE_HOST: JSON.stringify({ run: FIX }), AVARICE_FAULT: 'after-checkpoint:launch:run' },
      timeoutMs: 120_000,
    });
    assert.equal(started.code, 0, started.stderr);
    const runId = runIdOf(started.stdout);
    // Wait until the detached supervisor has reached the fault and died; its lease still has minutes to run.
    for (let i = 0; i < 100 && rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM checkpoints WHERE run_id = ? AND next_action = 'launch:run'", runId)[0]?.n === 0; i += 1) sleepSync(100);
    sleepSync(300);
    const run = (JSON.parse(status(f.roots, '--json').stdout) as ProjectJson[])[0]?.runs?.[0] as RunJson;
    assert.equal(run.state, 'running');
    assert.equal(run.interrupted, undefined);
  });
});

const QUESTION = 'Which approach should the slug take?\n1. strip the dashes at both ends\n2. keep them';

describe('a blocked run is listed before a ready run, and the inbox lists its decision and the ready run (FR-11)', () => {
  const f = fixture();
  const ready = startWithFakeRunHost(f.roots, f.repo, f.brief, FIX);
  const readyId = runIdOf(ready.stdout);
  const blocked = startWithFakeRunHost(f.roots, f.repo, f.brief, { question: QUESTION, summary: false });
  const blockedId = runIdOf(blocked.stdout);

  it('both runs ended as intended', () => {
    assert.equal(ready.code, 0, ready.stderr + ready.stdout);
    assert.equal(blocked.code, 3, blocked.stderr + blocked.stdout);
    assert.match(blocked.stdout, new RegExp(`run ${blockedId}: blocked_on_decision \\(decision\\)`));
  });

  it('status lists the blocked run first, with its reason and the open decision', () => {
    const human = status(f.roots).stdout;
    assert.match(human, /^runs: 2$/m);
    assert.ok(human.indexOf(`run ${blockedId}:`) < human.indexOf(`run ${readyId}:`), 'blocked before ready');
    assert.match(human, new RegExp(`^${blockedId}\\s+blocked_on_decision \\(decision\\)\\s+`, 'm'));
    assert.match(human, new RegExp(`^run ${blockedId}: blocked_on_decision \\(decision\\)$`, 'm'));
    assert.match(human, /^ {2}decisions: 1 open \(see avarice inbox\)$/m);
    const runs = (JSON.parse(status(f.roots, '--json').stdout) as ProjectJson[])[0]?.runs as RunJson[];
    assert.deepEqual(
      runs.map((r) => r.runId),
      [blockedId, readyId],
    );
    assert.equal(runs[0]?.openDecisions, 1);
    assert.equal(runs[0]?.interrupted, undefined, 'a blocked run is not an interrupted one');
  });

  it('inbox lists the decision with its class, urgency and issue, and the ready run under reviews', () => {
    const ran = runCli(['inbox'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout.split('\n')[0], 'inbox: 1 open decision, 1 review');
    assert.match(ran.stdout, new RegExp(`^dec_[0-9A-Z]{26}\\s+${blockedId}\\s+acceptance\\s+blocking\\s+`, 'm'));
    assert.match(ran.stdout, /^issue dec_[0-9A-Z]{26}: Which approach should the slug take\? 1\. strip the dashes/m);
    assert.match(ran.stdout, new RegExp(`^${readyId}\\s+avarice/${readyId}\\s+[0-9a-f]{7}\\s+`, 'm'));
    assert.match(ran.stdout, /^reviews:$/m);
  });

  it('inbox --json gives { decisions, reviews }', () => {
    const ran = runCli(['inbox', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    const view = JSON.parse(ran.stdout) as { decisions: Array<Record<string, unknown>>; reviews: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(view), ['decisions', 'reviews']);
    assert.equal(view.decisions.length, 1);
    assert.deepEqual(Object.keys(view.decisions[0] as object), ['decisionId', 'runId', 'class', 'urgency', 'openedAt', 'issue']);
    assert.equal(view.decisions[0]?.['runId'], blockedId);
    assert.equal(view.decisions[0]?.['class'], 'acceptance');
    assert.equal(view.reviews.length, 1);
    assert.deepEqual(Object.keys(view.reviews[0] as object), ['runId', 'title', 'branch', 'commit', 'repository']);
    assert.equal(view.reviews[0]?.['runId'], readyId);
    assert.match(String(view.reviews[0]?.['commit']), /^[0-9a-f]{40}$/);
    assert.match(String(view.reviews[0]?.['repository']), /\/repo$/);
  });

  it('an issue with an escape sequence is printed without it, and a long one is cut to the terminal width', () => {
    // A decision as a model-derived string could arrive: written straight to the ledger, since the run stages strip control characters first.
    const composed = createDeps(profileEnv(f.roots), { host: new FakeRunHost({}) });
    assert.ok(composed.ok, 'composition');
    try {
      for (const issue of ['fix \u001b[31mthis\u001b[0m now\u001b]0;pwned\u0007 please', `long ${'x'.repeat(600)}`]) {
        const opened = composed.value.deps.ledger.openDecision({
          runId: blockedId,
          contractVersion: 1,
          class: 'acceptance',
          issue,
          options: [],
          consequences: {},
          evidenceRefs: [],
          affectedItems: ['A'],
          stateDigest: 'state-digest',
          urgency: 'blocking',
          nowMs: Date.now(),
        });
        assert.ok(opened.ok, JSON.stringify(opened));
      }
    } finally {
      composed.value.close();
    }
    const ran = runCli(['inbox'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(!ran.stdout.includes('\u001b') && !ran.stdout.includes('\u0007'), 'no escape or bell character reaches the terminal');
    assert.match(ran.stdout, /^issue dec_[0-9A-Z]{26}: fix this now please$/m);
    const long = ran.stdout.split('\n').find((line) => line.includes('long xxx'));
    assert.ok(long !== undefined && Array.from(long).length <= 100 && long.endsWith('…'), `the long issue is cut to 100 columns: ${String(long)}`);
    // The JSON keeps the text as stored.
    const view = JSON.parse(runCli(['inbox', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY }).stdout) as { decisions: Array<{ issue: string }> };
    assert.ok(view.decisions.some((d) => d.issue.includes('\u001b[31m')));
    // status counts them as open decisions of the run.
    assert.match(status(f.roots).stdout, /^ {2}decisions: 3 open \(see avarice inbox\)$/m);
  });
});

describe('inbox on an empty store', () => {
  it('prints `inbox: 0 open decisions, 0 reviews` and exits 0', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const ran = runCli(['inbox'], { roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, 'inbox: 0 open decisions, 0 reviews\n');
    assert.deepEqual(JSON.parse(runCli(['inbox', '--json'], { roots, entry: PRODUCTION_ENTRY }).stdout), { decisions: [], reviews: [] });
  });

  it('refuses an argument it does not take, with exit 64 and nothing written', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const ran = runCli(['inbox', 'run_x'], { roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 64);
    assert.match(ran.stderr, /^avarice inbox: inbox takes no argument/);
  });
});

// ---- Plan 03-21 (AUT-12, AUT-4, SC2): every Phase 3 state visible offline -----------------------------------------------------------------------

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');

// The S-17 run (plan 03-18): A done, B blocked on one decision, C done, D never started, one banner delivered through the fake osascript.
function startS17(): { roots: CliRoots; runId: string; code: number | null } {
  const f = s17Fixture(cleanup);
  const logDir = mkdtempSync(join(tmpdir(), 'avarice-status-s17-'));
  cleanup.push(logDir);
  chmodSync(FAKE_OSASCRIPT, 0o755);
  const config = configPathFor(f.roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(config), { recursive: true, mode: 0o700 });
  writeFileSync(
    config,
    `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: f.roots.AVARICE_DATA_ROOT, workRoot: f.roots.AVARICE_WORK_ROOT, notify: { local: { osascriptPath: FAKE_OSASCRIPT } } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: s17Host() }), AVARICE_TEST_NOTIFIER: 'local', FAKE_OSASCRIPT_LOG: join(logDir, 'osascript.log') },
    timeoutMs: 300_000,
  });
  return { roots: f.roots, runId: runIdOfOutput(result.stdout), code: result.code };
}

interface ItemJson {
  itemId: string;
  state: string;
  size: string;
  model: string;
  dependsOn: string[];
  attempts: number;
}
interface InboxJson {
  decisions: Array<Record<string, unknown> & { decisionId: string; runId: string; items: string[]; options: Array<{ key: string; label: string; kind: string }>; command: string; notification?: Record<string, unknown> }>;
  reviews: unknown[];
}

const inbox = (roots: CliRoots, ...extra: string[]): CliResult => runCli(['inbox', ...extra], { roots, entry: PRODUCTION_ENTRY });
const runsOf = (roots: CliRoots): Array<RunJson & Record<string, unknown>> => ((JSON.parse(status(roots, '--json').stdout) as ProjectJson[])[0]?.runs ?? []) as Array<RunJson & Record<string, unknown>>;
const runOf = (roots: CliRoots): RunJson & Record<string, unknown> => runsOf(roots)[0] as RunJson & Record<string, unknown>;

describe('the S-17 blocked run in status and inbox: items, the decision with its options and command, the banner (tracer; AUT-12, AUT-4, SC2)', () => {
  const s = startS17();
  const { roots, runId } = s;

  it('the run is blocked on the decision of item B', () => {
    assert.equal(s.code, 3);
    assert.equal(decisionsOf(roots, runId).filter((d) => d.state === 'open').length, 1);
  });

  it('status --json appends items, decisions and notifications after the Phase 2 keys', () => {
    const run = runOf(roots);
    const keys = Object.keys(run);
    assert.deepEqual(keys.slice(0, 13), ['runId', 'title', 'state', 'reason', 'lastCheckpoint', 'branch', 'commit', 'clean', 'evidence', 'gates', 'openDecisions', 'budgets', 'references']);
    assert.deepEqual(keys.slice(13), ['items', 'decisions', 'notifications']);
    const items = run['items'] as ItemJson[];
    assert.deepEqual(
      items.map((i) => [i.itemId, i.state, i.dependsOn, i.attempts]),
      [
        ['A', 'done', [], 1],
        ['B', 'blocked_on_decision', ['A'], 1],
        ['C', 'done', [], 1],
        ['D', 'ready', ['B'], 0],
      ],
    );
    assert.deepEqual(Object.keys(items[0] as object), ['itemId', 'state', 'size', 'model', 'dependsOn', 'attempts']);
    for (const item of items) assert.ok(item.size !== '' && item.model !== '', 'size and model come from the ledger row');
    const open = decisionsOf(roots, runId).find((d) => d.state === 'open') as { decision_id: string };
    assert.deepEqual(run['decisions'], [{ decisionId: open.decision_id, class: 'acceptance', state: 'open', affectedItems: ['B', 'D'], supersedes: null, successor: null }]);
    assert.deepEqual(run['notifications'], { delivered: 1, pending: 0, held: 0, failed: 0, lastError: null });
    assert.equal(run['cancelRequestedAt'], undefined, 'no cancel request, no key');
  });

  it('status prints one line per item and one per decision, and the delivery state of the banner', () => {
    const open = (decisionsOf(roots, runId).find((d) => d.state === 'open') as { decision_id: string }).decision_id;
    const human = status(roots).stdout;
    assert.match(human, /^ {2}item A {2}done {2}size \S+, model \S+, after none, 1 attempt$/m);
    assert.match(human, new RegExp(`^ {2}item B {2}blocked_on_decision {2}decision ${open} {2}size \\S+, model \\S+, after A, 1 attempt$`, 'm'));
    assert.match(human, /^ {2}item C {2}done /m);
    assert.match(human, /^ {2}item D {2}ready {2}size \S+, model \S+, after B, 0 attempts$/m);
    assert.match(human, new RegExp(`^ {2}decision ${open} {2}acceptance {2}open {2}items B, D$`, 'm'));
    assert.match(human, /^ {2}notifications: 1 delivered$/m);
  });

  it('inbox --json appends items, options, command and notification to the decision', () => {
    const view = JSON.parse(inbox(roots, '--json').stdout) as InboxJson;
    assert.equal(view.decisions.length, 1);
    const d = view.decisions[0] as InboxJson['decisions'][number];
    assert.deepEqual(Object.keys(d), ['decisionId', 'runId', 'class', 'urgency', 'openedAt', 'issue', 'items', 'options', 'command', 'notification']);
    assert.deepEqual(d.items, ['B', 'D']);
    assert.deepEqual(d.options, [
      { key: '1', label: '404', kind: 'choice' },
      { key: '2', label: '410', kind: 'choice' },
    ]);
    assert.equal(d.command, `avarice decide ${d.decisionId} <option-key>`);
    assert.deepEqual(d.notification, { state: 'delivered', attempts: 1 });
  });

  it('inbox prints the options, the command and the banner state under the issue', () => {
    const d = decisionsOf(roots, runId).find((x) => x.state === 'open') as { decision_id: string };
    const human = inbox(roots).stdout;
    assert.match(human, /^ {2}items: B, D$/m);
    assert.match(human, /^ {2}option 1: 404$/m);
    assert.match(human, /^ {2}option 2: 410$/m);
    assert.match(human, new RegExp(`^ {2}answer with: avarice decide ${d.decision_id} <option-key>$`, 'm'));
    assert.match(human, /^ {2}banner delivered$/m);
  });

  it('a decision whose banner failed is still listed, with the error code and the line that says the list is the record', () => {
    const composed = createDeps(profileEnv(roots), { host: new FakeRunHost({}) });
    assert.ok(composed.ok, 'composition');
    let failedId = '';
    try {
      const { ledger } = composed.value.deps;
      const opened = ledger.openDecision({
        runId,
        contractVersion: 1,
        class: 'acceptance',
        issue: 'Which header?',
        options: [{ key: '1', label: 'x-one', kind: 'choice' }],
        consequences: {},
        evidenceRefs: [],
        affectedItems: ['D'],
        stateDigest: 'state-digest',
        urgency: 'blocking',
        nowMs: Date.now(),
      });
      assert.ok(opened.ok, JSON.stringify(opened));
      failedId = opened.value.decisionId;
      const row = ledger.createNotification({ runId, kind: 'decisions', destination: 'local', subjectIds: [failedId], state: 'pending', nowMs: Date.now() });
      assert.ok(row.ok, JSON.stringify(row));
      const attempt = ledger.recordNotificationAttempt(row.value.notificationId, { outcome: 'failed', errorCode: 'osascript-failed', nowMs: Date.now() });
      assert.ok(attempt.ok, JSON.stringify(attempt));
    } finally {
      composed.value.close();
    }
    const human = inbox(roots).stdout;
    assert.match(human, /^ {2}banner not delivered \(osascript-failed\); this list is the record$/m);
    assert.match(human, new RegExp(`^${failedId}\\s+`, 'm'), 'the decision is still listed');
    const view = JSON.parse(inbox(roots, '--json').stdout) as InboxJson;
    assert.deepEqual(view.decisions.find((d) => d.decisionId === failedId)?.notification, { state: 'failed', attempts: 1, lastError: 'osascript-failed' });
    assert.deepEqual(runOf(roots)['notifications'], { delivered: 1, pending: 0, held: 0, failed: 1, lastError: 'osascript-failed' });
    assert.match(status(roots).stdout, /^ {2}notifications: 1 delivered, 1 failed \(osascript-failed\)$/m);
  });
});
